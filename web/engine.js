export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export class PracticeEngine extends EventTarget {
  constructor() {
    super();
    this.context = null;
    this.buffers = {};
    this.playing = false;
    this.offset = 0;
    this.anchor = 0;
    this.duration = 0;
    this.loop = {a: 0, b: 10, enabled: false};
    this.volumes = {vocals: .7, backing: .85};
    this.segment = null;
    this.loadGeneration = 0;
    this.loadController = null;
    this.takeSource = null;
    this.starting = false;
    this.transportGeneration = 0;
  }

  ensureContext() {
    if (this.context) return this.context;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) throw new Error('This browser does not support the audio engine. Open in Chrome or Safari.');
    this.context = new Audio({latencyHint: 'interactive'});
    const ctx = this.context;
    this.master = ctx.createGain();
    this.master.gain.value = .88;
    this.master.connect(ctx.destination);
    this.gains = {};
    for (const stem of ['vocals', 'backing']) {
      const gain = ctx.createGain();
      gain.gain.value = this.volumes[stem];
      gain.connect(this.master);
      this.gains[stem] = gain;
    }
    this.dispatchEvent(new Event('context'));
    return ctx;
  }

  cancelLoad() {
    this.loadGeneration++;
    this.loadController?.abort();
    this.loadController = null;
  }

  async load(urls, {duration = this.duration, onProgress = () => {}, timeoutMs = 45000} = {}) {
    this.cancelLoad();
    const generation = this.loadGeneration;
    const controller = new AbortController();
    this.loadController = controller;
    this.pause();
    this.stopTake();
    // Keep the metadata timeline usable while the playback files download.
    this.duration = duration;
    this.buffers = {};
    const progress = Object.fromEntries(Object.keys(urls).map(stem => [stem, {received: 0, total: 0, downloaded: false, decoded: false}]));
    let timer, timedOut = false, lastProgress = 0;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    };
    const notify = (force = false) => {
      if (controller.signal.aborted || generation !== this.loadGeneration) return;
      const now = Date.now();
      if (!force && now - lastProgress < 100) return;
      lastProgress = now;
      const values = Object.values(progress);
      onProgress({
        received: values.reduce((n, p) => n + p.received, 0),
        total: values.every(p => p.total > 0) ? values.reduce((n, p) => n + p.total, 0) : 0,
        stage: values.every(p => p.decoded) ? 'ready' : values.every(p => p.downloaded) ? 'decoding' : 'downloading',
      });
    };
    const current = () => { controller.signal.throwIfAborted(); if (generation !== this.loadGeneration) throw new DOMException('Cancelled', 'AbortError'); };
    try {
      const ctx = this.ensureContext();
      touch(); notify(true);
      const loaded = await Promise.all(Object.entries(urls).map(async ([stem, url]) => {
        const response = await fetch(url, {signal: controller.signal});
        current(); touch();
        if (!response.ok) throw new Error('Could not load practice audio. Please retry.');
        const part = progress[stem];
        part.total = Number(response.headers.get('content-length')) || 0;
        notify(true);
        let bytes;
        if (response.body?.getReader) {
          const reader = response.body.getReader(), chunks = [];
          try {
            while (true) {
              const {done, value} = await reader.read();
              current();
              if (done) break;
              chunks.push(value); part.received += value.byteLength;
              touch(); notify();
            }
          } finally { reader.releaseLock(); }
          bytes = new Uint8Array(part.received);
          let offset = 0;
          for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        } else {
          bytes = new Uint8Array(await response.arrayBuffer());
          part.received = bytes.byteLength;
        }
        current(); touch();
        part.downloaded = true; notify(true);
        const buffer = await ctx.decodeAudioData(bytes.buffer);
        current(); touch();
        part.decoded = true; notify(true);
        return [stem, buffer];
      }));
      current();
      this.buffers = Object.fromEntries(loaded);
      const decodedDuration = Math.min(...loaded.map(([,buffer]) => buffer.duration));
      this.duration = duration > 0 ? Math.min(duration, decodedDuration) : decodedDuration;
      this.offset = clamp(this.offset, 0, this.duration);
      this.loop = {...this.loop, a: clamp(this.loop.a, 0, Math.max(0, this.duration - .05)), b: clamp(this.loop.b, .05, this.duration)};
      this.dispatchEvent(new Event('loaded'));
      return true;
    } catch (error) {
      const cancelled = generation !== this.loadGeneration;
      controller.abort();
      if (cancelled) return false;
      if (timedOut) throw new Error('The audio download stopped responding. Check your connection and retry.');
      throw error;
    } finally {
      clearTimeout(timer);
      if (this.loadController === controller) this.loadController = null;
    }
  }

  positionAt(contextTime) {
    if (!this.playing || !this.context) return this.offset;
    let pos = this.offset + Math.max(0, contextTime - this.anchor);
    if (this.loop.enabled && pos >= this.loop.b) {
      pos = this.loop.a + (pos - this.loop.b) % (this.loop.b - this.loop.a);
    }
    return clamp(pos, 0, this.duration);
  }

  get position() { return this.positionAt(this.context?.currentTime ?? 0); }

  async play() {
    if (!this.duration || this.playing || this.starting) return;
    const generation = ++this.transportGeneration;
    this.starting = true;
    const ctx = this.ensureContext();
    try { await ctx.resume(); }
    catch (error) { if (generation === this.transportGeneration) this.starting = false; throw error; }
    if (generation !== this.transportGeneration) return;
    this.starting = false;
    this.stopTake();
    if (this.offset >= this.duration - .002) this.offset = this.loop.enabled ? this.loop.a : 0;
    if (this.loop.enabled && (this.offset < this.loop.a || this.offset >= this.loop.b)) this.offset = this.loop.a;
    this.playing = true;
    this.startSegment();
    this.dispatchEvent(new Event('transport'));
  }

  startSegment() {
    const ctx = this.context;
    this.retireSegment();
    const at = ctx.currentTime + .004;
    this.anchor = at;
    const segment = {sources: [], envelopes: []};
    for (const stem of ['vocals', 'backing']) {
      const source = ctx.createBufferSource();
      source.buffer = this.buffers[stem];
      source.loop = this.loop.enabled;
      source.loopStart = this.loop.a;
      source.loopEnd = this.loop.b;
      const envelope = ctx.createGain();
      envelope.gain.setValueAtTime(0, at);
      envelope.gain.linearRampToValueAtTime(1, at + .004);
      source.connect(envelope).connect(this.gains[stem]);
      source.start(at, this.offset);
      segment.sources.push(source);
      segment.envelopes.push(envelope);
    }
    segment.sources[0].onended = () => {
      if (this.segment === segment && this.playing && !this.loop.enabled) {
        this.offset = this.duration;
        this.playing = false;
        this.retireSegment();
        this.dispatchEvent(new Event('ended'));
        this.dispatchEvent(new Event('transport'));
      }
    };
    this.segment = segment;
  }

  retireSegment() {
    const segment = this.segment;
    if (!segment) return;
    this.segment = null;
    segment.sources[0].onended = null;
    const at = this.context.currentTime;
    segment.envelopes.forEach(g => {
      g.gain.cancelScheduledValues(at);
      g.gain.setValueAtTime(g.gain.value, at);
      g.gain.linearRampToValueAtTime(0, at + .004);
    });
    segment.sources.forEach(source => {
      try { source.stop(at + .005); } catch { /* Already ended. */ }
      source.onended = () => source.disconnect();
    });
    setTimeout(() => segment.envelopes.forEach(g => g.disconnect()), 100);
  }

  pause() {
    this.transportGeneration++;
    this.starting = false;
    this.offset = this.position;
    this.playing = false;
    this.retireSegment();
    this.dispatchEvent(new Event('transport'));
  }

  stop() { this.pause(); this.seek(this.loop.enabled ? this.loop.a : 0); this.stopTake(); }

  seek(seconds) {
    let target = clamp(seconds, 0, this.duration);
    if (this.loop.enabled && (target < this.loop.a || target >= this.loop.b)) {
      this.loop.enabled = false;
    }
    this.offset = target;
    if (this.playing) {
      if (target >= this.duration) this.pause();
      else this.startSegment();
    }
    this.dispatchEvent(new Event('seek'));
  }

  setLoop(a, b, enabled) {
    const pos = this.position;
    this.loop = {a: clamp(a, 0, Math.max(0, this.duration - .05)), b: clamp(b, a + .05, this.duration), enabled};
    this.offset = pos;
    this.anchor = this.context?.currentTime ?? 0;
    if (enabled && (pos < a || pos >= b)) {
      this.seek(a);
    } else if (this.segment) {
      this.segment.sources.forEach(source => {
        source.loopStart = this.loop.a;
        source.loopEnd = this.loop.b;
        source.loop = enabled;
      });
    }
    this.dispatchEvent(new Event('loop'));
  }

  setVolume(stem, value) {
    this.volumes[stem] = value;
    if (this.gains?.[stem]) this.gains[stem].gain.setTargetAtTime(value, this.context.currentTime, .004);
  }

  async playTake(buffer, metadata, mixBacking = true) {
    this.pause();
    this.stopTake();
    await this.context.resume();
    const at = this.context.currentTime + .01;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.master);
    source.start(at);
    const sources = [source];
    // Follow captured transport segments, including loop wraps, pauses and seeks.
    if (mixBacking && metadata?.segments?.length && this.buffers.backing) {
      for (const seg of metadata.segments) {
        if (!seg.playing || seg.end <= seg.start || seg.start >= buffer.duration) continue;
        const backing = this.context.createBufferSource();
        backing.buffer = this.buffers.backing;
        backing.loop = Boolean(seg.loop?.enabled);
        backing.loopStart = seg.loop?.a ?? 0;
        backing.loopEnd = seg.loop?.b ?? this.duration;
        const gain = this.context.createGain();
        gain.gain.value = this.volumes.backing;
        backing.connect(gain).connect(this.master);
        backing.cleanupGain = gain;
        const length = Math.min(seg.end, buffer.duration) - seg.start;
        backing.start(at + seg.start, clamp(seg.position, 0, this.duration - .001), length);
        sources.push(backing);
      }
    }
    this.takeSource = sources;
    source.onended = () => {
      if (this.takeSource === sources) {
        this.stopTake();
        this.dispatchEvent(new Event('take-ended'));
      }
    };
    this.dispatchEvent(new Event('take-started'));
  }

  stopTake() {
    if (!this.takeSource) return;
    for (const source of this.takeSource) {
      source.onended = null;
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
      source.cleanupGain?.disconnect();
    }
    this.takeSource = null;
    this.dispatchEvent(new Event('take-ended'));
  }

  diagnostics() {
    if (!this.context) return 'Audio ready on play';
    const ms = ((this.context.baseLatency || 0) + (this.context.outputLatency || 0)) * 1000;
    return {sampleRate: this.context.sampleRate, baseLatency: this.context.baseLatency,
      outputLatency: this.context.outputLatency, estimatedMs: ms, state: this.context.state};
  }
}

export function encodeWav(chunks, sampleRate) {
  const frames = chunks.reduce((n, chunk) => n + chunk.length, 0);
  const buffer = new ArrayBuffer(44 + frames * 2);
  const view = new DataView(buffer);
  const string = (at, s) => [...s].forEach((ch, i) => view.setUint8(at + i, ch.charCodeAt(0)));
  string(0, 'RIFF'); view.setUint32(4, 36 + frames * 2, true);
  string(8, 'WAVE'); string(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  string(36, 'data'); view.setUint32(40, frames * 2, true);
  let offset = 44;
  for (const chunk of chunks) for (let sample of chunk) {
    sample = clamp(sample, -1, 1);
    view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
    offset += 2;
  }
  return new Blob([buffer], {type: 'audio/wav'});
}
