"""Portable Ardour practice sessions, built from an Ardour-generated template.

Only generated cache bundles are replaced. A user's working session is never
updated in place: recordings, edits and native tempo corrections belong to it.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import unicodedata
from uuid import uuid4
import xml.etree.ElementTree as ET
from zipfile import ZipFile, ZIP_DEFLATED

import soundfile as sf

from . import library as lib
from .modes import practice_mode

SUPERCLOCK = 282_240_000
VERSION = 1
TEMPLATE = lib.ROOT / "backend/assets/ardour-base.ardour"
SCRIPTS = lib.ROOT / "ardour/scripts"
_lock = threading.Lock()
_implementation_hash = hashlib.sha256(Path(__file__).read_bytes()).digest()


def session_name(title: str) -> str:
    ascii_title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode()
    clean = re.sub(r"[^a-zA-Z0-9 ._-]", "-", ascii_title).strip(" .-")[:72].rstrip(" .")
    return "MadDojo - " + (clean or "Song")


def fingerprint(song: dict, folder: Path) -> str:
    digest = hashlib.sha256()
    digest.update(str(VERSION).encode())
    digest.update(_implementation_hash)
    digest.update(TEMPLATE.read_bytes())
    digest.update(json.dumps({"title": song["title"], "practice": song["practice"], "mode": song.get("mode", "singer")}, sort_keys=True).encode())
    for path in [folder / "analysis.json", folder / "backing.wav", folder / "vocals.wav"]:
        stat = path.stat()
        digest.update(f"{path.name}:{stat.st_size}:{stat.st_mtime_ns}".encode())
    for path in sorted(SCRIPTS.glob("*.lua")):
        digest.update(path.read_bytes())
    return digest.hexdigest()[:20]


def bundle_info(song: dict) -> dict:
    folder = lib.DATA / "songs" / song["id"]
    key = fingerprint(song, folder)
    cache = lib.DATA / "exports/ardour" / song["id"] / key
    return {"path": cache / "session.zip", "name": session_name(song["title"]), "revision": key}


def build_bundle(song_id: str) -> dict:
    with _lock:
        song = lib.get_song(song_id)
        if not song or song["status"] != "ready":
            raise ValueError("Prepare the song before opening it in Ardour")
        info = bundle_info(song)
        if info["path"].is_file():
            return info
        destination = info["path"].parent
        destination.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="build-", dir=destination) as staging:
            staging = Path(staging)
            project = staging / info["name"]
            write_session(song, project)
            archive = staging / "session.zip"
            with ZipFile(archive, "w", compression=ZIP_DEFLATED, compresslevel=1) as zipped:
                for file in sorted(project.rglob("*")):
                    if file.is_file():
                        zipped.write(file, file.relative_to(staging))
            archive.replace(info["path"])
        return info


def write_session(song: dict, destination: Path) -> Path:
    if destination.exists():
        raise FileExistsError("Choose a new destination so existing recordings stay intact")
    config = practice_mode(song.get("mode", "singer"))
    original = lib.DATA / "songs" / song["id"]
    analysis = json.loads((original / "analysis.json").read_text())
    backing_info, vocal_info = [sf.info(original / f"{stem}.wav") for stem in ["backing", "vocals"]]
    if backing_info.samplerate != vocal_info.samplerate or backing_info.frames != vocal_info.frames:
        raise ValueError("The prepared stems do not have matching lengths and sample rates")
    sr, frames = backing_info.samplerate, backing_info.frames
    duration = frames / sr
    name = session_name(song["title"])
    practice = song["practice"]
    bpm = float(practice.get("bpm") or analysis["bpm"])
    meter = int(practice.get("beats_per_bar", 4))
    offset = float(practice.get("grid_offset", 0))
    if practice.get("manual_grid"):
        period = 60 / bpm
        first = offset + math.ceil(-offset / period) * period
        beats = [first + i * period for i in range(math.ceil(duration / period) + 2) if 0 <= first + i * period < duration]
        first_index = math.ceil(-offset / period)
    else:
        beats = [float(b) + offset for b in analysis["beats"] if 0 <= float(b) + offset < duration]
        first_index = next((i for i, b in enumerate(analysis["beats"]) if b + offset >= 0), 0)
    saved = [p for p in practice.get("loops", []) if 0 <= p["a"] < p["b"] <= duration + .01]
    if saved:
        loop_a, loop_b = saved[0]["a"], saved[0]["b"]
    else:
        loop_a = beats[0] if beats else 0
        loop_b = beats[2 * meter] if len(beats) > 2 * meter else min(duration, loop_a + 2 * meter * 60 / bpm)
    root = ET.parse(TEMPLATE).getroot()
    root.set("name", name)
    root.set("uuid", str(uuid4()))
    root.set("sample-rate", str(sr))
    root.set("session-range-is-free", "1")
    counter = max([int(n.get("id")) for n in root.iter() if n.get("id", "").isdigit()] + [int(root.get("id-counter", 0))]) + 10

    def next_id():
        nonlocal counter
        counter += 1
        return str(counter)

    def at(seconds):
        samples = round(seconds * sr)
        return "a" + str(round(samples * SUPERCLOCK / sr))

    def location(label, a, b, flags):
        ET.SubElement(root.find("Locations"), "Location", {
            "id": next_id(), "name": label, "start": at(a), "end": at(b), "flags": flags,
            "locked": "0", "timestamp": "0", "cue": "-1",
        })

    for option in root.findall("Config/Option"):
        if option.get("name") == "default-time-domain": option.set("value", "AudioTime")
        if option.get("name") == "auto-return": option.set("value", "0")
    tempo = root.find("TempoMap/Tempos/Tempo")
    tempo.set("npm", str(bpm)); tempo.set("enpm", str(bpm))
    root.find("TempoMap/Meters/Meter").set("divisions-per-bar", str(meter))
    location("session", 0, duration, "IsSessionRange")
    location("Practice loop", loop_a, loop_b, "IsAutoLoop,IsRangeMarker")
    for loop in saved:
        location(str(loop.get("name", "Practice phrase"))[:80], loop["a"], loop["b"], "IsRangeMarker")
    # A few useful phrase-sized ranges, rather than hundreds of ruler labels.
    for i in range(0, min(len(beats), 32 * meter), 4 * meter):
        a = beats[i]
        b = beats[i + 4 * meter] if i + 4 * meter < len(beats) else duration
        if b > a + .1: location(f"Phrase {i // (4 * meter) + 1:02}", a, b, "IsRangeMarker")
    audio = destination / "interchange" / name / "audiofiles"
    audio.mkdir(parents=True)
    colors = {"Backing": "2862847487", "Guide vocal": "1266895615", "Your voice": "3139383295"}
    for route in root.findall("Routes/Route"):
        route_name = route.get("name")
        if route_name in colors:
            route.find("PresentationInfo").set("color", colors[route_name])
        if route_name in {"Backing", "Guide vocal"}:
            route.find("Controllable[@name='rec-safe']").set("value", "1")
            route.find("Processor[@type='diskwriter']").set("record-safe", "1")
        # Generic port connections are translated by Ardour to the active backend.
        if route_name == "Master":
            ports = route.findall("IO[@direction='Output']/Port")
            for channel, port in enumerate(ports, 1):
                for child in list(port): port.remove(child)
                ET.SubElement(port, "Connection", {"other": f"system:playback_{channel}"})
        if route_name == "Your voice":
            port = route.find("IO[@direction='Input']/Port")
            ET.SubElement(port, "Connection", {"other": "system:capture_1"})
        if route_name not in {"Backing", "Guide vocal"}: continue
        stem = "backing" if route_name == "Backing" else "vocals"
        filename = "Backing.wav" if stem == "backing" else config["guide"] + ".wav"
        shutil.copyfile(original / f"{stem}.wav", audio / filename)
        source_ids = []
        channels = backing_info.channels if stem == "backing" else vocal_info.channels
        for channel in range(channels):
            source_id = next_id(); source_ids.append(source_id)
            ET.SubElement(root.find("Sources"), "Source", {"name": filename, "type": "audio", "flags": "", "id": source_id,
                           "channel": str(channel), "origin": "", "gain": "1"})
        attributes = {
            "id": next_id(), "name": route_name, "type": "audio", "position": "a0", "start": "a0",
            "length": at(duration) + "@a0", "sync-position": "a0", "ancestral-start": "a0", "ancestral-length": "a0@a0",
            "whole-file": "1", "channels": str(channels), "scale-amplitude": "1", "layering-index": "0",
            "locked": "0", "muted": "0", "opaque": "1", "automatic": "1", "import": "1", "external": "0",
            "stretch": "1", "shift": "1", "fade-in-active": "1", "fade-out-active": "1", "envelope-active": "0",
        }
        for channel, source_id in enumerate(source_ids):
            attributes[f"source-{channel}"] = source_id
            attributes[f"master-source-{channel}"] = source_id
        region = ET.SubElement(root.find("Regions"), "Region", attributes)
        for tag in ["Envelope", "FadeIn", "FadeOut"]: ET.SubElement(region, tag, {"default": "yes"})
        clip = deepcopy(region)
        clip.set("id", next_id()); clip.set("whole-file", "0")
        playlist = root.find(f"Playlists/Playlist[@id='{route.get('audio-playlist')}']")
        playlist.append(clip)
    root.set("id-counter", str(counter + 10))
    ET.indent(root, space="  ")
    session = destination / f"{name}.ardour"
    xml = ET.tostring(root, encoding="unicode").replace("Guide vocal", config["guide"])
    if song.get("mode", "singer") != "singer": xml = xml.replace("Your voice", "Your instrument")
    session.write_text('<?xml version="1.0" encoding="utf-8"?>\n' + xml)
    grid = {"bpm": bpm, "meter": meter, "duration": duration, "beats": beats, "first_index": first_index}
    (destination / "dojo-grid.lua").write_text("return {\n" +
        f"bpm={bpm}, meter={meter}, duration={duration}, first_index={first_index},\nbeats={{" +
        ",".join(f"{b:.7f}" for b in beats) + "}\n}\n")
    (destination / "dojo-info.json").write_text(json.dumps({
        "format": VERSION, "song_id": song["id"], "title": song["title"], "session": session.name,
        "sample_rate": sr, "duration": duration, "grid": grid, "minimum_tested_ardour": "9.8",
    }, ensure_ascii=False, indent=2))
    tools = destination / "Dojo tools"
    tools.mkdir()
    for script in SCRIPTS.glob("*.lua"):
        (tools / script.name).write_text(script.read_text().replace("Guide vocal", config["guide"]))
    (destination / "START HERE.txt").write_text(quick_start(song["title"]).replace("Guide vocal", config["guide"]).replace("Your voice", "Your voice" if song.get("mode", "singer") == "singer" else "Your instrument"))
    (destination / "Install Dojo tools.sh").write_text(INSTALL_TOOLS)
    (destination / "Install Dojo tools.sh").chmod(0o755)
    return session


def quick_start(title):
    return f"""MADDOJO · ARDOUR PRACTICE SESSION
{title}

1. Keep this entire folder together. Open its .ardour file with Ardour 9.8 or newer.
2. Choose the audio device connected to your microphone/headphones.
   Mac: CoreAudio. Linux: ALSA/JACK/PipeWire for low latency, or PulseAudio to get started.
   Start at 128 or 256 samples if the device supports it; increase if you hear crackles.
3. Space starts/stops. L plays the current loop. The loop is initially two bars
   (or your first saved phrase). Choose other ranges in the Ranges & Marks panel.
4. Guide vocal's M button toggles the singer. Its fader controls the singer's level.
   Backing has its own fader. Both prepared stems are protected against recording.
5. Select the correct input on Your voice, then arm its red record button.
   Enable the main transport record button and press Space to record.
   Use headphones. Your voice is initially unarmed; no recording starts on open.
6. Use layered recording / playlists to keep takes. Save the session with Ctrl+S
   (Command+S on Mac). Your new recordings stay inside this working folder.

OPTIONAL ONE-CLICK DOJO TOOLS
Run `sh 'Install Dojo tools.sh'` in a terminal inside this folder. This only copies
the included Lua scripts to Ardour's script directory; existing scripts are kept.
In Ardour: Edit > Scripted Actions > Manage, then assign the Dojo actions to toolbar
buttons or keyboard shortcuts. They provide guide mute, quieter/louder guide,
one/two/four-bar loops, and restart phrase. Native transport remains Ardour's.

The Dojo bar-loop actions follow the detected beat grid in dojo-grid.lua.
The visible native ruler uses the estimated steady tempo. For recordings with
tempo changes, correct Ardour's tempo map or use the prepared phrase ranges.
Detected beat groups assume the selected meter; they are not guaranteed downbeats.

Keep your working sessions on a local disk when practicing. Downloading a new
bundle creates a fresh starting session; it does not update your recordings.
"""


INSTALL_TOOLS = '''#!/bin/sh
set -eu
dojo_source=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -n "${DOJO_ARDOUR_SCRIPTS_DIR:-}" ]; then
  dojo_config="$DOJO_ARDOUR_SCRIPTS_DIR"
else
case "$(uname -s)" in
  Darwin) dojo_config="$HOME/Library/Preferences/Ardour9/scripts" ;;
  *)
    if [ -d "$HOME/.var/app/org.ardour.Ardour" ]; then
      dojo_config="$HOME/.var/app/org.ardour.Ardour/config/ardour9/scripts"
    else
      dojo_config="${XDG_CONFIG_HOME:-$HOME/.config}/ardour9/scripts"
    fi ;;
esac
fi
mkdir -p "$dojo_config"
for dojo_file in "$dojo_source/Dojo tools"/*.lua; do
  [ -f "$dojo_file" ] || continue
  dojo_name=$(basename "$dojo_file")
  if [ ! -e "$dojo_config/$dojo_name" ]; then
    cp "$dojo_file" "$dojo_config/$dojo_name"
  fi
done
printf 'Dojo tools installed in %s\nIn Ardour: Edit > Scripted Actions > Manage.\n' "$dojo_config"
'''
