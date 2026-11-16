"""Import-time practice targets; all modes keep the same two-track workspace."""
MODES = {
    "singer": {"label": "Singer", "source": "vocals", "guide": "Guide vocal", "model": "htdemucs", "pitch_min": 65.4},
    "bass": {"label": "Bass", "source": "bass", "guide": "Guide bass", "model": "htdemucs", "pitch_min": 30.0},
    "guitar": {"label": "Guitar", "source": "guitar", "guide": "Guide guitar", "model": "htdemucs_6s", "pitch_min": 65.4},
    "drum": {"label": "Drums", "source": "drums", "guide": "Guide drums", "model": "htdemucs", "pitch_min": None},
}


def practice_mode(mode):
    if mode not in MODES:
        raise ValueError("Choose Singer, Bass, Guitar or Drums")
    return MODES[mode]
