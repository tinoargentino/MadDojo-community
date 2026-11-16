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

Build on the target OS; the engine includes native Python extensions. A paid
Apple membership is not needed for development or internal ad-hoc Mac builds;
it is needed for Developer ID/notarization used by trusted public Mac releases.
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

The Desktop installers workflow creates CI artifacts after packaged smoke and
installer checks. With its Publish option enabled, or on a matching `v*` tag,
it publishes a complete release only after all three native jobs succeed. Update
metadata is uploaded alongside its binaries while the release is still a draft. Before a stable desktop
release, verify import/separation/playback, physical microphone recording,
file saving, close/relaunch, installation and replacement on each platform.

For signed production Mac builds, configure repository secrets `MAC_CSC_LINK`,
`MAC_CSC_KEY_PASSWORD`, `APPLE_API_KEY_BASE64`, `APPLE_API_KEY_ID`, and
`APPLE_API_ISSUER`. Windows uses `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`.
The Mac API key is decoded to a temporary runner file. Trusted public Mac releases require Developer ID signing and notarization.
An unnotarized testing release is allowed only for prerelease versions when
`unnotarized_mac_preview` is explicitly selected in the workflow. It still must
pass strict code-signature verification and match the assessed DMG checksum.
Its release notes must explain manual macOS approval and unavailable automatic
Mac updates. Stable versions cannot use this testing option. Stable Windows
versions require code signing. No credentials belong in
source. Unsigned Windows preview builds must be labeled as such. Ad-hoc Mac builds are
for development and explicitly labeled testing previews. Mac public release checks assess the actual final DMG
after applying download quarantine, including code integrity, Developer ID, a
stapled notarization ticket, and Gatekeeper approval. The publication script
requires the assessment to match the installer checksum.

Keep package.json's version, release tag, binaries, blockmaps and update metadata
consistent. Publish the native installers and `latest*.yml` from the same build
together only after verification. Never regenerate updater metadata separately.
The source archive workflow produces a contributor ZIP artifact only.

Contributions use the MIT license. Dependencies keep their own licenses.
