"""Small, aligned playback files; the native session always uses the WAVs."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import threading

from . import library as lib

STEMS = ("vocals", "backing")
REVISION = "mp3-192k-v1"
_lock = threading.Lock()


def preview_info(song_id: str) -> dict:
    folder = lib.DATA / "songs" / song_id
    digest = hashlib.sha256(REVISION.encode())
    for stem in STEMS:
        stat = (folder / f"{stem}.wav").stat()
        digest.update(f"{stem}:{stat.st_size}:{stat.st_mtime_ns}".encode())
    root = folder / "browser" / digest.hexdigest()[:16]
    return {"folder": root, "paths": {stem: root / f"{stem}.mp3" for stem in STEMS}}


def build_previews(song_id: str) -> dict:
    with _lock:
        song = lib.get_song(song_id)
        if not song or song["status"] != "ready":
            raise ValueError("Prepare the song before loading practice audio")
        info = preview_info(song_id)
        if all(path.is_file() for path in info["paths"].values()):
            return info
        source = lib.DATA / "songs" / song_id
        analysis = json.loads((source / "analysis.json").read_text())
        peak = max((max(analysis["waveforms"][stem], default=0) for stem in STEMS), default=1)
        # Keep the relative stem levels, with shared headroom for lossy encoding.
        gain = min(1.0, .9 / max(.9, peak))
        root = info["folder"]
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="encode-", dir=root) as staging:
            for stem in STEMS:
                output = Path(staging) / f"{stem}.mp3"
                subprocess.run(
                    ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source / f"{stem}.wav"),
                     "-map_metadata", "-1", "-vn", "-af", f"volume={gain:.9f}",
                     "-c:a", "libmp3lame", "-b:a", "192k", "-write_xing", "1", str(output)],
                    check=True, capture_output=True, timeout=180,
                )
            for stem in STEMS:
                (Path(staging) / f"{stem}.mp3").replace(info["paths"][stem])
        return info
