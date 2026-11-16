import test from 'node:test';
import assert from 'node:assert/strict';
import {detectPitch} from '../web/pitch-worker.js';
import {PracticeEngine, encodeWav} from '../web/engine.js';

test('pitch analysis follows low and high voices at common device sample rates', () => {
  for (const sr of [44100, 48000, 96000]) for (const hz of [82.4069, 130.8128, 220, 440, 880]) {
    const samples = Float32Array.from({length: 4096}, (_, i) => .14 * Math.sin(2 * Math.PI * hz * i / sr) + .03 * Math.sin(4 * Math.PI * hz * i / sr));
    const result = detectPitch(samples, sr);
    assert.ok(result.frequency, `Expected a voiced result for ${hz} Hz / ${sr} Hz`);
    const cents = 1200 * Math.log2(result.frequency / hz);
    assert.ok(Math.abs(cents) < 12, `${hz} Hz / ${sr}: error ${cents.toFixed(2)} cents`);
    assert.ok(result.confidence > .85);
  }
});

test('silence is unvoiced and does not produce a pitch score', () => {
  assert.equal(detectPitch(new Float32Array(4096), 48000).frequency, null);
  const quiet = Float32Array.from({length: 4096}, (_, i) => .0001 * Math.sin(2 * Math.PI * 220 * i / 48000));
  assert.equal(detectPitch(quiet, 48000).frequency, null);
});

test('PCM recording encodes duration, sample rate and clipping correctly', async () => {
  const blob = encodeWav([new Float32Array([0, .5, -1]), new Float32Array([2, -2])], 48000);
  const view = new DataView(await blob.arrayBuffer());
  assert.equal(blob.type, 'audio/wav');
  assert.equal(view.byteLength, 54);
  assert.equal(view.getUint32(24, true), 48000);
  assert.equal(view.getUint32(40, true), 10);
  assert.equal(view.getInt16(44, true), 0);
  assert.equal(view.getInt16(46, true), 16383);
  assert.equal(view.getInt16(48, true), -32768);
  assert.equal(view.getInt16(50, true), 32767);
  assert.equal(view.getInt16(52, true), -32768);
});

test('transport remains on the audio clock across repeated native loop wraps', () => {
  const engine = new PracticeEngine();
  engine.duration = 100; engine.playing = true; engine.context = {currentTime: 0};
  engine.offset = 5; engine.anchor = 100; engine.loop = {a: 4, b: 8, enabled: true};
  assert.equal(engine.positionAt(100), 5);
  assert.equal(engine.positionAt(102), 7);
  assert.equal(engine.positionAt(103), 4);
  assert.equal(engine.positionAt(103 + 4000), 4);
  assert.equal(engine.positionAt(104.25), 5.25);
  engine.loop.enabled = false;
  assert.equal(engine.positionAt(1000), 100);
});

test('an immediate pause cancels a pending audio-context resume', async () => {
  const engine = new PracticeEngine();
  let resume, starts = 0;
  engine.duration = 10;
  engine.context = {currentTime: 1, resume: () => new Promise(resolve => resume = resolve)};
  engine.startSegment = () => starts++;
  const pending = engine.play();
  assert.ok(engine.starting);
  engine.pause();
  resume();
  await pending;
  assert.equal(engine.playing, false);
  assert.equal(engine.starting, false);
  assert.equal(starts, 0);
});

test('loading keeps seeking and loops usable and reports download progress', async t => {
  const engine = new PracticeEngine();
  engine.duration = 40;
  engine.loop = {a: 5, b: 10, enabled: true};
  engine.context = {currentTime: 0, decodeAudioData: async () => ({duration: 40})};
  let release;
  const gate = new Promise(resolve => release = resolve);
  t.mock.method(globalThis, 'fetch', async () => {
    await gate;
    return new Response(new Uint8Array(100), {headers: {'content-length': '100'}});
  });
  const updates = [];
  const pending = engine.load({vocals: 'voice', backing: 'backing'}, {onProgress: p => updates.push(p)});
  assert.equal(engine.duration, 40);
  engine.seek(7);
  release();
  assert.equal(await pending, true);
  assert.equal(engine.position, 7);
  assert.deepEqual(engine.loop, {a: 5, b: 10, enabled: true});
  assert.equal(updates.at(-1).received, 200);
  assert.equal(updates.at(-1).total, 200);
  assert.equal(updates.at(-1).stage, 'ready');
});

test('changing songs cancels old downloads before decoding and only installs the new song', async t => {
  const engine = new PracticeEngine();
  let aborts = 0, decodes = 0;
  engine.context = {currentTime: 0, decodeAudioData: async () => { decodes++; return {duration: 20}; }};
  t.mock.method(globalThis, 'fetch', async (url, {signal}) => {
    if (url.startsWith('old')) return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
      aborts++; reject(new DOMException('Cancelled', 'AbortError'));
    }, {once: true}));
    return new Response(new Uint8Array(4));
  });
  const old = engine.load({vocals: 'old-vocals', backing: 'old-backing'}, {duration: 40});
  const latest = engine.load({vocals: 'new-vocals', backing: 'new-backing'}, {duration: 20});
  assert.equal(await old, false);
  assert.equal(await latest, true);
  assert.equal(aborts, 2);
  assert.equal(decodes, 2);
  assert.equal(engine.duration, 20);
  assert.equal(Object.keys(engine.buffers).length, 2);
});

test('a stalled audio download times out and can be retried', async t => {
  const engine = new PracticeEngine();
  engine.context = {currentTime: 0, decodeAudioData: async () => ({duration: 40})};
  let stalled = true;
  t.mock.method(globalThis, 'fetch', async (_url, {signal}) => {
    if (stalled) return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
      reject(new DOMException('Cancelled', 'AbortError'));
    }, {once: true}));
    return new Response(new Uint8Array(4));
  });
  await assert.rejects(engine.load({vocals: 'v', backing: 'b'}, {duration: 40, timeoutMs: 15}), /stopped responding/);
  assert.equal(engine.loadController, null);
  assert.equal(engine.duration, 40);
  stalled = false;
  assert.equal(await engine.load({vocals: 'v', backing: 'b'}), true);
});

test('a failed stem cancels its sibling download and permits a clean retry', async t => {
  const engine = new PracticeEngine();
  engine.context = {currentTime: 0, decodeAudioData: async () => ({duration: 40})};
  let failed = true, aborted = false;
  t.mock.method(globalThis, 'fetch', async (url, {signal}) => {
    if (!failed) return new Response(new Uint8Array(4));
    if (url === 'v') return new Response('unavailable', {status: 503});
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => {
      aborted = true; reject(new DOMException('Cancelled', 'AbortError'));
    }, {once: true}));
  });
  await assert.rejects(engine.load({vocals: 'v', backing: 'b'}), /Please retry/);
  assert.equal(aborted, true);
  failed = false;
  assert.equal(await engine.load({vocals: 'v', backing: 'b'}), true);
});


test('zoom waveform preserves transients, stereo peaks and the final sample', async () => {
  const {detailedWaveform} = await import('../web/waveform.js');
  const left = new Float32Array(44101), right = new Float32Array(44101);
  left[50] = -.8; right[50] = .8; right[44100] = -.6;
  const buffer = {length: left.length, duration: left.length / 44100, numberOfChannels: 2, getChannelData: i => [left, right][i]};
  const result = await detailedWaveform(buffer);
  assert.equal(result.values.length, 201);
  assert.ok(Math.abs(result.values[0] - .8) < 1e-6);
  assert.ok(Math.abs(result.values.at(-1) - .6) < 1e-6);
  assert.ok(Math.abs(result.peak - .8) < 1e-6);
  assert.equal(await detailedWaveform(buffer, () => false), null);
});


test('bass pitch range tracks low B and E with a longer analysis window', () => {
  for (const sr of [44100, 48000, 96000]) for (const hz of [30.8677, 41.2034, 55]) {
    const samples = Float32Array.from({length: 8192}, (_, i) => .2 * Math.sin(2 * Math.PI * hz * i / sr));
    const result = detectPitch(samples, sr, 30);
    assert.ok(result.frequency, `Expected bass pitch ${hz} at ${sr}`);
    assert.ok(Math.abs(1200 * Math.log2(result.frequency / hz)) < 12);
  }
});
