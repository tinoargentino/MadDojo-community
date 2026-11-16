# Contributing

Use Python 3.11, uv, FFmpeg/FFprobe, and Node.js 24 for browser tests.

```sh
uv sync --locked --python 3.11
uv run pytest -q
node --test tests/*.test.mjs
uv run python scripts/package.py
```

Run `uv run python scripts/start.py` to develop locally. Frontend assets are
served directly; no frontend build step is needed. Keep changes focused and
include relevant verification in pull requests. Please report your OS, Python
version, browser, reproduction steps, and redacted logs when filing bugs.
Never attach private recordings, songs, credentials, or your library database.

Changes are contributed under the project's MIT license. Third-party software
and model weights retain their own licenses; see THIRD_PARTY.md.
