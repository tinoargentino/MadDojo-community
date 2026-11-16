const {app, BrowserWindow, Menu, dialog, shell, session, systemPreferences} = require('electron');
const {spawn, spawnSync} = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {isLocalURL, isExternalURL, runtimePaths} = require('./policy.cjs');
const {autoUpdater} = require('electron-updater');
let window, child, origin, stopping = false, stopPromise, startupTimer;
let updateAvailable = false, downloaded = false;
const token = crypto.randomBytes(32).toString('hex');
const smoke = process.argv.includes('--smoke-test');
if (smoke) app.commandLine.appendSwitch('use-fake-device-for-media-stream');
let engineExited = false;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
app.setName('MadDojo');
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(start).catch(fail);
}
function fail(error) {
  if (stopping) return;
  console.error(error);
  if (!smoke) dialog.showErrorBox('MadDojo could not start', `${error.message}\n\nUse Help → Open logs for details, or try reopening the app.`);
  process.exitCode = 1;
  app.quit();
}
async function stopEngine() {
  if (stopPromise) return stopPromise;
  stopPromise = (async () => {
    clearTimeout(startupTimer);
    if (!child || engineExited) return;
    child.stdin.end(); // The engine shuts down workers when its parent closes stdin.
    for (let i = 0; i < 100 && !engineExited; i++) await delay(100);
    if (!engineExited) {
      if (process.platform === 'win32') {
        await new Promise(resolve => {
          const task = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {windowsHide: true});
          task.once('exit', resolve); task.once('error', resolve);
        });
      } else child.kill('SIGKILL');
    }
  })();
  return stopPromise;
}
app.on('before-quit', event => {
  if (stopping) return;
  event.preventDefault(); stopping = true;
  stopEngine().finally(() => app.quit());
});
app.on('window-all-closed', () => app.quit());
function supportsUpdates() {
  if (!app.isPackaged) return false;
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE);
  if (process.platform === 'darwin') {
    const signature = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', process.execPath], {encoding: 'utf8'});
    return signature.status === 0 && /Authority=Developer ID Application:/.test(signature.stderr);
  }
  return true;
}
function updateMenu() {
  const updateLabel = downloaded ? 'Restart to install update…' : updateAvailable ? 'Download update…' : 'Check for updates…';
  const template = [
    ...(process.platform === 'darwin' ? [{label: app.name, submenu: [{role: 'about'}, {type: 'separator'}, {role: 'quit'}]}] : []),
    {label: 'File', submenu: [{label: 'Open library folder', click: () => shell.openPath(libraryPath())}, {type: 'separator'}, {role: 'quit'}]},
    {label: 'Edit', submenu: [{role: 'undo'}, {role: 'redo'}, {type: 'separator'}, {role: 'cut'}, {role: 'copy'}, {role: 'paste'}, {role: 'selectAll'}]},
    {label: 'View', submenu: [{role: 'resetZoom'}, {role: 'zoomIn'}, {role: 'zoomOut'}, {role: 'togglefullscreen'}]},
    {label: 'Help', submenu: [
      {label: updateLabel, click: () => checkUpdate()},
      {label: 'Open logs', click: () => shell.openPath(app.getPath('logs'))},
      {label: 'Report a problem', click: () => shell.openExternal('https://github.com/tinoargentino/MadDojo-community/issues')},
      {label: 'About MadDojo', click: () => dialog.showMessageBox(window, {message: `MadDojo ${app.getVersion()}`, detail: 'Music practice on your computer. MIT licensed.\nSongs and recordings stay in your local library.'})},
    ]},
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function libraryPath() {
  if (process.env.DOJO_DATA) return process.env.DOJO_DATA;
  for (const name of ['vocal-dojo', 'maddojo']) {
    const old = path.join(app.getPath('home'), '.local', 'share', name);
    if (fs.existsSync(old)) return old;
  }
  return path.join(app.getPath('userData'), 'Library');
}
async function checkUpdate() {
  if (!supportsUpdates()) {
    return dialog.showMessageBox(window, {message: 'Updates are available from MadDojo releases', detail: 'This installation uses manual updates.', buttons: ['Close', 'Open releases']}).then(({response}) => {
      if (response === 1) shell.openExternal('https://github.com/tinoargentino/MadDojo-community/releases');
    });
  }
  if (downloaded) {
    const {response} = await dialog.showMessageBox(window, {message: 'Install update and restart?', detail: 'Finish and save your current take before restarting.', buttons: ['Cancel', 'Restart'], defaultId: 0, cancelId: 0});
    if (response === 1) { stopping = true; await stopEngine(); autoUpdater.quitAndInstall(); }
    return;
  }
  try {
    if (updateAvailable) await autoUpdater.downloadUpdate();
    else {
      const result = await autoUpdater.checkForUpdates();
      if (!result || !updateAvailable) await dialog.showMessageBox(window, {message: 'MadDojo is up to date'});
    }
  } catch (error) { await dialog.showMessageBox(window, {type: 'error', message: 'Could not check or download updates', detail: `${error.message}\nYou can retry from Help.`}); }
}
function configureUpdates() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('error', error => console.error('Updater:', error.message));
  autoUpdater.on('update-available', info => {
    updateAvailable = true; updateMenu();
    dialog.showMessageBox(window, {message: `MadDojo ${info.version} is available`, detail: 'Download it from Help → Download update. Installation happens only when you choose to restart.'});
  });
  autoUpdater.on('update-downloaded', () => { downloaded = true; updateMenu(); dialog.showMessageBox(window, {message: 'Update ready', detail: 'Finish your practice, then choose Help → Restart to install update.'}); });
  if (supportsUpdates() && !smoke) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(error => console.error(error.message)), 10000).unref();
  }
}
async function start() {
  fs.mkdirSync(app.getPath('logs'), {recursive: true});
  const log = fs.openSync(path.join(app.getPath('logs'), 'engine.log'), 'a');
  const root = app.isPackaged ? path.join(process.resourcesPath, 'engine') : path.resolve(__dirname, '../dist/engine');
  const runtime = runtimePaths(root);
  if (!fs.existsSync(runtime.python)) throw new Error('The bundled engine is missing. Please reinstall MadDojo.');
  const readyFile = path.join(app.getPath('userData'), 'engine-ready.json');
  const portFile = path.join(app.getPath('userData'), 'engine-port');
  fs.rmSync(readyFile, {force: true});
  fs.mkdirSync(libraryPath(), {recursive: true});
  const env = {...process.env, DOJO_DATA: libraryPath(), DOJO_DESKTOP_TOKEN: token,
    DOJO_ENGINE_ROOT: root, DOJO_CACHE: path.join(app.getPath('userData'), 'Cache'),
    DOJO_NODE_PATH: process.execPath, ELECTRON_RUN_AS_NODE: '1', PYTHONUTF8: '1', PYTHONDONTWRITEBYTECODE: '1'};
  delete env.PYTHONHOME; delete env.PYTHONPATH;
  const port = Number(fs.existsSync(portFile) ? fs.readFileSync(portFile, 'utf8') : '47671');
  child = spawn(runtime.python, ['-m', 'backend.desktop', '--ready-file', readyFile, '--port', String(port), '--parent-stdin'], {cwd: runtime.app, env, windowsHide: true, stdio: ['pipe', log, log]});
  fs.closeSync(log);
  child.on('error', fail);
  child.on('exit', (code) => { engineExited = true; if (!stopping) fail(new Error(`The practice engine stopped (${code}). See engine.log.`)); });
  updateMenu();
  window = new BrowserWindow({width: 1360, height: 900, minWidth: 820, minHeight: 600, show: false, backgroundColor: '#f4f1e8', title: 'MadDojo', webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: false}});
  window.on('close', event => {
    if (!stopping && !smoke) {
      const response = dialog.showMessageBoxSync(window, {message: 'Quit MadDojo?', detail: 'Finish and save any recording before quitting.', buttons: ['Keep practicing', 'Quit'], defaultId: 0, cancelId: 0});
      if (response !== 1) event.preventDefault();
    }
  });
  window.webContents.setWindowOpenHandler(({url}) => {
    if (isLocalURL(url, origin)) window.webContents.downloadURL(url);
    else if (isExternalURL(url)) shell.openExternal(url);
    return {action: 'deny'};
  });
  window.webContents.on('will-navigate', (event, url) => { if (!isLocalURL(url, origin)) event.preventDefault(); });
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((contents, permission, requestingOrigin, details) => contents === window.webContents && isLocalURL(requestingOrigin, origin) && permission === 'media' && (!details.mediaType || details.mediaType === 'audio'));
  ses.setPermissionRequestHandler(async (contents, permission, callback, details) => {
    if (contents !== window.webContents || permission !== 'media' || !isLocalURL(details.requestingUrl, origin) || details.mediaTypes?.some(type => type !== 'audio')) return callback(false);
    if (smoke) return callback(true);
    if (process.platform === 'darwin') return callback(await systemPreferences.askForMediaAccess('microphone'));
    const {response} = await dialog.showMessageBox(window, {message: 'Allow microphone access?', detail: 'MadDojo uses your microphone for practice takes and pitch feedback.', buttons: ['Allow', 'Cancel'], defaultId: 0, cancelId: 1});
    callback(response === 0);
  });
  ses.on('will-download', (_event, item) => {
    item.setSaveDialogOptions({title: 'Save from MadDojo', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename()))});
    item.once('done', (_e, state) => { if (state !== 'completed') dialog.showMessageBox(window, {type: 'error', message: 'Download did not finish', detail: 'Try saving the file again.'}); });
  });
  // Show a local startup page while the engine initializes; no remote content loads.
  await window.loadFile(path.join(__dirname, 'starting.html'));
  window.show();
  for (let i = 0; i < 240; i++) {
    if (stopping) return;
    if (fs.existsSync(readyFile)) {
      const ready = JSON.parse(fs.readFileSync(readyFile, 'utf8'));
      const url = new URL(ready.url);
      if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:') throw new Error('Invalid engine address');
      origin = url.origin;
      fs.writeFileSync(portFile, url.port);
      await ses.cookies.set({url: origin, name: 'maddojo-session', value: token, httpOnly: true, sameSite: 'strict', path: '/'});
      await window.loadURL(origin);
      configureUpdates();
      if (smoke) {
        const result = await window.webContents.executeJavaScript(`fetch('api/health').then(r => r.json()).then(h => ({health:h.app, title:document.title, audio:!!window.AudioContext, media:!!navigator.mediaDevices, node:typeof require}))`);
        if (result.health !== 'MadDojo' || !result.audio || !result.media || result.node !== 'undefined') throw new Error('Desktop renderer smoke failed: '+JSON.stringify(result));
        const recording = await window.webContents.executeJavaScript(`(async () => {
          const stream = await navigator.mediaDevices.getUserMedia({audio:true});
          const recorder = new MediaRecorder(stream); const chunks = [];
          const saved = new Promise(resolve => {recorder.ondataavailable = e => chunks.push(e.data); recorder.onstop = () => resolve(chunks.reduce((n,c) => n+c.size,0));});
          recorder.start(); await new Promise(r => setTimeout(r,400)); recorder.stop();
          const bytes = await saved; stream.getTracks().forEach(t => t.stop()); return bytes;
        })()`);
        if (!recording) throw new Error('Synthetic microphone recording failed');
        console.log('DESKTOP_SMOKE_OK', JSON.stringify({...result, recordedBytes:recording}));
        app.quit();
      }
      return;
    }
    await delay(500);
  }
  throw new Error('The practice engine took too long to start. Please reopen MadDojo.');
}
