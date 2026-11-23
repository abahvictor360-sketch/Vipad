import { AudioData, length, toAudioBuffer } from './buffer';

type Listener = () => void;

/** Playback engine around a single shared AudioContext. */
class Player {
  ctx: AudioContext | null = null;
  analyser: AnalyserNode | null = null;
  analyserL: AnalyserNode | null = null;
  analyserR: AnalyserNode | null = null;
  private gain: GainNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private cached: { data: AudioData; buf: AudioBuffer } | null = null;
  private startedAt = 0;
  private startPos = 0; // seconds into the audio when playback started
  private endPos = 0;
  private loopRange: [number, number] | null = null;
  playing = false;
  rate = 1;
  volume = 1;
  sampleRate = 44100;
  private listeners = new Set<Listener>();

  ensure(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.gain = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.75;
      const split = this.ctx.createChannelSplitter(2);
      this.analyserL = this.ctx.createAnalyser();
      this.analyserR = this.ctx.createAnalyser();
      this.analyserL.fftSize = this.analyserR.fftSize = 1024;
      this.gain.connect(this.analyser);
      this.gain.connect(split);
      split.connect(this.analyserL, 0);
      split.connect(this.analyserR, 1);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit() {
    this.listeners.forEach((l) => l());
  }

  private bufferFor(data: AudioData) {
    const ctx = this.ensure();
    if (this.cached?.data !== data) this.cached = { data, buf: toAudioBuffer(ctx, data) };
    return this.cached.buf;
  }

  /** Play `data` from `fromSec`. If `toSec` given, stop (or loop) there. */
  play(data: AudioData, fromSec: number, toSec?: number, loop = false) {
    this.stopSource();
    if (length(data) === 0) return;
    const ctx = this.ensure();
    const buf = this.bufferFor(data);
    this.sampleRate = data.sampleRate;
    const dur = buf.duration;
    const start = Math.max(0, Math.min(fromSec, dur));
    const end = toSec !== undefined ? Math.min(toSec, dur) : dur;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = this.rate;
    src.connect(this.gain!);
    this.gain!.gain.value = this.volume;
    if (loop && end - start > 0.01) {
      src.loop = true;
      src.loopStart = start;
      src.loopEnd = end;
      this.loopRange = [start, end];
      src.start(0, start);
    } else {
      this.loopRange = null;
      src.start(0, start, Math.max(0, end - start));
    }
    src.onended = () => {
      if (this.src === src) {
        this.src = null;
        this.playing = false;
        this.startPos = end;
        this.emit();
      }
    };
    this.src = src;
    this.startedAt = ctx.currentTime;
    this.startPos = start;
    this.endPos = end;
    this.playing = true;
    this.emit();
  }

  /** Play an arbitrary clip (used for effect previews). */
  preview(data: AudioData) {
    this.cached = null;
    this.play(data, 0);
  }

  /** Current playhead in seconds. */
  position(): number {
    if (!this.playing || !this.ctx) return this.startPos;
    const elapsed = (this.ctx.currentTime - this.startedAt) * this.rate;
    if (this.loopRange) {
      const [s, e] = this.loopRange;
      const span = e - s;
      const p = this.startPos + elapsed;
      return p < e ? p : s + ((p - s) % span);
    }
    return Math.min(this.endPos, this.startPos + elapsed);
  }

  private stopSource() {
    if (this.src) {
      const s = this.src;
      this.src = null;
      try { s.onended = null; s.stop(); } catch { /* already stopped */ }
      s.disconnect();
    }
  }

  pause(): number {
    const p = this.position();
    this.stopSource();
    this.playing = false;
    this.startPos = p;
    this.emit();
    return p;
  }

  stop() {
    this.stopSource();
    this.playing = false;
    this.emit();
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }

  setRate(r: number) {
    if (this.playing && this.ctx) {
      // re-anchor so position stays continuous
      this.startPos = this.position();
      this.startedAt = this.ctx.currentTime;
    }
    this.rate = r;
    if (this.src) this.src.playbackRate.value = r;
  }

  invalidate() {
    this.cached = null;
  }

  /** Decode any browser-supported audio file. */
  async decode(buf: ArrayBuffer): Promise<AudioBuffer> {
    const ctx = this.ensure();
    return await ctx.decodeAudioData(buf.slice(0));
  }
}

export const player = new Player();
