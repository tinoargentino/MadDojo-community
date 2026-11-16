class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.count = 0;
    this.startFrame = 0;
    this.recording = false;
    this.port.onmessage = ({data}) => {
      if (data.type === 'record') {
        this.flush();
        this.recording = true;
        this.port.postMessage({type: 'record-start', frame: currentFrame});
      }
      if (data.type === 'stop') {
        this.flush();
        this.recording = false;
        this.port.postMessage({type: 'record-stop', frame: currentFrame});
      }
    };
  }
  flush() {
    if (!this.count) return;
    const samples = this.buffer.slice(0, this.count);
    this.port.postMessage({type: 'samples', samples, frame: this.startFrame, recording: this.recording}, [samples.buffer]);
    this.count = 0;
  }
  process(inputs, outputs) {
    const input = inputs[0];
    if (!input?.[0]) return true;
    const length = input[0].length;
    for (let i = 0; i < length; i++) {
      if (!this.count) this.startFrame = currentFrame + i;
      let sample = 0;
      for (let ch = 0; ch < input.length; ch++) sample += input[ch][i] / input.length;
      this.buffer[this.count++] = sample;
      if (this.count === this.buffer.length) this.flush();
      // The monitor gain downstream defaults to zero.
      if (outputs[0]?.[0]) outputs[0][0][i] = sample;
    }
    return true;
  }
}
registerProcessor('dojo-capture', CaptureProcessor);
