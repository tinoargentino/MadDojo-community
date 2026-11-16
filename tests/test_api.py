import asyncio
import hashlib
import io
import json
import wave
from zipfile import ZipFile

from fastapi.testclient import TestClient
import pytest

from backend import app as server
from backend import library as lib


def wav_bytes(seconds=.25, sr=8000):
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sr)
        wav.writeframes(b"\0\0" * int(seconds * sr))
    return output.getvalue()


@pytest.fixture(scope="module")
def client(tmp_path_factory):
    original_data, original_inbox, original_queue = lib.DATA, lib.INBOX, server.process_queue
    original_exports = server.ardour_exports
    original_previews = server.browser_previews
    root = tmp_path_factory.mktemp("dojo")
    lib.DATA, lib.INBOX = root / "data", root / "Inbox"
    async def idle_queue():
        await asyncio.Event().wait()
    server.process_queue = idle_queue
    server.ardour_exports = idle_queue
    server.browser_previews = idle_queue
    try:
        with TestClient(server.app) as client:
            yield client
    finally:
        lib.DATA, lib.INBOX, server.process_queue = original_data, original_inbox, original_queue
        server.ardour_exports = original_exports
        server.browser_previews = original_previews


def test_exercise_and_range_download(client):
    data = client.get("/api/library").json()
    assert data["songs"][0]["demo"]
    analysis = client.get("/api/songs/warmup/analysis").json()
    assert analysis["duration"] == 40
    assert 60 in analysis["pitch"]
    response = client.get("/api/songs/warmup/audio/vocals", headers={"Range": "bytes=0-43"})
    assert response.status_code == 206
    assert len(response.content) == 44
    assert response.content[:4] == b"RIFF"
    assert client.get("/api/songs/warmup/audio/backing?download=true").headers["content-disposition"].startswith("attachment;")
    assert client.get("/api/songs/missing/analysis").status_code == 404


def test_browser_previews_are_small_range_seekable_and_preserve_source_wavs(client):
    sources = [lib.DATA / "songs/warmup" / f"{stem}.wav" for stem in ["vocals", "backing"]]
    before = [hashlib.sha256(path.read_bytes()).hexdigest() for path in sources]
    for stem, source in zip(["vocals", "backing"], sources):
        response = client.get(f"/api/songs/warmup/preview/{stem}")
        assert response.status_code == 200
        assert response.headers["content-type"] == "audio/mpeg"
        assert len(response.content) < source.stat().st_size / 4
        ranged = client.get(f"/api/songs/warmup/preview/{stem}", headers={"Range": "bytes=0-99"})
        assert ranged.status_code == 206
        assert ranged.content == response.content[:100]
    assert [hashlib.sha256(path.read_bytes()).hexdigest() for path in sources] == before
    assert client.get("/api/songs/warmup/preview/original").status_code == 404
    assert client.get("/api/songs/missing/preview/vocals").status_code == 404


def test_failed_preview_preparation_allows_retry(client, monkeypatch):
    from backend import preview
    with monkeypatch.context() as patch:
        def fail(_song_id):
            raise OSError("encoder failed")
        patch.setattr(preview, "build_previews", fail)
        response = client.get("/api/songs/warmup/preview/vocals")
        assert response.status_code == 503
        assert "retry" in response.json()["detail"]
    assert client.get("/api/songs/warmup/preview/vocals").status_code == 200


def test_import_deduplicates_content_and_keeps_original_name(client):
    payload = wav_bytes()
    first = client.post("/api/import", files={"file": ("A song.wav", payload, "audio/wav")}).json()
    again = client.post("/api/import", files={"file": ("renamed.wav", payload, "audio/wav")}).json()
    assert first["created"]
    assert not again["created"]
    assert again["song"]["id"] == first["song"]["id"]
    assert again["song"]["title"] == "A song"
    assert again["song"]["filename"] == "A song.wav"
    assert (lib.DATA / "songs" / first["song"]["id"] / "source.wav").read_bytes() == payload
    assert not list((lib.DATA / "uploads").iterdir())
    assert client.get(f"/api/songs/{first['song']['id']}/audio/vocals").status_code == 404


def test_invalid_upload_is_rejected_and_temporary_files_are_cleaned(client, monkeypatch):
    assert client.post("/api/import", files={"file": ("bad.txt", b"audio")}).status_code == 400
    assert client.post("/api/import", files={"file": ("empty.wav", b"")}).status_code == 400
    monkeypatch.setattr(lib, "MAX_UPLOAD", 100)
    assert client.post("/api/import", files={"file": ("large.wav", b"x" * 101)}).status_code == 413
    assert not list((lib.DATA / "uploads").iterdir())


def test_loop_grid_settings_survive_new_reads_and_validate_boundaries(client):
    practice = {"bpm": 98, "beats_per_bar": 3, "grid_offset": .2, "manual_grid": True,
                "loops": [{"name": "A tricky phrase", "a": 2.5, "b": 8}]}
    assert client.put("/api/songs/warmup/practice", json=practice).status_code == 200
    song = next(s for s in client.get("/api/library").json()["songs"] if s["id"] == "warmup")
    assert song["practice"] == practice
    bad = {**practice, "loops": [{"a": 20, "b": 10}]}
    assert client.put("/api/songs/warmup/practice", json=bad).status_code == 400
    bad["loops"] = [{"a": 2, "b": 41}]
    assert client.put("/api/songs/warmup/practice", json=bad).status_code == 400


def test_recording_roundtrip_with_alignment_metadata(client):
    payload = wav_bytes(1)
    metadata = {"pitchScore": 75, "segments": [{"start": 0, "end": 1, "position": 3.5, "playing": True, "loop": {"a": 2, "b": 8, "enabled": True}}]}
    response = client.post("/api/songs/warmup/takes", files={"file": ("take.wav", payload, "audio/wav")}, data={"metadata": json.dumps(metadata)})
    assert response.status_code == 200
    take = response.json()
    assert take["duration"] == 1
    saved = client.get("/api/songs/warmup/takes").json()[0]
    assert saved["metadata"] == metadata
    audio = client.get(f"/api/takes/{take['id']}/audio")
    assert audio.content == payload
    assert client.get(f"/api/takes/{take['id']}/audio?download=true").headers["content-disposition"].startswith("attachment;")
    assert client.post("/api/songs/warmup/takes", files={"file": ("take.wav", b"not a wave")}).status_code == 400
    assert client.post("/api/songs/warmup/takes", files={"file": ("take.wav", payload)}, data={"metadata": "[]"}).status_code == 400
    assert not list((lib.DATA / "takes").glob("*.upload"))


def test_cross_site_changes_are_rejected(client):
    assert client.post("/api/import", headers={"Origin": "https://unrelated.example"}, files={"file": ("song.wav", wav_bytes())}).status_code == 403
    assert client.get("/api/library", headers={"Host": "unrelated.example"}).status_code == 403


def test_proxy_page_resolves_assets_with_or_without_trailing_slash(client, monkeypatch):
    monkeypatch.setenv("DOJO_ALLOWED_HOSTS", "dojo.example")
    monkeypatch.setenv("DOJO_BASE_PATH", "/dojo/")
    response = client.get("/", headers={"Host": "dojo.example"})
    assert '<base href="/dojo/">' in response.text
    assert '<base href="/">' in client.get("/").text


def test_ardour_session_download(client):
    response = client.get("/api/songs/warmup/ardour")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert "attachment" in response.headers["content-disposition"]
    with ZipFile(io.BytesIO(response.content)) as zipped:
        assert any(name.endswith(".ardour") for name in zipped.namelist())
        assert len([name for name in zipped.namelist() if name.endswith(".wav")]) == 2
    songs = client.get("/api/library").json()["songs"]
    assert next(s for s in songs if s["id"] == "warmup")["ardour_ready"]
    queued = next(s for s in songs if s["status"] == "queued")
    assert client.get(f"/api/songs/{queued['id']}/ardour").status_code == 409



@pytest.mark.parametrize("mode", ["singer", "bass", "guitar", "drum"])
def test_import_mode_is_persistent_and_deduplicates_per_mode(client, mode):
    payload = wav_bytes(seconds=.37)
    first = client.post("/api/import", files={"file": ("mode-test.wav", payload, "audio/wav")}, data={"mode": mode})
    assert first.status_code == 200
    song = first.json()["song"]
    assert song["mode"] == mode
    repeat = client.post("/api/import", files={"file": ("mode-test.wav", payload, "audio/wav")}, data={"mode": mode}).json()
    assert not repeat["created"] and repeat["song"]["id"] == song["id"]
    stored = [s for s in client.get("/api/library").json()["songs"] if s["filename"] == "mode-test.wav"]
    assert len({s["mode"] for s in stored}) == len(stored)


def test_invalid_mode_is_rejected_before_import(client):
    response = client.post("/api/import", files={"file": ("invalid.wav", wav_bytes(), "audio/wav")}, data={"mode": "piano"})
    assert response.status_code == 400


def test_preexisting_songs_default_to_singer(client):
    assert next(s for s in client.get("/api/library").json()["songs"] if s["id"] == "warmup")["mode"] == "singer"


def test_youtube_import_queues_selected_mode(client, monkeypatch):
    from pathlib import Path
    async def fake_download(*args, **kwargs):
        folder = Path(args[-1])
        (folder / 'source.wav').write_bytes(wav_bytes(seconds=.39))
        (folder / 'result.json').write_text(json.dumps({'title': 'YouTube fixture'}))
        class Worker:
            returncode = 0
            async def communicate(self): return None, b''
        return Worker()
    monkeypatch.setattr(server.asyncio, 'create_subprocess_exec', fake_download)
    response = client.post('/api/import/youtube', data={'url': 'https://youtu.be/BaW_jenozKc', 'mode': 'guitar'})
    assert response.status_code == 200
    assert response.json()['song']['mode'] == 'guitar'
    assert response.json()['song']['title'] == 'YouTube fixture'
    assert response.json()['song']['status'] == 'queued'
    assert not list((lib.DATA / 'uploads').glob('youtube-*'))


def test_youtube_import_rejects_unsupported_urls(client):
    response = client.post('/api/import/youtube', data={'url': 'http://127.0.0.1/', 'mode': 'bass'})
    assert response.status_code == 400


def test_youtube_import_reports_downloader_failure(client, monkeypatch):
    async def failed_download(*args, **kwargs):
        class Worker:
            returncode = 1
            async def communicate(self): return None, b'Video unavailable'
        return Worker()
    monkeypatch.setattr(server.asyncio, 'create_subprocess_exec', failed_download)
    response = client.post('/api/import/youtube', data={'url': 'https://youtu.be/BaW_jenozKc'})
    assert response.status_code == 400
    assert response.json()['detail'] == 'Video unavailable'


def test_desktop_engine_requires_its_session(client, monkeypatch):
    monkeypatch.setenv('DOJO_DESKTOP_TOKEN', 'test-desktop-secret')
    assert client.get('/api/health').status_code == 403
    assert client.get('/api/health', headers={'Authorization': 'Bearer wrong'}).status_code == 403
    assert client.get('/api/health', headers={'Authorization': 'Bearer test-desktop-secret'}).status_code == 200
    client.cookies.set('maddojo-session', 'test-desktop-secret')
    assert client.get('/api/health').status_code == 200
