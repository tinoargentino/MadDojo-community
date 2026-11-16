// Build zoom detail from decoded playback audio, yielding between chunks so
// transport controls stay responsive. No additional audio download is needed.
export async function detailedWaveform(buffer, current = () => true) {
  const count = Math.min(buffer.length, Math.ceil(buffer.duration * 200));
  const values = new Float32Array(count);
  const channels = Array.from({length: buffer.numberOfChannels}, (_, i) => buffer.getChannelData(i));
  let peak = .05;
  for (let first = 0; first < count; first += 2048) {
    if (!current()) return null;
    const last = Math.min(count, first + 2048);
    for (let bin = first; bin < last; bin++) {
      const start = Math.floor(bin * buffer.length / count);
      const end = Math.floor((bin + 1) * buffer.length / count);
      let value = 0;
      for (const channel of channels) {
        for (let i = start; i < end; i++) value = Math.max(value, Math.abs(channel[i]));
      }
      values[bin] = value;
      peak = Math.max(peak, value);
    }
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return current() ? {values, peak} : null;
}
