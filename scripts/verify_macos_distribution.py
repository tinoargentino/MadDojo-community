"""Check code integrity and Gatekeeper policy on a quarantined Mac download."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time
import uuid


def command(*args):
    try:
        result = subprocess.run([str(a) for a in args], capture_output=True, text=True, timeout=120)
        return {'exit_code': result.returncode, 'output': (result.stdout + result.stderr).strip()}
    except subprocess.TimeoutExpired:
        return {'exit_code': -1, 'output': 'Assessment timed out'}


def assess(app):
    quarantine = f'0083;{int(time.time()):x};Chrome;{uuid.uuid4()}'
    subprocess.run(['xattr', '-w', 'com.apple.quarantine', quarantine, str(app)], check=True)
    results = {
        'signature': command('codesign', '--verify', '--deep', '--strict', '--verbose=4', app),
        'identity': command('codesign', '--display', '--verbose=4', app),
        'gatekeeper': command('spctl', '--assess', '--type', 'execute', '--verbose=4', app),
        'stapled_ticket': command('xcrun', 'stapler', 'validate', app),
    }
    if shutil.which('syspolicy_check'):
        results['distribution'] = command('syspolicy_check', 'distribution', app)
    results['signature_valid'] = results['signature']['exit_code'] == 0
    results['developer_id_signed'] = 'Authority=Developer ID Application:' in results['identity']['output']
    results['gatekeeper_accepted'] = results['gatekeeper']['exit_code'] == 0
    results['distribution_ready'] = (results['signature_valid'] and results['developer_id_signed']
                                     and results['gatekeeper_accepted'] and results['stapled_ticket']['exit_code'] == 0
                                     and results.get('distribution', {'exit_code': 0})['exit_code'] == 0)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--app', type=Path)
    source.add_argument('--dmg', type=Path)
    parser.add_argument('--sha256')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--require-gatekeeper', action='store_true')
    parser.add_argument('--report-only', action='store_true')
    args = parser.parse_args()
    if sys.platform != 'darwin': parser.error('Run on macOS')
    with tempfile.TemporaryDirectory(prefix='maddojo-distribution-') as temporary:
        temporary = Path(temporary)
        if args.dmg:
            if not args.sha256: parser.error('A downloaded DMG requires its published SHA-256')
            with args.dmg.open('rb') as handle:
                digest = hashlib.file_digest(handle, 'sha256').hexdigest()
            if digest != args.sha256: raise SystemExit('Downloaded DMG does not match its published checksum')
            volume = temporary / 'volume'
            volume.mkdir()
            subprocess.run(['hdiutil', 'attach', str(args.dmg.resolve()), '-readonly', '-nobrowse', '-mountpoint', str(volume)], check=True)
            app = temporary / 'MadDojo.app'
            try:
                subprocess.run(['ditto', str(volume / 'MadDojo.app'), str(app)], check=True)
            finally:
                subprocess.run(['hdiutil', 'detach', str(volume)], check=True)
        else:
            app = args.app.resolve()
        results = assess(app)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(results, indent=2))
        if not args.report_only:
            if not results['signature_valid']: raise SystemExit('Mac code signature is invalid; do not distribute this app')
            if args.require_gatekeeper and not results['distribution_ready']:
                raise SystemExit('Mac distribution requires Developer ID signing, notarization, a stapled ticket, and Gatekeeper acceptance')


if __name__ == '__main__':
    main()
