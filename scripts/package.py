"""Build a portable source ZIP without local data or machine configuration."""
import hashlib
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]


def build():
    destination = ROOT / 'dist/MadDojo.zip'
    destination.parent.mkdir(exist_ok=True)
    paths = [ROOT / name for name in ('README.md', 'LICENSE', 'CONTRIBUTING.md', 'THIRD_PARTY.md', 'VERIFICATION.md', 'Start.command', 'Start.sh', 'Start.cmd', 'pyproject.toml', 'uv.lock', 'package.json', 'package-lock.json')]
    for name in ('backend', 'web', 'ardour/scripts', 'tests', 'scripts', 'packaging', 'desktop'):
        paths.extend(path for path in (ROOT / name).rglob('*') if path.is_file() and '__pycache__' not in path.parts and path.suffix != '.pyc')
    with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
        for path in sorted(paths):
            archive.write(path, Path('MadDojo') / path.relative_to(ROOT))
    destination.with_suffix('.zip.sha256').write_text(hashlib.sha256(destination.read_bytes()).hexdigest() + '  ' + destination.name + '\n')
    print(destination)
    return destination


if __name__ == '__main__':
    build()
