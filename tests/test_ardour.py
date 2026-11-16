import json
from pathlib import Path
import os
import subprocess
import xml.etree.ElementTree as ET
from zipfile import ZipFile

import pytest
import soundfile as sf

from backend import ardour
from backend import library as lib
from backend.demo import seed_demo


@pytest.fixture
def prepared_library(tmp_path, monkeypatch):
    monkeypatch.setattr(lib, "DATA", tmp_path / "data")
    monkeypatch.setattr(lib, "INBOX", tmp_path / "Inbox")
    lib.initialize()
    seed_demo()
    return lib.get_song("warmup")


def test_bundle_is_portable_with_aligned_stems_and_safe_recording_routes(prepared_library, tmp_path):
    bundle = ardour.build_bundle("warmup")
    with ZipFile(bundle["path"]) as zipped:
        names = zipped.namelist()
        assert all(not Path(name).is_absolute() and ".." not in Path(name).parts for name in names)
        zipped.extractall(tmp_path / "unpacked")
    project = tmp_path / "unpacked" / bundle["name"]
    session = ET.parse(project / f"{bundle['name']}.ardour").getroot()
    assert session.get("sample-rate") == "44100"
    assert session.find("TempoMap/Tempos/Tempo").get("npm") == "96.0"
    assert session.find("Config/Option[@name='auto-return']").get("value") == "0"
    routes = {r.get("name"): r for r in session.findall("Routes/Route")}
    assert set(routes) == {"Master", "Backing", "Guide vocal", "Your voice"}
    for name in ["Backing", "Guide vocal"]:
        assert routes[name].find("Controllable[@name='rec-safe']").get("value") == "1"
    assert routes["Your voice"].find("Controllable[@name='rec-enable']").get("value") == "0"
    assert routes["Your voice"].find("Controllable[@name='rec-safe']").get("value") == "0"
    for file in ["Backing.wav", "Guide vocal.wav"]:
        info = sf.info(project / "interchange" / bundle["name"] / "audiofiles" / file)
        assert info.frames == 40 * 44100
        assert info.channels == 2
    for source in session.findall("Sources/Source"):
        assert not Path(source.get("name")).is_absolute()
        assert source.get("origin") == ""
    ids = [n.get("id") for n in session.iter() if n.get("id")]
    assert len(ids) == len(set(ids)), "Native session object IDs must be unique"
    assert len(list((project / "Dojo tools").glob("*.lua"))) == 7
    assert (project / "START HERE.txt").is_file()
    assert (project / "Install Dojo tools.sh").is_file()
    text = (project / f"{bundle['name']}.ardour").read_text()
    assert str(lib.DATA) not in text


def test_practice_edits_make_a_new_bundle_without_replacing_old_sessions(prepared_library):
    first = ardour.build_bundle("warmup")
    original = first["path"].read_bytes()
    assert ardour.build_bundle("warmup")["path"] == first["path"]
    settings = {"bpm": 100, "beats_per_bar": 3, "grid_offset": .2, "manual_grid": True,
                "loops": [{"name": "My phrase", "a": 3, "b": 7}]}
    lib.update_song("warmup", practice=json.dumps(settings))
    second = ardour.build_bundle("warmup")
    assert second["path"] != first["path"]
    assert first["path"].read_bytes() == original
    with ZipFile(second["path"]) as zipped:
        root = ET.fromstring(zipped.read(f"{second['name']}/{second['name']}.ardour"))
        assert root.find("TempoMap/Tempos/Tempo").get("npm") == "100.0"
        assert root.find("TempoMap/Meters/Meter").get("divisions-per-bar") == "3"
        loop = root.find("Locations/Location[@name='Practice loop']")
        assert loop.get("start") == "a846720000"
        assert loop.get("end") == "a1975680000"


def test_existing_working_folder_is_never_overwritten(prepared_library, tmp_path):
    folder = tmp_path / "working"
    folder.mkdir()
    (folder / "my-voice.wav").write_bytes(b"keep my recording")
    with pytest.raises(FileExistsError):
        ardour.write_session(prepared_library, folder)
    assert (folder / "my-voice.wav").read_bytes() == b"keep my recording"


def test_optional_tools_installer_keeps_existing_user_scripts(prepared_library, tmp_path):
    working = tmp_path / "working"
    ardour.write_session(prepared_library, working)
    config = tmp_path / "Ardour preferences/scripts"
    config.mkdir(parents=True)
    custom = config / "dojo_vocal_mute.lua"
    custom.write_text("my customized mute action")
    subprocess.run(["sh", str(working / "Install Dojo tools.sh")], check=True,
                   env={**os.environ, "DOJO_ARDOUR_SCRIPTS_DIR": str(config)}, capture_output=True)
    assert custom.read_text() == "my customized mute action"
    assert len(list(config.glob("*.lua"))) == 7


@pytest.mark.parametrize("title", ["../../bad:name?*", "CON", "声の練習", " ", "a" * 300])
def test_session_names_are_safe_on_mac_and_windows(title):
    name = ardour.session_name(title)
    assert name.startswith("MadDojo - ")
    assert len(name.encode()) < 200
    assert not any(c in name for c in '/\\:*?"<>|')
    assert not name.endswith((".", " "))



@pytest.mark.parametrize("mode,guide", [("bass", "Guide bass"), ("guitar", "Guide guitar"), ("drum", "Guide drums")])
def test_mode_sessions_name_guide_and_recording_tracks(prepared_library, tmp_path, mode, guide):
    with lib.connect() as db:
        db.execute("UPDATE songs SET mode=? WHERE id='warmup'", (mode,))
    song = lib.get_song("warmup")
    session = ardour.write_session(song, tmp_path / mode)
    root = ET.parse(session).getroot()
    assert root.find(f"Routes/Route[@name='{guide}']") is not None
    assert root.find("Routes/Route[@name='Your instrument']") is not None
    assert root.find("Routes/Route[@name='Guide vocal']") is None
    assert (session.parent / "Dojo tools/dojo_vocal_mute.lua").read_text().count(guide) == 1
