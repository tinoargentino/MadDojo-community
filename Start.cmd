@echo off
setlocal
cd /d "%~dp0"
where uv >nul 2>nul
if errorlevel 1 (
  echo Install uv first: https://docs.astral.sh/uv/getting-started/installation/
  pause
  exit /b 1
)
uv sync --locked --python 3.11 --no-dev
if errorlevel 1 goto failed
uv run --no-sync python scripts/start.py %*
if errorlevel 1 goto failed
exit /b 0
:failed
pause
exit /b 1
