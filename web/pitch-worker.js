// YIN stays off both the UI thread and the real-time audio thread.
let history = new Float32Array(4096);
let filled = 0;
let difference = new Float32Array(512);

export function detectPitch(input, sampleRate, minFrequency = 65, maxFrequency = 1100) {
  const stride = Math.max(1, Math.floor(sampleRate / 12000));
  const sr = sampleRate / stride;
  const size = Math.floor(input.length / stride);
  const half = Math.floor(size / 2);
  const signal = new Float32Array(size);
  let energy = 0;
  let mean = 0;
  for (let i = 0; i < size; i++) mean += input[i * stride];
  mean /= size;
  for (let i = 0; i < size; i++) {
    signal[i] = input[i * stride] - mean;
    energy += signal[i] ** 2;
  }
  const rms = Math.sqrt(energy / size);
  if (rms < .006) return {frequency: null, confidence: 0, rms};
  const minLag = Math.max(2, Math.floor(sr / maxFrequency));
  const maxLag = Math.min(half - 1, Math.ceil(sr / minFrequency));
  if (difference.length <= maxLag + 1) difference = new Float32Array(maxLag + 2);
  let total = 0;
  difference[0] = 1;
  let chosen = -1;
  for (let lag = 1; lag <= maxLag; lag++) {
    let sum = 0;
    for (let i = 0; i < half; i++) sum += (signal[i] - signal[i + lag]) ** 2;
    total += sum;
    difference[lag] = total ? sum * lag / total : 1;
    if (lag > minLag && difference[lag - 1] < .15 && difference[lag] >= difference[lag - 1]) {
      chosen = lag - 1;
      break;
    }
  }
  if (chosen < 0) return {frequency: null, confidence: 0, rms};
  const y0 = difference[chosen - 1], y1 = difference[chosen], y2 = difference[chosen + 1];
  const denominator = 2 * (2 * y1 - y2 - y0);
  const refined = chosen + (denominator ? (y2 - y0) / denominator : 0);
  const frequency = sr / refined;
  if (frequency < minFrequency || frequency > maxFrequency) return {frequency: null, confidence: 0, rms};
  return {frequency, confidence: 1 - y1, rms};
}

if (typeof self !== 'undefined') self.onmessage = ({data}) => {
  if (data.type === 'reset') { history.fill(0); filled = 0; return; }
  const minFrequency = data.minFrequency || 65;
  const length = minFrequency < 65 ? 8192 : 4096;
  if (history.length !== length) { history = new Float32Array(length); filled = 0; }
  const samples = data.samples;
  if (samples.length >= history.length) history.set(samples.subarray(samples.length - history.length));
  else { history.copyWithin(0, samples.length); history.set(samples, history.length - samples.length); }
  filled = Math.min(history.length, filled + samples.length);
  if (filled < history.length) return;
  const result = detectPitch(history, data.sampleRate, minFrequency);
  self.postMessage({...result, frame: data.frame + samples.length - history.length / 2,
    midi: result.frequency ? 69 + 12 * Math.log2(result.frequency / 440) : null});
};
