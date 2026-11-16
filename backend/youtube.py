"""Download one public YouTube video's audio in an isolated worker process."""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import shutil
import sys
from urllib.parse import parse_qs, urlparse

from . import library as lib


def youtube_url(value: str) -> str:
    parsed = urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or parsed.username or parsed.password or parsed.port:
        raise ValueError("Paste a YouTube video link")
    host = (parsed.hostname or "").lower()
    parts = parsed.path.strip("/").split("/")
    video = None
    if host == "youtu.be" and len(parts) == 1:
        video = parts[0]
    elif host in {"youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"}:
        if parsed.path == "/watch": video = parse_qs(parsed.query).get("v", [None])[0]
        elif len(parts) == 2 and parts[0] in {"shorts", "live", "embed"}: video = parts[1]
    if not video or not re.fullmatch(r"[A-Za-z0-9_-]{11}", video):
        raise ValueError("Paste a single YouTube video link, not a channel or playlist")
    return f"https://www.youtube.com/watch?v={video}"


def validate_video(info):
    if info.get("is_live") or info.get("live_status") in {"is_live", "is_upcoming"}:
        raise ValueError("Use a finished video, not a live stream")
    duration = info.get("duration")
    if not duration or not 1 <= duration <= 1200:
        raise ValueError("Choose a video between 1 second and 20 minutes")
    if info.get("filesize", 0) and info["filesize"] > lib.MAX_UPLOAD:
        raise ValueError("The audio download exceeds 512 MB")


def download_audio(url: str, folder: Path):
    from yt_dlp import YoutubeDL
    url = youtube_url(url)
    runtimes = {name: {} for name in ("deno", "node") if shutil.which(name)}
    if os.environ.get("DOJO_NODE_PATH"):
        runtimes["node"] = {"path": os.environ["DOJO_NODE_PATH"]}
    if not runtimes:
        raise ValueError("Install Deno or Node.js to import YouTube audio")
    options = {
        "format": "bestaudio/best", "noplaylist": True,
        "outtmpl": str(folder / "source.%(ext)s"),
        "quiet": True, "no_warnings": True, "noprogress": True,
        "socket_timeout": 20, "retries": 2, "fragment_retries": 2,
        "max_filesize": lib.MAX_UPLOAD, "cachedir": False,
        "js_runtimes": runtimes,
        "postprocessors": [{"key": "FFmpegExtractAudio", "preferredcodec": "wav"}],
    }
    with YoutubeDL(options) as downloader:
        info = downloader.extract_info(url, download=False)
        validate_video(info)
        downloaded = downloader.extract_info(url, download=True)
        validate_video(downloaded)
    output = folder / "source.wav"
    if not output.is_file():
        raise ValueError("YouTube audio was unavailable or exceeded the download limit")
    if output.stat().st_size > lib.MAX_UPLOAD:
        raise ValueError("Decoded audio exceeds 512 MB; choose a shorter video")
    return {"title": str(info.get("title") or "YouTube audio")[:200], "url": url}


if __name__ == "__main__":
    folder = Path(sys.argv[2])
    try:
        result = download_audio(sys.argv[1], folder)
        (folder / "result.json").write_text(json.dumps(result))
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)
