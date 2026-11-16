// Integration check: real electron-updater provider/download/hash validation.
// A local HTTP release feed simulates a newer version; no installed app changes.
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {copyFile, mkdtemp, rm, stat, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const {AppImageUpdater} = require('electron-updater');
const {NodeHttpExecutor} = require('builder-util');
const {ElectronHttpExecutor} = require('electron-updater/out/electronHttpExecutor');
const artifact = path.resolve(process.argv[2]);
const temporary = await mkdtemp(path.join(tmpdir(), 'maddojo-update-'));
const previous = process.env.APPIMAGE;
const hash = async file => {const h = createHash('sha512'); for await (const bytes of createReadStream(file)) h.update(bytes); return h.digest('base64');};
const digest = await hash(artifact), size = (await stat(artifact)).size;
let corrupt = true;
const server = createServer((request, response) => {
  if (request.url.startsWith('/release.AppImage')) {response.setHeader('Content-Length', size); createReadStream(artifact).pipe(response);}
  else {response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({version: '0.2.0-beta.1', files: [{url:'release.AppImage', sha512:corrupt ? Buffer.alloc(64).toString('base64') : digest, size}], path:'release.AppImage', sha512:corrupt ? Buffer.alloc(64).toString('base64') : digest, releaseDate:new Date().toISOString()}));}
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
try {
  await copyFile(artifact, path.join(temporary, 'installed.AppImage'));
  process.env.APPIMAGE = path.join(temporary, 'installed.AppImage');
  const config = path.join(temporary, 'app-update.yml');
  await writeFile(config, 'updaterCacheDirName: maddojo-update-smoke\n');
  const adapter = {version:'0.1.0', name:'MadDojo', isPackaged:true, appUpdateConfigPath:config, userDataPath:temporary, baseCachePath:temporary, whenReady:async () => {}, onQuit:() => {}, quit:() => {throw new Error('Test must not quit an installed app');}, relaunch:() => {throw new Error('Test must not relaunch an installed app');}};
  function updater() {
    const u = new AppImageUpdater(null, adapter);
    u.httpExecutor = new ElectronHttpExecutor();
    const transport = new NodeHttpExecutor();
    u.httpExecutor.createRequest = transport.createRequest.bind(transport);
    u.logger = null;
    u.setFeedURL({provider:'generic', url:`http://127.0.0.1:${server.address().port}`});
    u.autoDownload = false; u.autoInstallOnAppQuit = false;
    u.allowPrerelease = true; u.disableDifferentialDownload = true;
    return u;
  }
  const bad = updater();
  assert.ok(await bad.checkForUpdates());
  await assert.rejects(bad.downloadUpdate(), /sha512 checksum mismatch/i);
  corrupt = false;
  const good = updater();
  const result = await good.checkForUpdates();
  assert.equal(result.updateInfo.version, '0.2.0-beta.1');
  const [downloaded] = await good.downloadUpdate();
  assert.equal(await hash(downloaded), digest);
  assert.equal(await hash(process.env.APPIMAGE), digest);
  console.log('Updater integration passed: release discovery, corrupt-download rejection, verified download, and installed-file preservation');
} finally {
  await new Promise(resolve => server.close(resolve));
  if (previous === undefined) delete process.env.APPIMAGE; else process.env.APPIMAGE = previous;
  await rm(temporary, {recursive:true, force:true});
}
