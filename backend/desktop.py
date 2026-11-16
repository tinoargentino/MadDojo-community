"""Local server entry point for the self-contained desktop launcher."""
import argparse
import json
import os
from pathlib import Path
import socket
import threading
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ready-file', type=Path, required=True)
    args = parser.parse_args()
    resources = Path(__file__).resolve().parents[2]
    os.environ['PATH'] = str(resources / 'tools/bin') + os.pathsep + os.environ.get('PATH', '')
    os.environ['TORCH_HOME'] = str(resources / 'models')
    os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
    cache = Path.home() / 'Library/Caches/MadDojo'
    cache.mkdir(parents=True, exist_ok=True)
    os.environ['NUMBA_CACHE_DIR'] = str(cache / 'numba')
    with socket.socket() as listener:
        try:
            listener.bind(('127.0.0.1', 8767))
        except OSError:
            listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    url = f'http://127.0.0.1:{port}'
    def ready():
        for _ in range(240):
            try:
                with urllib.request.urlopen(url + '/api/health', timeout=1) as response:
                    if json.load(response).get('app') == 'MadDojo':
                        args.ready_file.write_text(url)
                        return
            except (OSError, ValueError):
                time.sleep(.5)
    threading.Thread(target=ready, daemon=True).start()
    import uvicorn
    uvicorn.run('backend.app:app', host='127.0.0.1', port=port, log_level='warning')


if __name__ == '__main__':
    main()
