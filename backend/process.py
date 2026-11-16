"""Isolated Demucs + beat/pitch analysis worker. Only trusted bundled weights load."""
from __future__ import annotations

import gc
import json
import os
from pathlib import Path
import subprocess
import sys

import numpy as np
import soundfile as sf

from .demo import waveform
from .library import atomic_json
from .modes import practice_mode


def prepare(folder: Path, mode: str = "singer"):
    config = practice_mode(mode)
    def progress(stage, value):
        atomic_json(folder / "progress.json", {"stage": stage, "progress": value})
        print(stage, flush=True)

    source = next(folder.glob("source.*"))
    progress("Decoding audio", .02)
    subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source), "-vn", "-t", "1200",
                    "-ac", "2", "-ar", "44100", "-c:a", "pcm_f32le", str(folder / "original.wav")], check=True)
    audio, sr = sf.read(folder / "original.wav", dtype="float32", always_2d=True)
    # Reject rather than silently truncate long songs.
    probe = subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(source)])
    original_duration = float(json.loads(probe).get("format", {}).get("duration", 0))
    if original_duration > 1200:
        raise ValueError("Please use a song under 20 minutes")
    if len(audio) < sr:
        raise ValueError("Please use at least one second of audio")
    progress(f"Loading {config['label']} separator", .06)
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    torch.set_num_threads(min(8, os.cpu_count() or 4))
    device = "cpu"
    if torch.cuda.is_available():
        free, _ = torch.cuda.mem_get_info()
        if free > 5 * 1024**3:
            device = "cuda"
    model = get_model(config["model"])
    model.eval()
    mix = torch.from_numpy(audio.T.copy())
    ref = mix.mean(0)
    mean, std = ref.mean(), ref.std().clamp_min(1e-6)
    normalized = (mix - mean) / std
    progress(f"Separating {config['source']} · {'GPU' if device == 'cuda' else 'CPU'}", .14)

    def separate(target):
        return apply_model(model, normalized[None], device=target, shifts=0, split=True,
                           overlap=.25, segment=6, progress=True, num_workers=0)[0].cpu()

    try:
        estimates = separate(device)
    except torch.cuda.OutOfMemoryError:
        torch.cuda.empty_cache()
        progress("GPU busy · continuing on CPU", .16)
        estimates = separate("cpu")
    estimates = estimates * std + mean
    vocals = estimates[model.sources.index(config["source"])].numpy().T
    # Residual subtraction preserves the original mix at unity gain exactly.
    backing = audio - vocals
    for name, stem in [("vocals", vocals), ("backing", backing)]:
        sf.write(folder / f"{name}.wav", stem, sr, subtype="FLOAT")
    del model, estimates, normalized, mix
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
    progress("Finding beats and reference melody", .67)
    import librosa

    mono = audio.mean(axis=1)
    beat_sr = 22050
    beat_audio = librosa.resample(mono, orig_sr=sr, target_sr=beat_sr)
    tempo, beats = librosa.beat.beat_track(y=beat_audio, sr=beat_sr, units="time", trim=False)
    bpm = float(np.asarray(tempo).flat[0])
    if not 30 <= bpm <= 300:
        bpm = 120.0
        beats = np.arange(0, len(audio) / sr, .5)
        beat_source = "Fallback 120 BPM · adjust the grid"
    else:
        beat_source = "Estimated beats · bars assume 4/4"
    pitch_sr, hop = (22050 if mode == "bass" else 11025), 256
    v = librosa.resample(vocals.mean(axis=1), orig_sr=sr, target_sr=pitch_sr)
    pitches = []
    # Overlap analysis chunks so pYIN is independent of song length in memory.
    chunk_size = 30 * pitch_sr // hop * hop
    for start in range(0, len(v) if config["pitch_min"] else 0, chunk_size):
        chunk = v[start:start + chunk_size + (4096 if mode == "bass" else 1024)]
        f0, voiced, probability = librosa.pyin(chunk, sr=pitch_sr, fmin=config["pitch_min"], fmax=1100,
                                             frame_length=4096 if mode == "bass" else 1024, hop_length=hop,
                                             n_thresholds=30, resolution=.2)
        rms = librosa.feature.rms(y=chunk, frame_length=4096 if mode == "bass" else 1024, hop_length=hop)[0]
        threshold = max(.003, float(np.percentile(rms, 75)) * .1)
        count = min(len(f0), int(np.ceil(min(chunk_size, len(v) - start) / hop)))
        for i in range(count):
            good = bool(voiced[i] and probability[i] > .25 and rms[i] > threshold and np.isfinite(f0[i]))
            pitches.append(round(float(librosa.hz_to_midi(f0[i])), 2) if good else None)
        progress("Tracing the reference melody", .72 + .24 * min(1, (start + chunk_size) / len(v)))
    analysis = {
        "mode": mode, "guide_label": config["guide"], "separator": config["model"],
        "duration": len(audio) / sr, "bpm": round(bpm, 2), "beats": np.round(beats, 4).tolist(),
        "beat_source": beat_source, "beats_per_bar": 4, "pitch": pitches,
        "pitch_hop": hop / pitch_sr, "pitch_source": f"pYIN on separated {config['source']} · experimental" if config["pitch_min"] else "Not applicable",
        "sample_rate": sr,
        "waveforms": {"vocals": waveform(vocals.mean(axis=1)), "backing": waveform(backing.mean(axis=1))},
    }
    atomic_json(folder / "analysis.json", analysis)
    progress("Ready to practice", 1)
    return analysis


if __name__ == "__main__":
    prepare(Path(sys.argv[1]), sys.argv[2] if len(sys.argv) > 2 else "singer")
