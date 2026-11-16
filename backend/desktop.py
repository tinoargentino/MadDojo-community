"""Engine owned by the desktop app; no browser or terminal required."""
import argparse
import json
import os
from pathlib import Path
import socket
import sys
import threading
import time
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ready-file', type=Path, required=True)
    parser.add_argument('--port', type=int, default=47671)
    parser.add_argument('--parent-stdin', action='store_true')
    args = parser.parse_args()
    resources = Path(os.environ.get('DOJO_ENGINE_ROOT', Path(__file__).resolve().parents[2]))
    os.environ['PATH'] = str(resources / 'tools/bin') + os.pathsep + os.environ.get('PATH', '')
    os.environ['TORCH_HOME'] = str(resources / 'models')
    os.environ['PYTHONDONTWRITEBYTECODE'] = '1'
    cache = Path(os.environ.get('DOJO_CACHE', Path.home() / '.cache/MadDojo'))
    cache.mkdir(parents=True, exist_ok=True)
    os.environ['NUMBA_CACHE_DIR'] = str(cache / 'numba')
    listener = socket.socket()
    try:
        listener.bind(('127.0.0.1', args.port))
    except OSError:
        listener.bind(('127.0.0.1', 0))
    listener.listen(128)
    url = f'http://127.0.0.1:{listener.getsockname()[1]}'
    import uvicorn
    server = uvicorn.Server(uvicorn.Config('backend.app:app', log_level='info'))

    def ready():
        headers = {'Authorization': 'Bearer ' + os.environ.get('DOJO_DESKTOP_TOKEN', '')}
        for attempt in range(240):
            try:
                request = urllib.request.Request(url + '/api/health', headers=headers)
                with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=1) as response:
                    if json.load(response).get('app') == 'MadDojo':
                        temporary = args.ready_file.with_suffix('.tmp')
                        temporary.write_text(json.dumps({'url': url}), encoding='utf-8')
                        temporary.replace(args.ready_file)
                        return
            except (OSError, ValueError) as error:
                if attempt in {10, 60, 180}:
                    print(f'Engine readiness: {error}', file=sys.stderr, flush=True)
                time.sleep(.5)

    def parent_lifetime():
        # EOF also arrives if the app crashes; stop separation/download workers.
        sys.stdin.buffer.read()
        server.should_exit = True

    threading.Thread(target=ready, daemon=True).start()
    if args.parent_stdin:
        threading.Thread(target=parent_lifetime, daemon=True).start()
    try:
        server.run(sockets=[listener])
    finally:
        listener.close()
        args.ready_file.unlink(missing_ok=True)


if __name__ == '__main__':
    main()
