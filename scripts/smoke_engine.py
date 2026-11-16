"""Exercise a relocated desktop engine with real bundled CPU separation."""
import io
import json
import math
import os
from pathlib import Path
import secrets
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import wave

engine = Path(sys.argv[1]).resolve()
python = engine / ('runtime/python.exe' if os.name == 'nt' else 'runtime/bin/python3.11')
with tempfile.TemporaryDirectory(prefix='maddojo-engine-check-') as tmp:
    tmp = Path(tmp)
    token = secrets.token_hex(24)
    env = {**os.environ, 'DOJO_ENGINE_ROOT': str(engine), 'DOJO_DATA': str(tmp / 'Library'),
           'DOJO_INBOX': str(tmp / 'Inbox'), 'DOJO_CACHE': str(tmp / 'Cache'),
           'DOJO_DESKTOP_TOKEN': token, 'DOJO_DIAGNOSTICS': '1', 'PYTHONUTF8': '1', 'PYTHONDONTWRITEBYTECODE': '1',
           'PATH': str(engine / 'tools/bin') + os.pathsep + (os.environ.get('SYSTEMROOT', '') + '/System32' if os.name == 'nt' else '/usr/bin:/bin')}
    env.pop('PYTHONHOME', None)
    env.pop('PYTHONPATH', None)
    with (tmp / 'engine.log').open('w', encoding='utf-8') as log:
        child = subprocess.Popen([str(python), '-m', 'backend.desktop', '--ready-file', str(tmp / 'ready'), '--port', '0', '--parent-stdin'], cwd=engine / 'app', env=env, stdin=subprocess.PIPE, stdout=log, stderr=log)
        try:
            for _ in range(240):
                if (tmp / 'ready').exists(): break
                if child.poll() is not None: raise RuntimeError((tmp / 'engine.log').read_text(encoding='utf-8'))
                time.sleep(.5)
            else: raise RuntimeError('Engine startup timeout')
            base = json.loads((tmp / 'ready').read_text(encoding='utf-8'))['url']
            try:
                urllib.request.build_opener(urllib.request.ProxyHandler({})).open(base + '/api/health')
                raise AssertionError('Engine accepted an unauthenticated request')
            except urllib.error.HTTPError as error:
                assert error.code == 403

            def request(route, body=None, content_type=None):
                headers = {'Authorization': 'Bearer ' + token}
                if content_type: headers['Content-Type'] = content_type
                with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(urllib.request.Request(base + route, body, headers), timeout=30) as response:
                    return response.read()

            stream = io.BytesIO()
            with wave.open(stream, 'wb') as audio:
                audio.setnchannels(1); audio.setsampwidth(2); audio.setframerate(22050)
                audio.writeframes(b''.join(struct.pack('<h', int(6000 * math.sin(2 * math.pi * 220 * i / 22050))) for i in range(44100)))
            boundary = secrets.token_hex(12)
            body = (f'--{boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\nguitar\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="desktop-check.wav"\r\nContent-Type: audio/wav\r\n\r\n'.encode() + stream.getvalue() + f'\r\n--{boundary}--\r\n'.encode())
            imported = json.loads(request('/api/import', body, 'multipart/form-data; boundary=' + boundary))
            song_id = imported['song']['id']
            for _ in range(600):
                song = next(s for s in json.loads(request('/api/library'))['songs'] if s['id'] == song_id)
                if song['status'] == 'error': raise RuntimeError(song.get('error'))
                if song['status'] == 'ready': break
                time.sleep(.5)
            else: raise RuntimeError('Separation timeout')
            analysis = json.loads(request(f'/api/songs/{song_id}/analysis'))
            assert 1.9 <= analysis['duration'] <= 2.1
            assert request(f'/api/songs/{song_id}/audio/backing')[:4] == b'RIFF'
            assert len(request(f'/api/songs/{song_id}/preview/vocals')) > 100
            assert request(f'/api/songs/{song_id}/ardour')[:2] == b'PK'
            print('Bundled engine: authenticated startup, real guitar separation, WAV, MP3, and Ardour export passed')
        except Exception:
            for report in (tmp / 'Library/songs').glob('*/preparation.log'):
                print(report.read_text(encoding='utf-8', errors='replace')[-8000:], file=sys.stderr)
            print((tmp / 'engine.log').read_text(encoding='utf-8', errors='replace'), file=sys.stderr)
            raise
        finally:
            child.stdin.close()
            try: child.wait(timeout=20)
            except subprocess.TimeoutExpired: child.kill(); child.wait(); raise
            assert child.returncode == 0, child.returncode
