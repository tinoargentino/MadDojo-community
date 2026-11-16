"""Start a local MadDojo copy: uv run python scripts/start.py."""
import argparse
import os
from pathlib import Path
import shutil
import socket
import threading
import time
import urllib.request
import webbrowser


def main():
    parser = argparse.ArgumentParser(description="Start MadDojo on this computer")
    parser.add_argument('--port', type=int, default=8767)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error('Port must be between 1 and 65535')
    for binary in ('ffmpeg', 'ffprobe'):
        if not shutil.which(binary):
            parser.error('Install FFmpeg first (ffmpeg and ffprobe must be on PATH)')
    with socket.socket() as probe:
        try:
            probe.bind(('127.0.0.1', args.port))
        except OSError:
            parser.error(f'Port {args.port} is already in use; choose another with --port')
    url = f'http://127.0.0.1:{args.port}'
    def open_when_ready():
        for _ in range(120):
            try:
                with urllib.request.urlopen(url + '/api/health', timeout=1) as response:
                    if response.status == 200:
                        webbrowser.open(url)
                        return
            except OSError:
                time.sleep(.5)
    if not args.no_browser:
        threading.Thread(target=open_when_ready, daemon=True).start()
    print(f'MadDojo: {url} — Ctrl+C stops the server', flush=True)
    os.chdir(Path(__file__).resolve().parents[1])
    try:
        import sys
        import uvicorn
        sys.path.insert(0, str(Path.cwd()))
        uvicorn.run('backend.app:app', host='127.0.0.1', port=args.port)
        return 0
    except KeyboardInterrupt:
        return 0


if __name__ == '__main__':
    raise SystemExit(main())
