const path = require('node:path');
function isLocalURL(value, origin) {
  try { return new URL(value).origin === origin; } catch { return false; }
}
function isExternalURL(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; }
  catch { return false; }
}
function runtimePaths(root, platform = process.platform) {
  return {
    python: path.join(root, 'runtime', ...(platform === 'win32' ? ['python.exe'] : ['bin', 'python3.11'])),
    app: path.join(root, 'app'), tools: path.join(root, 'tools', 'bin'), models: path.join(root, 'models'),
  };
}
module.exports = {isLocalURL, isExternalURL, runtimePaths};
