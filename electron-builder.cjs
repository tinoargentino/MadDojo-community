const {version} = require('./package.json');
module.exports = {
  "appId": "com.maddojo.desktop",
  "productName": "MadDojo",
  "directories": {
    "output": "dist/desktop"
  },
  "files": [
    "desktop/**/*",
    "package.json",
    "LICENSE"
  ],
  "extraResources": [
    {
      "from": "dist/engine",
      "to": "engine"
    }
  ],
  "asar": true,
  "publish": [
    {
      "provider": "github",
      "owner": "tinoargentino",
      "repo": "MadDojo-community",
      "releaseType": "draft"
    }
  ],
  "artifactName": "MadDojo-${version}-${os}-${arch}.${ext}",
  "mac": {
    "target": [
      "dmg",
      "zip"
    ],
    "category": "public.app-category.music",
    "hardenedRuntime": true,
    "entitlements": "packaging/desktop/entitlements.mac.plist",
    "entitlementsInherit": "packaging/desktop/entitlements.mac.plist",
    "extendInfo": {
      "NSMicrophoneUsageDescription": "Record practice takes and show live pitch feedback."
    }
  },
  "win": {
    "target": [
      "nsis"
    ]
  },
  "nsis": {
    "oneClick": false,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": true,
    "deleteAppDataOnUninstall": false
  },
  "linux": {
    "target": [
      "AppImage",
      "deb"
    ],
    "category": "AudioVideo",
    "maintainer": "MadDojo contributors",
    "desktop": {
      "entry": {
        "StartupWMClass": "MadDojo"
      }
    },
    "syncDesktopName": true
  },
  "icon": "packaging/desktop/icon.png",
  "deb": {
    "compression": "gz"
  }
};
module.exports.publish[0].channel = version.includes('-') ? version.split('-')[1].split('.')[0] : 'latest';
