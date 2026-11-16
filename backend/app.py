from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import json
import html
import logging
import math
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
from urllib.parse import urlparse
from uuid import uuid4
import wave

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import library as lib
from .demo import seed_demo
from . import ardour
from . import preview
from .modes import practice_mode, MODES
from .youtube import youtube_url

log = logging.getLogger("dojo")
process = None
scan_errors: dict[str, str] = {}


async def watch_inbox():
    previous = {}
    imported = {}
    while True:
        try:
            current = {}
            for path in lib.INBOX.rglob("*"):
                if not path.is_file() or path.suffix.lower() not in lib.EXTENSIONS or path.name.startswith("."):
                    continue
                stat = path.stat()
                signature = (stat.st_size, stat.st_mtime_ns)
                key = str(path)
                current[key] = signature
                if previous.get(key) == signature and imported.get(key) != signature:
                    try:
                        await asyncio.to_thread(lib.import_file, path, None, path.relative_to(lib.INBOX).parts[0] if path.relative_to(lib.INBOX).parts[0] in MODES else "singer")
                        scan_errors.pop(key, None)
                    except (OSError, ValueError) as exc:
                        scan_errors[key] = str(exc)
                    imported[key] = signature
            previous = current
            imported = {key: val for key, val in imported.items() if key in current}
        except Exception:
            log.exception("Inbox scan failed")
        await asyncio.sleep(3)


async def process_queue():
    global process
    while True:
        song = next((s for s in lib.all_songs() if s["status"] == "queued"), None)
        if song is None:
            await asyncio.sleep(1)
            continue
        folder = lib.DATA / "songs" / song["id"]
        lib.update_song(song["id"], status="processing", error=None, stage="Starting separator", progress=0)
        try:
            (folder / "progress.json").unlink(missing_ok=True)
            with (folder / "preparation.log").open("w") as logfile:
                process = await asyncio.create_subprocess_exec(
                    sys.executable, "-m", "backend.process", str(folder), song["mode"],
                    cwd=lib.ROOT, stdout=logfile, stderr=logfile, start_new_session=os.name != "nt",
                    env={**os.environ, "NUMBA_NUM_THREADS": "4", "OMP_NUM_THREADS": "8"})
                while process.returncode is None:
                    try:
                        progress = json.loads((folder / "progress.json").read_text())
                        lib.update_song(song["id"], **progress)
                    except (OSError, ValueError):
                        pass
                    try:
                        await asyncio.wait_for(process.wait(), timeout=1)
                    except asyncio.TimeoutError:
                        pass
                if process.returncode:
                    lines = (folder / "preparation.log").read_text(errors="replace").strip().splitlines()
                    raise RuntimeError(next((line for line in reversed(lines) if line.strip()), "Preparation failed"))
            analysis = json.loads((folder / "analysis.json").read_text())
            lib.update_song(song["id"], status="ready", stage="Ready to practice", progress=1,
                            duration=analysis["duration"], bpm=analysis["bpm"], error=None)
        except asyncio.CancelledError:
            if process and process.returncode is None:
                if os.name == "nt":
                    process.terminate()
                else:
                    os.killpg(process.pid, signal.SIGTERM)
                await process.wait()
            raise
        except Exception as exc:
            log.exception("Song preparation failed")
            lib.update_song(song["id"], status="error", stage="Preparation needs attention", error=str(exc)[-700:])
        finally:
            process = None


async def ardour_exports():
    """Prepare native downloads without blocking audio separation or HTTP."""
    while True:
        for song in lib.all_songs():
            if song["status"] != "ready":
                continue
            try:
                if not ardour.bundle_info(song)["path"].is_file():
                    await asyncio.to_thread(ardour.build_bundle, song["id"])
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Ardour session preparation failed for %s", song["id"])
        await asyncio.sleep(5)


async def browser_previews():
    while True:
        for song in lib.all_songs():
            if song["status"] != "ready":
                continue
            try:
                info = preview.preview_info(song["id"])
                if not all(path.is_file() for path in info["paths"].values()):
                    await asyncio.to_thread(preview.build_previews, song["id"])
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("Browser playback preparation failed for %s", song["id"])
        await asyncio.sleep(5)


@asynccontextmanager
async def lifespan(app):
    lib.initialize()
    await asyncio.to_thread(seed_demo)
    tasks = [asyncio.create_task(watch_inbox()), asyncio.create_task(process_queue()),
             asyncio.create_task(ardour_exports()), asyncio.create_task(browser_previews())]
    yield
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)


app = FastAPI(title="MadDojo", lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def local_app_guard(request: Request, call_next):
    host = request.headers.get("host", "").split(":")[0]
    if host not in ({"localhost", "127.0.0.1", "testserver"} | {h.strip() for h in os.environ.get("DOJO_ALLOWED_HOSTS", "").split(",") if h.strip()}):
        return JSONResponse({"detail": "Unknown app host"}, status_code=403)
    if request.method not in {"GET", "HEAD", "OPTIONS"}:
        origin = request.headers.get("origin")
        if request.headers.get("sec-fetch-site") == "cross-site" or (origin and urlparse(origin).netloc != request.headers.get("host")):
            return JSONResponse({"detail": "Open MadDojo directly to make changes"}, status_code=403)
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "same-origin"
    response.headers["Permissions-Policy"] = "microphone=(self)"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    elif request.url.path.endswith((".js", ".css")):
        response.headers["Cache-Control"] = "no-cache"
    return response


def require_song(song_id):
    song = lib.get_song(song_id)
    if not song:
        raise HTTPException(404, "Song not found")
    return song


@app.get("/api/library")
def library():
    songs = lib.all_songs()
    for song in songs:
        song["ardour_ready"] = False
        if song["status"] == "ready":
            try:
                song["ardour_ready"] = ardour.bundle_info(song)["path"].is_file()
            except OSError:
                pass
    return {"songs": songs, "inbox": str(lib.INBOX), "data": str(lib.DATA),
            "watch_errors": scan_errors, "separator": "Demucs · htdemucs", "version": "0.1.0"}


@app.get("/api/health")
def health():
    return {"ok": True, "app": "MadDojo", "watching": str(lib.INBOX), "processing": process is not None}


@app.post("/api/import")
async def upload_song(file: UploadFile = File(...), mode: str = Form("singer")):
    try:
        practice_mode(mode)
    except ValueError as exc:
        await file.close()
        raise HTTPException(400, str(exc)) from exc
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in lib.EXTENSIONS:
        raise HTTPException(400, "Choose an audio file: MP3, WAV, FLAC, M4A, OGG, AAC, OPUS, AIFF or WMA")
    tmp = lib.DATA / "uploads" / (uuid4().hex + suffix)
    size = 0
    try:
        with tmp.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > lib.MAX_UPLOAD:
                    raise HTTPException(413, "The limit is 512 MB per song")
                out.write(chunk)
        title = Path(file.filename or "Untitled").stem[:200]
        song, created = await asyncio.to_thread(lib.import_file, tmp, title, mode)
        if created:
            with lib.connect() as db:
                db.execute("UPDATE songs SET filename=? WHERE id=?", (Path(file.filename).name, song["id"]))
        return {"song": lib.get_song(song["id"]), "created": created}
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    finally:
        tmp.unlink(missing_ok=True)
        await file.close()


@app.post("/api/import/youtube")
async def import_youtube(url: str = Form(...), mode: str = Form("singer")):
    try:
        practice_mode(mode)
        url = youtube_url(url)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    with tempfile.TemporaryDirectory(prefix="youtube-", dir=lib.DATA / "uploads") as temporary:
        folder = Path(temporary)
        worker = await asyncio.create_subprocess_exec(
            sys.executable, "-m", "backend.youtube", url, str(folder),
            cwd=lib.ROOT, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
            start_new_session=os.name != "nt")
        try:
            _, errors = await asyncio.wait_for(worker.communicate(), timeout=300)
        except (asyncio.TimeoutError, asyncio.CancelledError) as exc:
            if worker.returncode is None:
                if os.name == "nt": worker.terminate()
                else: os.killpg(worker.pid, signal.SIGTERM)
                await worker.wait()
            if isinstance(exc, asyncio.CancelledError): raise
            raise HTTPException(504, "YouTube download timed out; try again") from exc
        if worker.returncode:
            detail = errors.decode(errors="replace").strip().splitlines()
            raise HTTPException(400, detail[-1][-700:] if detail else "Could not download YouTube audio")
        result = json.loads((folder / "result.json").read_text())
        try:
            song, created = await asyncio.to_thread(lib.import_file, folder / "source.wav", result["title"], mode)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        return {"song": song, "created": created}


@app.post("/api/songs/{song_id}/retry")
def retry_song(song_id: str):
    song = require_song(song_id)
    if song["status"] != "error":
        raise HTTPException(409, "Only failed preparations can be retried")
    lib.update_song(song_id, status="queued", stage="Waiting to prepare", progress=0, error=None)
    return {"ok": True}


@app.get("/api/songs/{song_id}/analysis")
def analysis(song_id: str):
    song = require_song(song_id)
    if song["status"] != "ready":
        raise HTTPException(409, "This song is still being prepared")
    return FileResponse(lib.DATA / "songs" / song_id / "analysis.json", media_type="application/json")


@app.get("/api/songs/{song_id}/audio/{stem}")
def audio(song_id: str, stem: str, download: bool = False):
    song = require_song(song_id)
    if stem not in {"vocals", "backing", "original"} or song["status"] != "ready":
        raise HTTPException(404, "Audio not ready")
    return FileResponse(lib.DATA / "songs" / song_id / f"{stem}.wav", media_type="audio/wav",
                        filename=f"{song['title']} - {stem}.wav" if download else None)


@app.get("/api/songs/{song_id}/ardour")
async def ardour_download(song_id: str):
    song = require_song(song_id)
    if song["status"] != "ready":
        raise HTTPException(409, "This song is still being prepared")
    try:
        bundle = await asyncio.to_thread(ardour.build_bundle, song_id)
    except (OSError, ValueError) as exc:
        log.exception("Could not create Ardour download")
        raise HTTPException(500, "The Ardour session could not be prepared. You can still export the stems.") from exc
    return FileResponse(bundle["path"], media_type="application/zip",
                        filename=bundle["name"] + " - Ardour.zip")


@app.get("/api/songs/{song_id}/preview/{stem}")
async def browser_audio(song_id: str, stem: str):
    song = require_song(song_id)
    if stem not in preview.STEMS or song["status"] != "ready":
        raise HTTPException(404, "Practice audio not ready")
    try:
        files = await asyncio.to_thread(preview.build_previews, song_id)
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        log.exception("Could not prepare browser audio")
        raise HTTPException(503, "Practice audio could not be prepared. Please retry.") from exc
    return FileResponse(files["paths"][stem], media_type="audio/mpeg")


class Practice(BaseModel):
    loops: list[dict] = Field(default_factory=list, max_length=100)
    bpm: float | None = Field(None, ge=30, le=300)
    grid_offset: float = Field(0, ge=-1200, le=1200)
    beats_per_bar: int = Field(4, ge=1, le=12)
    manual_grid: bool = False


@app.put("/api/songs/{song_id}/practice")
def save_practice(song_id: str, practice: Practice):
    song = require_song(song_id)
    for loop in practice.loops:
        a, b = loop.get("a"), loop.get("b")
        if not isinstance(a, (int, float)) or not isinstance(b, (int, float)) or not math.isfinite(a + b) or not 0 <= a < b <= (song["duration"] or 1200) + .01:
            raise HTTPException(400, "Invalid loop boundaries")
        loop["name"] = str(loop.get("name", "Practice loop"))[:80]
    lib.update_song(song_id, practice=practice.model_dump_json())
    return {"ok": True}


@app.get("/api/songs/{song_id}/takes")
def takes(song_id: str):
    require_song(song_id)
    with lib.connect() as db:
        rows = db.execute("SELECT * FROM takes WHERE song_id=? ORDER BY created DESC", (song_id,)).fetchall()
    return [{**dict(row), "metadata": json.loads(row["metadata"])} for row in rows]


@app.post("/api/songs/{song_id}/takes")
async def save_take(song_id: str, file: UploadFile = File(...), metadata: str = Form("{}")):
    require_song(song_id)
    try:
        meta = json.loads(metadata)
        if not isinstance(meta, dict) or len(metadata) > 500_000:
            raise ValueError()
    except ValueError:
        raise HTTPException(400, "Invalid take information")
    take_id = uuid4().hex
    path = lib.DATA / "takes" / f"{take_id}.wav"
    temp = path.with_suffix(".upload")
    size = 0
    try:
        with temp.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > lib.MAX_UPLOAD:
                    raise HTTPException(413, "Recording exceeds 512 MB")
                out.write(chunk)
        try:
            with wave.open(str(temp), "rb") as wav:
                duration = wav.getnframes() / wav.getframerate()
                if wav.getnchannels() not in {1, 2} or wav.getsampwidth() != 2 or not .1 <= duration <= 3600:
                    raise ValueError()
        except (wave.Error, EOFError, ValueError, ZeroDivisionError):
            raise HTTPException(400, "Please record a valid PCM WAV take")
        temp.replace(path)
        with lib.connect() as db:
            number = db.execute("SELECT count(*) FROM takes WHERE song_id=?", (song_id,)).fetchone()[0] + 1
            title = f"Take {number:02}"
            db.execute("INSERT INTO takes VALUES(?,?,?,?,?,?)", (take_id, song_id, title, time.time(), duration, json.dumps(meta)))
        return {"id": take_id, "title": title, "duration": duration}
    finally:
        temp.unlink(missing_ok=True)
        await file.close()


@app.get("/api/takes/{take_id}/audio")
def take_audio(take_id: str, download: bool = False):
    with lib.connect() as db:
        take = db.execute("SELECT * FROM takes WHERE id=?", (take_id,)).fetchone()
    if not take:
        raise HTTPException(404, "Take not found")
    return FileResponse(lib.DATA / "takes" / f"{take_id}.wav", media_type="audio/wav",
                        filename=f"{take['title']}.wav" if download else None)


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    # Tailscale Serve strips /dojo. A base also makes the slashless URL work.
    base = os.environ.get("DOJO_BASE_PATH", "/") if request.headers.get("host", "").split(":")[0] not in {"localhost", "127.0.0.1", "testserver"} else "/"
    base = html.escape(base, quote=True)
    page = (lib.ROOT / "web/index.html").read_text()
    return HTMLResponse(page.replace("<!--APP_BASE-->", f'<base href="{base}">'),
                        headers={"Cache-Control": "no-cache"})


app.mount("/", StaticFiles(directory=lib.ROOT / "web", html=True), name="web")
