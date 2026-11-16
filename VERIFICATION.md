# Verification

## Current desktop implementation

Verified locally on Linux with the bundled portable Python CPU engine and
sandboxed Electron 45.3.3 (no sandbox-disabling flags):

- 50 Python API/processing/export/lifecycle checks and 17 JavaScript/audio/desktop-policy checks pass.
- A real packaged window starts its own engine and loads the authenticated UI.
- The renderer exposes Web Audio and media capture, with no Node `require`.
- A synthetic microphone stream records successfully inside the packaged app.
- The AppImage itself launches, records the synthetic stream, and quits cleanly.
- Engine requests without the desktop session are rejected.
- A real two-second guitar import separates using the bundled CPU model, creates
  analysis and WAV/MP3 output, and exports an Ardour ZIP with a minimal PATH.
- Both bundled models load without downloading at runtime.
- Parent-stdin closure shuts down the server and its active processing worker.
- Production npm dependencies have no findings in `npm audit --omit=dev` at build time.

The source-test matrix passes on native Linux, Windows, and Apple Silicon macOS.
The desktop beta's [native build and installer matrix](https://github.com/tinoargentino/MadDojo-community/actions/runs/43924715942)
also passed all three jobs before [publication](https://github.com/tinoargentino/MadDojo-community/releases/tag/v0.2.0-beta.1).

- Windows: real bundled separation/exports; packaged app recording/save;
  NSIS installation; installed app recording/save; silent uninstall.
- macOS: real bundled separation/exports; packaged app recording/save; launch
  and recording/save from the final read-only disk image.
- Linux: real bundled separation/exports; packaged app recording/save; DEB
  install, launch, record/save, and removal; actual AppImage launch and recording;
  update download and checksum rejection integration.

Public installer downloads and update manifests were checked anonymously.
Every published file's SHA-256 matches the release checksum manifest. Windows
and Linux executable headers were checked via ranged public downloads.

## Checks still required for a production release

- Physical microphone, headphones, input/output selection, and measured latency.
- Human first-launch approval and device checks on ordinary desktop machines.
- Replacement and relaunch across versions. A local release-feed integration check
  already verifies discovery, download, hash validation, corrupted-file rejection,
  and preservation of the installed binary; it uses a simulated prior version.
- Developer ID signing and notarization for seamless Mac distribution and updates;
  Windows signing for publisher identity and installation reputation.

The workflow builds Windows NSIS, macOS DMG/ZIP, and Linux AppImage/DEB. Artifacts
are produced only after bundled engine and desktop smoke checks. A workflow
configuration is not evidence that all platforms have passed.

Desktop builds use CPU separation; source development can use CUDA. Guitar
separation and polyphonic pitch feedback are experimental. Separation quality
on arbitrary music is not established by synthetic fixtures. Recording tests
with a synthetic stream do not measure hardware latency or sound quality.

The earlier `v0.1.0` download is a source ZIP with manual dependency setup.
It is not the new desktop edition and does not include the desktop updater.
