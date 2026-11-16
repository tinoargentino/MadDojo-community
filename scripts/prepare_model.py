"""Download/check the official Demucs model once, before the first import."""
from demucs.pretrained import get_model
import torch

import argparse
parser = argparse.ArgumentParser()
parser.add_argument("--guitar", action="store_true", help="Also download the guitar model")
args = parser.parse_args()
if args.guitar:
    get_model("htdemucs_6s")
model = get_model("htdemucs")
print(f"Demucs ready: {model.sources}; CUDA available: {torch.cuda.is_available()}")
