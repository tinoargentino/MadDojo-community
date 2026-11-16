# Verification

## Current desktop implementation

Verified locally on Linux with the bundled portable Python CPU engine and
sandboxed Electron 45.3.3 (no sandbox-disabling flags):

- 49 Python API/processing/export checks and 17 JavaScript/audio/desktop-policy checks pass.
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

The initial cross-platform source-test matrix passed on native Linux, Windows,
and Apple Silicon macOS runners after fixing Windows UTF-8 decoding. Native
desktop installer verification is separate and must pass before publication.

## Checks still required for a production release

- Native Windows and macOS packaged launch/record/shutdown verification.
- Physical microphone, headphones, input/output selection, and measured latency.
- Human installer/uninstaller checks on clean machines.
- Update feed download, hash verification, replacement, and relaunch across versions.
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
