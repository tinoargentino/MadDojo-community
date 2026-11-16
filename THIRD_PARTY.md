# Third-party components

The MIT license covers MadDojo's original code. It does not relicense bundled
software, downloaded models, or imported music.

- Demucs: https://github.com/facebookresearch/demucs (MIT; consult upstream for model terms).
- PyTorch / torchaudio: https://github.com/pytorch/pytorch and https://github.com/pytorch/audio (BSD-style licenses).
- FFmpeg: https://ffmpeg.org/legal.html (license depends on build configuration).
- The Mac bundle builds FFmpeg with LAME and includes their source archives and licenses.
- Deno: https://github.com/denoland/deno (MIT).
- yt-dlp: https://github.com/yt-dlp/yt-dlp (Unlicense for original code; dependencies retain their licenses).

See uv.lock for the complete Python dependency set and installed package
metadata for each dependency's license. The source ZIP contains no model
weights or third-party executables. Preserve third-party notices and source
obligations when redistributing binary bundles. Import only audio you have
permission to use and follow the source service's terms.
