import sqlite3

from backend import library as lib


def test_old_library_migration_preserves_songs_and_practice(tmp_path, monkeypatch):
    monkeypatch.setattr(lib, 'DATA', tmp_path / 'data')
    monkeypatch.setattr(lib, 'INBOX', tmp_path / 'Inbox')
    lib.DATA.mkdir()
    with sqlite3.connect(lib.DATA / 'library.sqlite') as db:
        db.execute("""CREATE TABLE songs (
          id TEXT PRIMARY KEY, digest TEXT UNIQUE, title TEXT, filename TEXT,
          status TEXT, stage TEXT, progress REAL, duration REAL, bpm REAL,
          error TEXT, created REAL, practice TEXT, demo INTEGER)""")
        db.execute("INSERT INTO songs VALUES ('old','digest','My song','song.wav','ready','Ready',1,10,120,NULL,1,'{\"loops\":[]}',0)")
    lib.initialize()
    song = lib.get_song('old')
    assert song['title'] == 'My song' and song['mode'] == 'singer'
    assert song['practice'] == {'loops': []} and song['status'] == 'ready'
