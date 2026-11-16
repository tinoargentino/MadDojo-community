#!/bin/bash
set -euo pipefail
DEST="$1"
WORK="$2"
EXTRA_LDFLAGS=""
case "$(uname -s)" in MINGW*|MSYS*) EXTRA_LDFLAGS="-static" ;; esac
mkdir -p "$DEST" "$WORK"
cd "$WORK"
sha256check() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum -c -; else shasum -a 256 -c -; fi
}
curl --fail --location --retry 3 https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz -o ffmpeg.tar.xz
printf '%s  %s\n' 8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e ffmpeg.tar.xz | sha256check
curl --fail --location --retry 3 https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz -o lame.tar.gz
printf '%s  %s\n' ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e lame.tar.gz | sha256check
tar xf lame.tar.gz
cd lame-3.100
./configure --prefix="$WORK/static" --disable-shared --enable-static --disable-frontend
make -j3
make install
cd "$WORK"
tar xf ffmpeg.tar.xz
cd ffmpeg-9.0.2
PKG_CONFIG_PATH="$WORK/static/lib/pkgconfig" ./configure \
  --prefix="$DEST" --disable-shared --enable-static --disable-autodetect \
  --disable-everything --disable-doc --disable-debug --disable-network --disable-x86asm \
  --enable-ffmpeg --enable-ffprobe --enable-swresample --enable-avfilter \
  --enable-protocol=file,pipe \
  --enable-demuxer=mov,matroska,mp3,wav,flac,ogg,aiff,asf,aac \
  --enable-decoder=aac,aac_latm,mp3,mp3float,flac,vorbis,opus,alac,wmav1,wmav2,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,pcm_s16be,pcm_s24be,pcm_s32be,pcm_f32be,pcm_f64be,pcm_u8 \
  --enable-parser=aac,mpegaudio,flac,opus,vorbis \
  --enable-encoder=pcm_s16le,pcm_f32le,libmp3lame \
  --enable-muxer=wav,mp3 --enable-filter=aresample,volume,anull,aformat \
  --enable-libmp3lame --extra-cflags="-I$WORK/static/include" --extra-ldflags="-L$WORK/static/lib $EXTRA_LDFLAGS"
make -j3
make install
mkdir -p "$DEST/third-party-sources"
cp "$WORK/ffmpeg.tar.xz" "$WORK/lame.tar.gz" "$DEST/third-party-sources/"
cp "$WORK/ffmpeg-9.0.2/COPYING.LGPLv2.1" "$DEST/third-party-sources/"
cp "$WORK/lame-3.100/COPYING" "$DEST/third-party-sources/LAME-LICENSE"
