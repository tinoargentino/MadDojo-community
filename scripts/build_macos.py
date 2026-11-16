"""Build the self-contained Apple Silicon app on a native macOS runner."""
import hashlib
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import subprocess
import sys
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def run(*args, **kwargs):
    subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def build():
    if sys.platform != 'darwin' or platform.machine() != 'arm64':
        raise SystemExit('Build on an Apple Silicon Mac (or run the Build Mac app GitHub workflow)')
    work = ROOT / 'dist/macos-build'
    if work.exists(): shutil.rmtree(work)
    contents = work / 'MadDojo.app/Contents'
    resources = contents / 'Resources'
    app = resources / 'app'
    app.mkdir(parents=True)
    for name in ('backend', 'web', 'ardour'):
        shutil.copytree(ROOT / name, app / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
    runtime = resources / 'runtime'
    shutil.copytree(Path(sys.base_prefix), runtime, symlinks=False, ignore=shutil.ignore_patterns('__pycache__'))
    python = runtime / 'bin/python3.11'
    requirements = work / 'requirements.txt'
    run('uv', 'export', '--locked', '--no-dev', '--no-hashes', '--no-emit-project', '--format', 'requirements-txt', '-o', requirements, stdout=subprocess.DEVNULL)
    run('uv', 'pip', 'install', '--python', python, '--target', runtime / 'lib/python3.11/site-packages', '--no-deps', '--link-mode', 'copy', '-r', requirements)
    tools = resources / 'tools'
    run('bash', ROOT / 'packaging/macos/build_ffmpeg.sh', tools, work / 'ffmpeg-build', stdout=subprocess.DEVNULL)
    deno = work / 'deno.zip'
    urllib.request.urlretrieve('https://github.com/denoland/deno/releases/download/v2.9.8/deno-aarch64-apple-darwin.zip', deno)
    assert hashlib.sha256(deno.read_bytes()).hexdigest() == '9f0bf660393da2eaff044cdc7444cb08c73f235849b61d224d825a194ce7c98e'
    with zipfile.ZipFile(deno) as archive:
        (tools / 'bin/deno').write_bytes(archive.read('deno'))
    (tools / 'bin/deno').chmod(0o755)
    notices = resources / 'Third-party notices'
    notices.mkdir()
    urllib.request.urlretrieve('https://raw.githubusercontent.com/denoland/deno/v2.9.8/LICENSE.md', notices / 'Deno-LICENSE.md')
    urllib.request.urlretrieve('https://raw.githubusercontent.com/facebookresearch/demucs/main/LICENSE', notices / 'Demucs-LICENSE')
    shutil.copy2(ROOT / 'packaging/macos/build_ffmpeg.sh', tools / 'third-party-sources/build_ffmpeg.sh')
    (notices / 'README.txt').write_text('Python and package licenses are preserved in runtime and its site-packages distribution metadata. FFmpeg and LAME exact source archives, licenses, and build recipe are in tools/third-party-sources. Deno: https://github.com/denoland/deno/tree/v2.9.8. Demucs: https://github.com/facebookresearch/demucs.\n')
    env = {**os.environ, 'TORCH_HOME': str(resources / 'models'), 'PYTHONDONTWRITEBYTECODE': '1'}
    run(python, ROOT / 'scripts/prepare_model.py', '--guitar', env=env)
    native = contents / 'MacOS'
    native.mkdir()
    run('swiftc', '-O', '-target', 'arm64-apple-macosx15.0', ROOT / 'packaging/macos/Launcher.swift', '-o', native / 'MadDojo', '-framework', 'Cocoa')
    with (contents / 'Info.plist').open('wb') as handle:
        plistlib.dump({'CFBundleName': 'MadDojo', 'CFBundleDisplayName': 'MadDojo', 'CFBundleIdentifier': 'com.maddojo.desktop', 'CFBundleExecutable': 'MadDojo', 'CFBundlePackageType': 'APPL', 'CFBundleShortVersionString': '0.1.0', 'CFBundleVersion': '1', 'LSMinimumSystemVersion': '15.0', 'LSUIElement': True, 'NSHighResolutionCapable': True}, handle)
    # Verify media tools do not depend on the build machine's Homebrew libraries.
    for executable in ('ffmpeg', 'ffprobe', 'deno'):
        deps = subprocess.check_output(['otool', '-L', str(tools / 'bin' / executable)], text=True)
        if '/opt/homebrew/' in deps or '/usr/local/' in deps:
            raise RuntimeError(f'{executable} has external dependencies: {deps}')
    # Relocation is tested with a minimal PATH, before signing/archive creation.
    relocated = ROOT / 'dist/relocation test/MadDojo.app'
    relocated.parent.mkdir(exist_ok=True)
    if relocated.exists(): shutil.rmtree(relocated)
    shutil.move(str(contents.parent), relocated)
    run(sys.executable, ROOT / 'scripts/smoke_macos_bundle.py', relocated)
    # Sign inside-out, including native Python extensions. This is ad-hoc, not notarization.
    for path in sorted(relocated.rglob('*'), key=lambda p: len(p.parts), reverse=True):
        if path.is_file() and path.open('rb').read(4) in (bytes.fromhex('cffaedfe'), bytes.fromhex('cafebabe')):
            run('codesign', '--force', '--sign', '-', path, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    run('codesign', '--force', '--deep', '--sign', '-', relocated)
    run('codesign', '--verify', '--deep', '--strict', relocated)
    output = ROOT / 'dist/MadDojo-macOS-AppleSilicon.zip'
    if output.exists(): output.unlink()
    run('ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', relocated, output)
    print(output, flush=True)


if __name__ == '__main__':
    build()
