"""An original synthesized exercise, with an exact reference melody."""
import json
import time

import numpy as np
import soundfile as sf

from . import library as lib
from .library import atomic_json, connect


def seed_demo():
    with connect() as db:
        if db.execute("SELECT id FROM songs WHERE id='warmup'").fetchone():
            return
    sr, bpm, duration = 44100, 96, 40.0
    t = np.arange(int(sr * duration), dtype=np.float32) / sr
    voice, backing = np.zeros_like(t), np.zeros_like(t)
    beat = 60 / bpm
    # One bar of breathing space followed by a familiar five-note exercise.
    phrase = [60, 62, 64, 65, 67, 65, 64, 62, 60, None, 62, 64, 65, 67, 69, 67, 65, 64, 62, None]
    notes = []
    for i, note in enumerate(phrase * 2):
        start, length = 2.5 + i * .875, .72
        if note is None or start + length > duration:
            continue
        mask = (t >= start) & (t < start + length)
        local = t[mask] - start
        freq = 440 * 2 ** ((note - 69) / 12)
        envelope = np.minimum(1, local / .045) * np.minimum(1, (length - local) / .09)
        phase = 2 * np.pi * freq * local + .08 * np.sin(2 * np.pi * 5 * local)
        voice[mask] += .19 * envelope * (np.sin(phase) + .25 * np.sin(2 * phase) + .13 * np.sin(3 * phase))
        notes.append((start, start + length, note))
    chords = [[48, 52, 55], [45, 48, 52], [41, 45, 48], [43, 47, 50]]
    for b in range(int(duration / beat)):
        start = b * beat
        mask = (t >= start) & (t < min(duration, start + 1.2))
        local = t[mask] - start
        chord = chords[(b // 4) % 4]
        for note in chord:
            f = 440 * 2 ** ((note - 69) / 12)
            backing[mask] += .032 * np.sin(2 * np.pi * f * local) * np.exp(-local * 4)
        drum_mask = (t >= start) & (t < start + .12)
        dt = t[drum_mask] - start
        backing[drum_mask] += .09 * np.sin(2 * np.pi * (80 * dt - 100 * dt**2)) * np.exp(-dt * 35)
    folder = lib.DATA / "songs/warmup"
    folder.mkdir(parents=True, exist_ok=True)
    for name, audio in [("vocals", voice), ("backing", backing), ("original", voice + backing)]:
        stereo = np.stack([audio, audio], axis=1)
        sf.write(folder / f"{name}.wav", stereo, sr, subtype="PCM_16")
    pitch = []
    for ts in np.arange(0, duration, .025):
        note = next((m for a, b, m in notes if a + .035 < ts < b - .035), None)
        pitch.append(note)
    analysis = {
        "duration": duration, "bpm": bpm, "beats": np.arange(0, duration, beat).round(4).tolist(),
        "beat_source": "Exact exercise grid", "beats_per_bar": 4,
        "pitch": pitch, "pitch_hop": .025,
        "waveforms": {name: waveform(audio) for name, audio in [("vocals", voice), ("backing", backing)]},
        "pitch_source": "Exact synthesized guide", "sample_rate": sr,
    }
    atomic_json(folder / "analysis.json", analysis)
    with connect() as db:
        db.execute("INSERT INTO songs(id,digest,title,filename,status,stage,progress,duration,bpm,created,demo) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                   ("warmup", "builtin-warmup-v1", "Five-note warm-up", "Original five-note exercise", "ready", "Ready to practice", 1, duration, bpm, time.time(), 1))


def waveform(audio, bins=1800):
    return [round(float(np.max(np.abs(chunk))), 4) for chunk in np.array_split(audio, min(bins, len(audio))) if len(chunk)]
