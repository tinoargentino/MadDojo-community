"""Exercise a relocated bundle without Python, FFmpeg, or Deno on PATH."""
import json
import io
import math
import struct
import wave
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request


def main():
    app = Path(sys.argv[1]).resolve()
    resources = app / 'Contents/Resources'
    python = resources / 'runtime/bin/python3.11'
    tools = resources / 'tools/bin'
    with tempfile.TemporaryDirectory(prefix='maddojo-bundle-test-') as temporary:
        temporary = Path(temporary)
        env = {**os.environ, 'PATH': str(tools) + ':/usr/bin:/bin', 'DOJO_DATA': str(temporary / 'data'), 'DOJO_INBOX': str(temporary / 'Inbox'), 'TORCH_HOME': str(resources / 'models'), 'PYTHONDONTWRITEBYTECODE': '1', 'NUMBA_CACHE_DIR': str(temporary / 'numba')}
        env.pop('PYTHONHOME', None); env.pop('PYTHONPATH', None)
        for tool in ('ffmpeg', 'ffprobe', 'deno'):
            subprocess.run([tools / tool, '-version' if tool != 'deno' else '--version'], env=env, check=True, stdout=subprocess.DEVNULL)
        # Both models must load without downloading anything on a friend's machine.
        subprocess.run([python, '-c', 'from demucs.pretrained import get_model; get_model("htdemucs"); get_model("htdemucs_6s"); import yt_dlp,librosa,soundfile,torch; print("Bundled dependencies and both models loaded")'], env=env, check=True)
        ready = temporary / 'ready'
        server = subprocess.Popen([python, '-m', 'backend.desktop', '--ready-file', ready], cwd=resources / 'app', env=env)
        try:
            for _ in range(240):
                if server.poll() is not None: raise RuntimeError('Bundled server stopped during startup')
                if ready.exists(): break
                time.sleep(.5)
            else: raise RuntimeError('Bundled server startup timed out')
            url = ready.read_text()
            with urllib.request.urlopen(url + '/api/library') as response: library = json.load(response)
            assert any(song['id'] == 'warmup' for song in library['songs'])
            with urllib.request.urlopen(url + '/api/songs/warmup/preview/backing') as response:
                assert response.status == 200 and response.read(3) != b''
            with urllib.request.urlopen(url) as response: assert b'MadDojo' in response.read()
            audio = io.BytesIO()
            with wave.open(audio, 'wb') as wav:
                wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(44100)
                wav.writeframes(b''.join(struct.pack('<h', int(6000 * math.sin(2 * math.pi * 220 * i / 44100))) for i in range(44100 * 3)))
            boundary = 'MadDojoBundleTest'
            body = (f'--{boundary}\r\nContent-Disposition: form-data; name="mode"\r\n\r\nguitar\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="bundle-test.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode() + audio.getvalue() + f'\r\n--{boundary}--\r\n'.encode()
            request = urllib.request.Request(url + '/api/import', data=body, headers={'Content-Type': f'multipart/form-data; boundary={boundary}'})
            with urllib.request.urlopen(request) as response: imported = json.load(response)['song']
            for _ in range(600):
                with urllib.request.urlopen(url + '/api/library') as response: songs = json.load(response)['songs']
                song = next(item for item in songs if item['id'] == imported['id'])
                if song['status'] == 'error': raise RuntimeError(song.get('error'))
                if song['status'] == 'ready': break
                time.sleep(.5)
            else: raise RuntimeError('Bundled guitar separation timed out')
            assert song['mode'] == 'guitar'
            with urllib.request.urlopen(url + f"/api/songs/{song['id']}/analysis") as response:
                analysis = json.load(response)
            assert analysis['mode'] == 'guitar' and analysis['separator'] == 'htdemucs_6s'
            print('Relocated bundle: real upload, guitar separation, analysis, API, UI, FFmpeg preview and both models verified')
        finally:
            server.terminate()
            server.wait(timeout=30)


if __name__ == '__main__':
    main()
