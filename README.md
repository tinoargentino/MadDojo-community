# MadDojo

A local music practice app for **singing, bass, guitar, and drums**. Import a song, choose a mode, and practice with an isolated guide plus the rest of the mix. Includes precise loops, zoomable waveforms, recording, themes, and a searchable command bar. Optional Ardour session downloads work offline too.

## Local installation on macOS, Windows, and Linux

MadDojo is open-source software under the [MIT license](LICENSE). It runs a
local Python engine with a browser interface: separation, songs, and recordings
stay on your computer. The browser remains the shared interface across platforms.

Download and extract `MadDojo.zip` from a release. Install uv and FFmpeg as
described below, then launch from the extracted folder:

| Platform | Launcher | Distribution |
| --- | --- | --- |
| Windows x64 | Double-click `Start.cmd` | Source installer; uv and FFmpeg required |
| Linux x64 | Run `./Start.sh` | Source installer; uv and FFmpeg required |
| macOS | Run `./Start.command` | Source installer; uv and FFmpeg required |
| macOS 15+ Apple Silicon | Open `MadDojo.app` | Separate self-contained bundle |

The source launchers install locked Python dependencies on first launch and
open your browser. Keep their terminal open while practicing. Internet is
required for initial dependencies and each model's first use. YouTube import
always requires internet. Extract the ZIP to a writable folder; it creates a
`.venv` alongside the source. If macOS does not allow double-clicking the source
launcher, run `sh Start.command` in Terminal.

Windows and Linux packages are source installers, not bundled native binaries.
CI is configured to check all three operating systems; new platform runs must
pass before those platforms can be called verified.

## Ready-to-run Mac app

The **Build Mac app** GitHub Actions workflow builds `MadDojo-macOS-AppleSilicon.zip` on a native Apple Silicon runner. It includes Python, all runtime dependencies, FFmpeg/FFprobe, Deno for YouTube, and both Demucs models. No Homebrew, Terminal setup, or first-run model download is required for this edition.

Unzip it, move **MadDojo.app** to Applications, and open it. The app opens its local browser interface and adds a waveform icon to the menu bar. Use that menu to reopen the interface or quit the server. It requires an Apple Silicon Mac running macOS 15 or newer.

This build is ad-hoc signed, not Apple-notarized. macOS may require approval under System Settings → Privacy & Security → Open Anyway on first launch. No Developer ID credentials are included. Browser microphone permission is still required for recording.

For contributors, the native build command is `uv run python scripts/build_macos.py` on Apple Silicon. FFmpeg and LAME are compiled from checksum-verified sources with their source archives and licenses included. The build verifies bundled models, dependency imports, media tools, and server playback previews after relocating the app, then signs it and produces the ZIP. The workflow's artifact can be downloaded by anyone with repository access; the owner can send the ZIP directly to friends.

## Install your own copy

Requires **uv**, **FFmpeg** (including ffprobe), and a current browser. Python 3.11 is installed by uv when needed. No API key, subscription, Tailscale, or account is required. YouTube import additionally needs Deno or Node.js for yt-dlp’s JavaScript challenges; local audio imports do not.

On macOS with Homebrew:

```sh
brew install uv ffmpeg deno
```

On Windows or Linux, install [uv](https://docs.astral.sh/uv/getting-started/installation/) and [FFmpeg](https://ffmpeg.org/download.html), ensuring `uv`, `ffmpeg`, and `ffprobe` are on PATH. Then extract the MadDojo ZIP (or clone this repository), open a terminal in its folder, and run:

```sh
uv sync --python 3.11
uv run python scripts/start.py
```

The launcher opens the app in your browser. Keep the terminal running; Ctrl+C stops it. To use a different port or skip opening the browser:

```sh
uv run python scripts/start.py --port 8768 --no-browser
```

The first install downloads Python dependencies, including PyTorch. Each separation model downloads on its first use; an internet connection is needed for these initial downloads. Afterwards processing is local. NVIDIA CUDA is used when available with sufficient free VRAM; other machines use CPU, which is slower. Linux source installation and the Apple Silicon macOS 15 bundle have been verified. Windows dependency choices are included in the lockfile, but Windows execution remains untested.

## Practice modes

Click **Add songs**, choose a mode, then choose audio files. Dropped files use the same mode dialog. You can also paste a YouTube video link in the import dialog and click Add. MadDojo downloads the audio with its bundled yt-dlp, then queues separation in the selected mode. Download errors stay in the dialog for retry. Single videos up to 20 minutes and 512 MB are supported; live streams and playlist-only links are rejected. YouTube access may vary by video, region, or network.

Each song keeps its import mode; import the original again in another mode to practice another part. Identical files are deduplicated within each mode.

| Mode | Guide | Backing | Model |
| --- | --- | --- | --- |
| Singer | Vocals | Mix minus vocals | htdemucs |
| Bass | Bass | Mix minus bass | htdemucs |
| Guitar | Guitar | Mix minus guitar | htdemucs_6s |
| Drums | Drums | Mix minus drums | htdemucs |

A single Demucs pass creates the selected guide. The backing is the original mix minus that guide. The interface always has two tracks, with mode-specific labels. Demucs separation is approximate; guitar extraction uses the experimental six-source model. Pitch feedback is experimental, particularly for polyphonic guitar, and is hidden for drums. Bass reference analysis extends down to 30 Hz. The built-in five-note warm-up is a Singer exercise.

## Controls

| Key | Action |
| --- | --- |
| Cmd/Ctrl+K | Search commands, shortcuts, and songs |
| Cmd/Ctrl+B | Show or hide library |
| Space | Play / pause |
| Enter | Restart loop or song |
| Escape | Stop and return |
| [ | Mark loop start and keep playing |
| ] | Mark loop end and activate |
| L | Start a loop at the current bar, or turn the active loop off |
| , / . | Shorten / extend loop by one bar |
| Shift+, / Shift+. | Shorten / extend loop by one beat |
| V | Mute / restore guide |
| − / + | Guide volume |
| R | Record / finish take |
| Left / Right | Seek one beat; Shift seeks one bar |
| Z / Shift+Z | Zoom in / out |
| ? | Keyboard shortcut reference |

Loop markers snap to the nearest beat when **Snap to beat** is checked. Detected beats may need adjustment in Settings. Shortcuts pause while you type; the command bar supports arrows, Enter, and Escape. Cmd/Ctrl+K also works while typing.

The header theme selector offers Paper, Studio, Midnight, and Slate. The panel icon beside the song title toggles the library. Both choices persist in this browser.

Use wired headphones for recording and monitoring. Monitoring starts off. Recordings that cannot save remain downloadable in the tab; save or download before closing it. The app does not provide time stretching or lyrics.

## Files and privacy

New installations store their library under `~/.local/share/maddojo`, and watch `~/Music/MadDojo/Inbox`. Existing Vocal Dojo installations retain their old library and inbox automatically. `DOJO_DATA` and `DOJO_INBOX` override these locations. Songs and recordings stay on the computer running the server. Source files are copied, not moved.

Files added directly to the watched inbox default to Singer. Put them in `bass`, `guitar`, or `drum` subfolders to select a mode. Imports are limited to 512 MB and 20 minutes per song. Ordinary 3–5 minute songs are the intended use.

The server binds to loopback, for use on the same computer. No public hosting or authentication is configured. This ZIP contains source code, not your songs, recordings, model downloads, or settings. Sharing the source does not require sharing your library.

## Ardour

Download a prepared session from the song header, unzip it, and open the `.ardour` file in Ardour 9.8 or newer. The session includes Backing, the selected guide, and an initially unarmed recording track. Included Lua actions target that guide. Each download is a new starting session; it never replaces a working session containing your recordings. The setup button explains the workflow.

## Development

```sh
uv sync --python 3.11
uv run pytest -q
node --test tests/audio.test.mjs
uv run python scripts/package.py
```

The package command writes `dist/MadDojo.zip`. It excludes personal data, machine configuration, and dependencies. The UI is plain HTML/CSS/JavaScript; FastAPI serves the app and serializes background separation jobs. Zoomed waveforms use 5 ms detail generated from already decoded audio. Internal `vocals` filenames and `dojo.*` browser storage keys are retained for compatibility; in instrument modes they hold the selected guide.

Demucs model details: [official documentation](https://github.com/facebookresearch/demucs#fine-tuned-models).

Automated checks run on pushes and pull requests through GitHub Actions. See [verification notes](VERIFICATION.md) for coverage and platform limits.

## Releases and contributions

See [CONTRIBUTING.md](CONTRIBUTING.md) for development and bug reports and
[THIRD_PARTY.md](THIRD_PARTY.md) for dependency notices. Build a source release
with `uv run python scripts/package.py`; it includes launchers and a SHA-256
checksum. A `v*` tag triggers publication of the source ZIP and checksum to
GitHub Releases. The separate Build Mac app workflow produces the Mac bundle;
it is not automatically attached to source releases.

The browser interface is suitable for playback, loops, pitch feedback, and
recording. Use wired headphones. For demanding live monitoring, native audio
routing, or audio drivers such as ASIO, use the Ardour export. A native audio
engine would be a separate future project.

Advanced reverse-proxy installations can explicitly set `DOJO_ALLOWED_HOSTS`
(comma-separated hostnames) and `DOJO_BASE_PATH` (for example `/dojo/`). These
settings do not enable authentication or change the launcher's loopback binding.
