# Contributing

Use Python 3.11, uv, FFmpeg/FFprobe, and Node.js 24 for development.

```sh
uv sync --locked --python 3.11
uv run pytest -q
npm ci
npm test
uv run python scripts/start.py
```

Backend/frontend source tests run natively on Windows, Linux, and macOS.
Keep changes focused and include relevant verification in pull requests. Bugs
should include OS, version, reproduction steps, and redacted logs. Never attach
private songs, recordings, credentials, or your library database.

## Desktop builds

Build on the target OS; the engine includes native Python extensions.
Use a uv-managed standalone Python (`UV_MANAGED_PYTHON=1`). The desktop workflow
installs compiler dependencies and performs each build on a native runner.

1. Compile media tools with `packaging/desktop/build_ffmpeg.sh`, passing absolute
   paths to `dist/engine/tools` and a temporary build directory. Windows uses
   MSYS2 MINGW64. The build includes the exact FFmpeg/LAME sources and licenses.
2. Run `uv run --no-project --python 3.11 python scripts/build_engine.py`.
3. Run `npm ci` and `npm run desktop:pack`.
4. Run `node scripts/smoke_desktop.mjs` (Linux CI uses Xvfb).
5. Run `npm run desktop:dist` to generate native installers.

`npm run desktop` opens the development shell using the already built engine.
The renderer keeps its Chromium sandbox enabled. Do not disable it to work
around machine setup problems.

CPU PyTorch is bundled on purpose. Both official separation models are included;
there is no first-launch model download. User state and compiler caches must
never be written into the installed application's resources.

## Releases and updates

The Desktop installers workflow creates CI artifacts after packaged smoke tests.
It does not automatically publish unverified artifacts. Before a desktop
release, verify import/separation/playback, physical microphone recording,
file saving, close/relaunch, installation and replacement on each platform.

For signed production Mac builds, configure `CSC_LINK`, `CSC_KEY_PASSWORD`, and
Apple notarization credentials in the build environment. Windows signing also
needs a configured certificate or signing service. No credentials belong in
source. Unsigned preview builds must be labeled as such. Mac auto-update only
works for a properly signed app.

Keep package.json's version, release tag, binaries, blockmaps and update metadata
consistent. Publish the native installers and `latest*.yml` from the same build
together only after verification. Never regenerate updater metadata separately.
The source release workflow is independent of desktop releases.

Contributions use the MIT license. Dependencies keep their own licenses.
