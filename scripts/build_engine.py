"""Build a relocatable native CPU engine. Run with uv-managed Python 3.11.

FFmpeg tools must first be built into dist/engine/tools using the included recipe.
No tools or Python are needed on the end user's machine.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def run(*args, **kwargs):
    subprocess.run([str(a) for a in args], check=True, **kwargs)


def build():
    engine = ROOT / 'dist/engine'
    tools = engine / 'tools/bin'
    suffix = '.exe' if os.name == 'nt' else ''
    for name in ['ffmpeg', 'ffprobe']:
        if not (tools / (name + suffix)).is_file():
            raise SystemExit('Build bundled FFmpeg/FFprobe first (see desktop workflow).')
    runtime = engine / 'runtime'
    if runtime.exists():
        shutil.rmtree(runtime)
    shutil.copytree(Path(sys.base_prefix), runtime, symlinks=False,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    python = runtime / ('python.exe' if os.name == 'nt' else 'bin/python3.11')
    # Get the actual site-packages path for each portable runtime layout.
    site = Path(subprocess.check_output([str(python), '-c', 'import sysconfig; print(sysconfig.get_path("purelib"))'], text=True).strip())
    if not site.is_relative_to(runtime):
        raise RuntimeError('Python runtime is not relocatable')
    requirements = engine / 'requirements.txt'
    run('uv', 'export', '--locked', '--no-dev', '--no-hashes', '--no-emit-project', '-o', requirements)
    # Desktop CPU wheels keep installers small and avoid a CUDA driver dependency.
    lines = [line for line in requirements.read_text(encoding='utf-8').splitlines()
             if not line.startswith(('torch==', 'torchaudio==', 'triton==', 'nvidia-'))]
    requirements.write_text('\n'.join(lines) + '\n', encoding='utf-8')
    run('uv', 'pip', 'install', '--python', python, '--target', site, '--no-deps', '--link-mode', 'copy', '-r', requirements)
    torch_args = ['--index-url', 'https://download.pytorch.org/whl/cpu'] if sys.platform != 'darwin' else []
    run('uv', 'pip', 'install', '--python', python, '--target', site, '--link-mode', 'copy', '--reinstall', '--no-deps', 'torch==2.5.1', 'torchaudio==2.5.1', *torch_args)
    app = engine / 'app'
    if app.exists(): shutil.rmtree(app)
    app.mkdir()
    for name in ['backend', 'web', 'ardour']:
        shutil.copytree(ROOT / name, app / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    notices = engine / 'notices'
    notices.mkdir(exist_ok=True)
    for name in ['LICENSE', 'THIRD_PARTY.md']:
        shutil.copy2(ROOT / name, notices / name)
    shutil.copy2(ROOT / 'packaging/desktop/build_ffmpeg.sh', engine / 'tools/third-party-sources/build_ffmpeg.sh')
    env = os.environ | {'TORCH_HOME': str(engine / 'models'), 'PYTHONUTF8': '1', 'PYTHONDONTWRITEBYTECODE': '1'}
    run(python, ROOT / 'scripts/prepare_model.py', '--guitar', env=env)
    run(python, '-c', 'import torch, torchaudio, librosa, soundfile, fastapi, yt_dlp; print("Engine dependencies OK", torch.__version__)')
    for name in ['ffmpeg', 'ffprobe']:
        run(tools / (name + suffix), '-version', stdout=subprocess.DEVNULL)
    print(f'Engine bundled: {engine}')


if __name__ == '__main__':
    build()
