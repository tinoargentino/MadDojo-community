# MadDojo

A local music practice room for singing, bass, guitar, and drums. Import a song,
separate a guide from its backing, loop a phrase, and record your takes.
Your songs, separation, and recordings stay on your computer.

## Desktop app

The desktop edition opens in its own window and owns its practice engine.
It bundles Python, CPU separation dependencies, FFmpeg/FFprobe, and both Demucs
models. Users do not need a terminal, Python, uv, Homebrew, Node, or a browser.
YouTube import uses the desktop runtime's embedded JavaScript engine.

The desktop packaging pipeline builds these native formats:

| Platform | Installer |
| --- | --- |
| Windows x64 | [Setup installer](https://github.com/tinoargentino/MadDojo-community/releases/download/v0.2.0-beta.2/MadDojo-0.2.0-beta.2-win-x64.exe) |
| macOS Apple Silicon | [Beta.2 DMG](https://github.com/tinoargentino/MadDojo-community/releases/download/v0.2.0-beta.2/MadDojo-0.2.0-beta.2-mac-arm64.dmg), manual macOS approval may be required |
| Linux x64 | [AppImage](https://github.com/tinoargentino/MadDojo-community/releases/download/v0.2.0-beta.2/MadDojo-0.2.0-beta.2-linux-x86_64.AppImage) · [DEB](https://github.com/tinoargentino/MadDojo-community/releases/download/v0.2.0-beta.2/MadDojo-0.2.0-beta.2-linux-amd64.deb) |

**[Download Mac beta.2 (.dmg)](https://github.com/tinoargentino/MadDojo-community/releases/download/v0.2.0-beta.2/MadDojo-0.2.0-beta.2-mac-arm64.dmg)** · [All desktop installers](https://github.com/tinoargentino/MadDojo-community/releases/tag/v0.2.0-beta.2)

Open the Windows Setup installer or install the Linux package. Linux packages
were verified on Ubuntu 22.04. Internal Mac builds target Apple Silicon on
macOS 15 or newer.

**Mac beta.2 repairs the beta.1 invalid signature.** The final DMG passed strict
code-signature validation and recording/save checks. Its complete public download
was verified against the exact installer assessed on macOS.

This is an unnotarized testing build. Replace the old `MadDojo.app` in Applications
with the copy from the beta.2 DMG. After first attempting to open it, macOS may
require **System Settings → Privacy & Security → Open Anyway** for MadDojo.
See [Apple's per-app approval instructions](https://support.apple.com/en-us/102445).
It does not have automatic Gatekeeper approval or automatic Mac updates. A paid
Apple membership is not needed for development or this testing route.

Do not reuse the beta.1 Mac installer. Windows and Linux beta.2 installer checks
also passed. Physical audio-device and cross-version update replacement testing
remain necessary before a stable release.

Stop any source copy before opening the desktop app with the same library.
The earlier `v0.1.0` release is a source archive, **not** the desktop installer.

Open MadDojo, choose **Add songs**, select a practice mode, and import audio.
The engine runs inside the app's lifecycle. Quitting closes the engine and its
workers. Use wired headphones for microphone recording and monitoring.

### Updates

**Help → Check for updates** checks the public GitHub release feed. Downloads
and restart-to-install require a user choice; updates do not interrupt practice
or install automatically on quit. Windows installers and Linux AppImages use
the updater. Debian packages use package replacement. macOS automatic updates
require a Developer ID signed release. Existing ZIP/source installations use
manual replacement and do not acquire a desktop updater retroactively.

### Files and privacy

New desktop libraries live in the app's user-data folder (`Library` inside
Electron's platform-specific MadDojo data directory). Existing libraries in
`~/.local/share/vocal-dojo` or `~/.local/share/maddojo` are reused automatically.
The inbox remains `~/Music/MadDojo/Inbox`; older installations retain their old
inbox. `DOJO_DATA` and `DOJO_INBOX` override these locations.

App updates replace the application, not the library. Uninstalling the Windows
app preserves its data. Keep backups of recordings you care about.

Normal separation and practice work offline immediately, including the two
bundled models. Checking/downloading updates and YouTube imports need internet.
There is no account, subscription, API key, telemetry, or hosted processing.
The private loopback engine requires the desktop session's credential.

## Practice

| Mode | Guide | Backing |
| --- | --- | --- |
| Singer | Vocals | Mix minus vocals |
| Bass | Bass | Mix minus bass |
| Guitar | Guitar | Mix minus guitar |
| Drums | Drums | Mix minus drums |

Each import keeps its mode. Reimport the original in another mode to practice
another instrument. Guitar extraction and pitch feedback are experimental;
Drums hides pitch feedback. Separation is approximate. CPU processing can take
several minutes per song. The desktop engine ships CPU PyTorch to keep install
size and driver requirements manageable; source installations can use CUDA.

Use **Cmd/Ctrl+K** for commands and shortcuts, **Space** for playback, **L** for a
loop at the current bar, **, / .** to resize it by a bar (**Shift** for a beat),
and **R** to record. The shortcut panel lists the rest. Themes and view settings
persist in the app. Ardour exports provide an optional native session workflow;
Ardour is not required for the desktop app.

Audio imports support common formats, up to 512 MB and 20 minutes. Single
YouTube videos are supported; playlists and live streams are rejected. Access
may vary by network, region, and service changes. Import only audio you may use.

## Build and contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for source development and native builds,
[VERIFICATION.md](VERIFICATION.md) for tested behavior and limitations, and
[THIRD_PARTY.md](THIRD_PARTY.md) for third-party licenses. MadDojo's original code
is [MIT licensed](LICENSE).

The UI uses HTML/CSS/JavaScript inside an isolated, sandboxed Electron renderer.
The main process owns windows, permissions, file downloads, updates, and engine
lifetime. A portable Python runtime runs FastAPI and isolated audio workers.
The engine binds only to loopback, reserves its socket before startup, and uses
an unguessable session credential passed in an HTTP-only cookie.

### Source development

Requires uv, FFmpeg/FFprobe, Python 3.11, and Node 24. This workflow is for
contributors, not desktop users:

```sh
uv sync --locked --python 3.11
uv run python scripts/start.py
```

The `Start.*` files and source ZIP are contributor conveniences. They install
Python dependencies and use a browser, rather than installing the desktop app.
Advanced reverse-proxy setups can explicitly set `DOJO_ALLOWED_HOSTS` and
`DOJO_BASE_PATH`. These do not enable authentication for source mode.
