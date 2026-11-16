"""Persistent library; audio preparation never runs in the HTTP process."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import time
from uuid import uuid4
from .modes import practice_mode

ROOT = Path(__file__).resolve().parents[1]
DATA = Path(os.environ.get("DOJO_DATA", Path.home() / ".local/share/vocal-dojo" if (Path.home() / ".local/share/vocal-dojo").exists() else Path.home() / ".local/share/maddojo")).expanduser()
INBOX = Path(os.environ.get("DOJO_INBOX", Path.home() / "Music/Singing Dojo/Inbox" if (Path.home() / "Music/Singing Dojo/Inbox").exists() else Path.home() / "Music/MadDojo/Inbox")).expanduser()
EXTENSIONS = {".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg", ".opus", ".aif", ".aiff", ".wma"}
MAX_UPLOAD = 512 * 1024 * 1024


def connect():
    db = sqlite3.connect(DATA / "library.sqlite", timeout=30)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    return db


def initialize():
    DATA.mkdir(parents=True, exist_ok=True)
    INBOX.mkdir(parents=True, exist_ok=True)
    (DATA / "songs").mkdir(exist_ok=True)
    (DATA / "takes").mkdir(exist_ok=True)
    (DATA / "uploads").mkdir(exist_ok=True)
    with connect() as db:
        db.executescript("""
            CREATE TABLE IF NOT EXISTS songs (
                id TEXT PRIMARY KEY, digest TEXT UNIQUE NOT NULL, title TEXT NOT NULL,
                filename TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
                stage TEXT NOT NULL DEFAULT 'Waiting to prepare', progress REAL DEFAULT 0,
                duration REAL, bpm REAL, error TEXT, created REAL NOT NULL,
                practice TEXT NOT NULL DEFAULT '{}', demo INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE IF NOT EXISTS takes (
                id TEXT PRIMARY KEY, song_id TEXT NOT NULL, title TEXT NOT NULL,
                created REAL NOT NULL, duration REAL NOT NULL, metadata TEXT NOT NULL
            );
        """)
        columns = {row[1] for row in db.execute("PRAGMA table_info(songs)")}
        if "mode" not in columns:
            db.execute("ALTER TABLE songs ADD COLUMN mode TEXT NOT NULL DEFAULT 'singer'")
        db.execute("UPDATE songs SET status='queued', stage='Resuming preparation', progress=0 WHERE status='processing'")


def all_songs():
    with connect() as db:
        return [public_song(row) for row in db.execute("SELECT * FROM songs ORDER BY demo ASC, created DESC")]


def public_song(row):
    song = dict(row)
    song.pop("digest", None)
    song["practice"] = json.loads(song["practice"])
    song["demo"] = bool(song["demo"])
    return song


def get_song(song_id):
    with connect() as db:
        row = db.execute("SELECT * FROM songs WHERE id=?", (song_id,)).fetchone()
    return public_song(row) if row else None


def update_song(song_id, **fields):
    allowed = {"status", "stage", "progress", "duration", "bpm", "error", "practice"}
    if not fields or not set(fields).issubset(allowed):
        raise ValueError("Invalid update")
    with connect() as db:
        db.execute(f"UPDATE songs SET {', '.join(key + '=?' for key in fields)} WHERE id=?", (*fields.values(), song_id))


def import_file(path: Path, title: str | None = None, mode: str = "singer"):
    practice_mode(mode)
    if path.suffix.lower() not in EXTENSIONS:
        raise ValueError("Unsupported audio format")
    size = path.stat().st_size
    if not size or size > MAX_UPLOAD:
        raise ValueError("Audio must be between 1 byte and 512 MB")
    with path.open("rb") as source:
        digest = hashlib.file_digest(source, "sha256").hexdigest()
    if mode != "singer":
        digest = hashlib.sha256(f"{digest}:{mode}".encode()).hexdigest()
    with connect() as db:
        existing = db.execute("SELECT * FROM songs WHERE digest=?", (digest,)).fetchone()
        if existing:
            return public_song(existing), False
        song_id = uuid4().hex
        folder = DATA / "songs" / song_id
        folder.mkdir()
        try:
            shutil.copyfile(path, folder / ("source" + path.suffix.lower()))
            db.execute("INSERT INTO songs(id,digest,title,filename,created,mode) VALUES(?,?,?,?,?,?)",
                       (song_id, digest, title or path.stem, path.name, time.time(), mode))
        except BaseException:
            shutil.rmtree(folder)
            raise
    return get_song(song_id), True


def atomic_json(path: Path, obj):
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj, allow_nan=False), encoding="utf-8")
    tmp.replace(path)
