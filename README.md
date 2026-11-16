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
| Windows x64 | Setup `.exe`, per-user install and Start menu shortcut |
| macOS Apple Silicon | `.dmg`, drag MadDojo to Applications |
| Linux x64 | `.AppImage` and `.deb` |

Desktop builds are in verification. The `v0.1.0` release is the earlier source
edition and is **not** a desktop installer. Check GitHub Releases for desktop
preview assets once their native build and smoke checks pass. Signing and
notarization must be configured before claiming a seamless public Mac release.

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
