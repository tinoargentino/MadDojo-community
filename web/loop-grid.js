const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const mod = (value, divisor) => ((value % divisor) + divisor) % divisor;

// Grid indices retain the declared bar phase, including cropped lead-ins.
export function loopAtBar(beats, firstBeatNumber, position, duration, meter, length = meter) {
  if (!beats.length || duration <= 0) return null;
  const current = Math.max(0, beats.findLastIndex(beat => beat <= position));
  const startIndex = current - mod(firstBeatNumber + current, meter);
  const a = startIndex < 0 || position < beats[0] ? 0 : beats[startIndex];
  const b = beats[startIndex + Math.max(1, length)] ?? duration;
  return b > a ? {a, b: Math.min(b, duration)} : null;
}

export function resizeGridLoop(beats, a, b, duration, delta) {
  const endpoints = [...beats.filter(beat => beat > a + .001 && beat < duration), duration];
  if (!endpoints.length) return null;
  let index = endpoints.reduce((best, end, i) => Math.abs(end - b) < Math.abs(endpoints[best] - b) ? i : best, 0);
  index = clamp(index + delta, 0, endpoints.length - 1);
  return {a, b: endpoints[index]};
}
