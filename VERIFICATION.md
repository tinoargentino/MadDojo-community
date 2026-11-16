# MadDojo verification

Verified on Linux with Python 3.11, FFmpeg, sandboxed system Chrome, and an NVIDIA GPU.

- 48 Python checks cover imports, per-mode deduplication, existing-library migration, media delivery, browser previews, recordings, portable Ardour exports, YouTube URL validation, download limits, failure reporting, and import queue integration.
- 11 JavaScript checks cover transport timing, pitch detection (including low bass), recording encoding, audio loading/cancellation/retry, and detailed waveforms.
- Real Demucs runs completed in Singer, Bass, Guitar, and Drums modes. Each selected guide plus its residual backing reconstructed the decoded original to within 1e-6.
- A source ZIP was extracted, dependencies installed from its lockfile, and its standalone launcher exercised with isolated data. Browser import produced a ready Bass song and working playback; Drums showed the correct guide and hid pitch feedback.
- Browser checks covered song switching, command/shortcut search, loop marking and snapping, persistent themes/sidebar state, and mobile overflow.
- The source package excludes songs, recordings, model weights, credentials, dependencies, and machine-specific deployment notes.

Run the automated checks with:

```sh
uv sync --locked --python 3.11
uv run pytest -q
node --test tests/audio.test.mjs
```

The Apple Silicon macOS 15 bundle was executed on a native Mac runner. Windows dependencies are represented in the lockfile, but Windows execution remains untested. Synthetic fixtures verify the processing pipeline, not separation quality on arbitrary music. Physical microphone/interface latency has not been measured. Guitar separation and polyphonic pitch tracking remain experimental.

A real YouTube audio download completed through the bundled yt-dlp and FFmpeg; unavailable-video errors were also exercised. Network-specific YouTube restrictions remain possible.

## Self-contained Apple Silicon app

The native macOS 15 arm64 build embeds a portable Python runtime, runtime dependencies, statically compiled FFmpeg/FFprobe, Deno, and both Demucs models. A relocated copy is tested with a minimal PATH: tools execute, dependencies import, both models load from bundled weights, the local server starts, an MP3 preview is served, and a real uploaded fixture completes guitar separation and analysis through the packaged background worker. Signing verification runs before archiving. These checks use a Mac CI runner; physical microphone capture and a human Finder launch still require a device check. The app is ad-hoc signed, not notarized.

## Open-source source distribution

The distribution now includes MIT licensing, contributor and dependency notices,
Windows/macOS/Linux source launchers, and a SHA-256 checksum. Local verification
passed 48 Python tests and 14 JavaScript tests. The ZIP was extracted to a fresh
temporary directory and its launcher served health and UI responses using
isolated data/inbox directories and the existing Python environment. This is
not a clean dependency-install test on Windows or macOS. Shell launchers passed
syntax checks. GitHub CI now defines native Linux, Windows, and macOS test jobs;
their results are required before claiming platform verification.
