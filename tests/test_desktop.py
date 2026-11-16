"""Exercise the real desktop engine process, including Windows socket handling."""
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.error
import urllib.request


def test_desktop_engine_startup_and_parent_exit(tmp_path):
    root = Path(__file__).resolve().parents[1]
    ready = tmp_path / 'ready.json'
    env = os.environ | {'DOJO_DATA': str(tmp_path / 'library'), 'DOJO_INBOX': str(tmp_path / 'inbox'),
                        'DOJO_CACHE': str(tmp_path / 'cache'), 'DOJO_ENGINE_ROOT': str(tmp_path),
                        'DOJO_DESKTOP_TOKEN': 'startup-test-session', 'PYTHONUTF8': '1',
                        'PYTHONUNBUFFERED': '1', 'DOJO_DIAGNOSTICS': '1'}
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with (tmp_path / 'engine.log').open('w', encoding='utf-8') as log:
        child = subprocess.Popen([sys.executable, '-m', 'backend.desktop', '--ready-file', str(ready), '--port', '0', '--parent-stdin'], cwd=root, env=env, stdin=subprocess.PIPE, stdout=log, stderr=log)
        try:
            for _ in range(160):
                if ready.exists(): break
                assert child.poll() is None, (tmp_path / 'engine.log').read_text(encoding='utf-8')
                time.sleep(.25)
            assert ready.exists(), (tmp_path / 'engine.log').read_text(encoding='utf-8')
            url = json.loads(ready.read_text(encoding='utf-8'))['url'] + '/api/health'
            try:
                opener.open(url, timeout=3)
                raise AssertionError('Engine accepted a request without its session')
            except urllib.error.HTTPError as error:
                assert error.code == 403
            with opener.open(urllib.request.Request(url, headers={'Authorization':'Bearer startup-test-session'}), timeout=3) as response:
                assert json.load(response)['app'] == 'MadDojo'
        finally:
            child.stdin.close()
            try: child.wait(timeout=15)
            except subprocess.TimeoutExpired: child.kill(); child.wait(); raise
        assert child.returncode == 0
        assert not ready.exists()
