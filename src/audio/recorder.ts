import { AudioData } from './buffer';

export interface RecorderOptions {
  deviceId?: string;
  channels: 1 | 2;
  echoCancellation: boolean;
  noiseSuppression: boolean;
  autoGainControl: boolean;
}

const WORKLET = `
class VipadCapture extends AudioWorkletProcessor {
  constructor() { super(); this.on = true; this.port.onmessage = (e) => { if (e.data === 'stop') this.on = false; }; }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length) this.port.postMessage(input.map((c) => c.slice(0)));
    return this.on;
  }
}
registerProcessor('vipad-capture', VipadCapture);
`;

/**
 * Microphone recorder capturing raw float PCM (lossless) via AudioWorklet,
 * with ScriptProcessor fallback for older WebViews.
 */
export class Recorder {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  stream: MediaStream | null = null;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[][] = [];
  private frames = 0;
  paused = false;
  peak = 0;
  numCh: number = 2;

  static async devices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'audioinput');
  }

  get sampleRate() {
    return this.ctx?.sampleRate ?? 48000;
  }

  get seconds() {
    return this.frames / this.sampleRate;
  }

  async start(opts: RecorderOptions) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access is not available in this browser (a secure https:// connection is required).');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
        channelCount: { ideal: opts.channels },
        echoCancellation: opts.echoCancellation,
        noiseSuppression: opts.noiseSuppression,
        autoGainControl: opts.autoGainControl,
      },
    });
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.source.connect(this.analyser);
    this.numCh = opts.channels;
    this.chunks = [];
    this.drained = 0;
    this.frames = 0;
    this.paused = false;

    const onData = (chs: Float32Array[]) => {
      let pk = 0;
      for (const c of chs) for (let i = 0; i < c.length; i++) pk = Math.max(pk, Math.abs(c[i]));
      this.peak = Math.max(pk, this.peak * 0.9);
      if (this.paused) return;
      const frame: Float32Array[] = [];
      for (let ch = 0; ch < this.numCh; ch++) frame.push(chs[Math.min(ch, chs.length - 1)]);
      this.chunks.push(frame);
      this.frames += frame[0].length;
    };

    try {
      if (!this.ctx.audioWorklet) throw new Error('no worklet');
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await this.ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const node = new AudioWorkletNode(this.ctx, 'vipad-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: opts.channels, channelCountMode: 'explicit' });
      node.port.onmessage = (e) => onData(e.data as Float32Array[]);
      this.source.connect(node);
      this.node = node;
    } catch {
      const sp = this.ctx.createScriptProcessor(4096, opts.channels, opts.channels);
      sp.onaudioprocess = (e) => {
        const chs: Float32Array[] = [];
        for (let i = 0; i < e.inputBuffer.numberOfChannels; i++) chs.push(new Float32Array(e.inputBuffer.getChannelData(i)));
        onData(chs);
      };
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      this.source.connect(sp);
      sp.connect(mute);
      mute.connect(this.ctx.destination);
      this.node = sp;
    }
  }

  private drained = 0;

  /** Return audio captured since the previous drain (for crash-safe incremental saving). */
  drain(): Float32Array[] | null {
    const pending = this.chunks.slice(this.drained);
    if (!pending.length) return null;
    this.drained = this.chunks.length;
    const n = pending.reduce((s, f) => s + f[0].length, 0);
    const out = Array.from({ length: this.numCh }, () => new Float32Array(n));
    let off = 0;
    for (const f of pending) {
      for (let ch = 0; ch < this.numCh; ch++) out[ch].set(f[ch], off);
      off += f[0].length;
    }
    return out;
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  /** Stop and return the recorded audio. */
  async stop(): Promise<AudioData> {
    if (this.node instanceof AudioWorkletNode) this.node.port.postMessage('stop');
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    const sr = this.sampleRate;
    await this.ctx?.close();
    const channels = Array.from({ length: this.numCh }, () => new Float32Array(this.frames));
    let off = 0;
    for (const frame of this.chunks) {
      for (let ch = 0; ch < this.numCh; ch++) channels[ch].set(frame[ch], off);
      off += frame[0].length;
    }
    this.chunks = [];
    this.ctx = null;
    this.analyser = null;
    return { sampleRate: sr, channels };
  }

  /** Cancel without keeping audio. */
  async cancel() {
    await this.stop();
  }
}
