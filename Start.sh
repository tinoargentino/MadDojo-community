#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v uv >/dev/null 2>&1; then
  echo 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/'
  exit 1
fi
uv sync --locked --python 3.11 --no-dev
exec uv run --no-sync python scripts/start.py "$@"
