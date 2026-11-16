import {spawn} from 'node:child_process';
import {mkdtemp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
const root = path.resolve('dist/desktop');
const executable = process.argv[2] || (process.platform === 'win32' ? path.join(root, 'win-unpacked/MadDojo.exe') : process.platform === 'darwin' ? path.join(root, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'MadDojo.app/Contents/MacOS/MadDojo') : path.join(root, 'linux-unpacked/maddojo'));
const temporary = await mkdtemp(path.join(tmpdir(), 'maddojo-desktop-'));
const child = spawn(executable, ['--smoke-test', '--user-data-dir='+path.join(temporary, 'profile')], {env: {...process.env, DOJO_DATA: path.join(temporary, 'library'), DOJO_INBOX: path.join(temporary, 'inbox')}, stdio: ['ignore', 'pipe', 'pipe']});
let output = '';
child.stdout.on('data', data => {output += data; process.stdout.write(data);});
child.stderr.on('data', data => process.stderr.write(data));
const timeout = setTimeout(() => {child.kill('SIGKILL');}, 150000);
try {
  const code = await new Promise((resolve, reject) => {child.on('error', reject); child.on('exit', resolve);});
  if (code !== 0 || !output.includes('DESKTOP_SMOKE_OK')) {
    try { console.error(await readFile(path.join(temporary, 'profile/logs/engine.log'), 'utf8')); } catch {}
    throw new Error(`Desktop smoke failed, exit ${code}`);
  }
  console.log('Packaged desktop startup, authenticated UI, audio APIs, isolation, and shutdown passed');
} finally {clearTimeout(timeout); await rm(temporary, {recursive: true, force: true});}
