/**
 * VBAN (VB-Audio Voicemeeter network audio) — desktop app only, because browsers cannot open UDP sockets.
 * Send: microphone (or the Vipad Link guests' mix) → Voicemeeter / VBAN Receptor on another computer.
 * Receive: a VBAN stream → the Vipad Link output (virtual microphone), so it can be recorded or used by other apps.
 */
import { create } from 'zustand';
import { ensureHostAudio, hostAudioUsers, releaseHostAudio, useLink } from './store';
import { useSettings } from '../store/settings';

interface VbanPacket { sampleRate: number; channels: number; streamName: string; from: string; samples: Int16Array }
export interface LinkBridge {
  micStatus: () => Promise<{ supported: boolean; active: boolean; error?: string }>;
  createMic: () => Promise<{ active: boolean }>;
  removeMic: () => Promise<{ active: boolean }>;
  vbanSendStart: (o: { host: string; port: number; streamName: string }) => Promise<boolean>;
  vbanPacket: (sampleRate: number, channels: number, pcm: Int16Array) => void;
  vbanSendStop: () => Promise<boolean>;
  vbanRecvStart: (o: { port: number; streamName: string }) => Promise<boolean>;
  vbanRecvStop: () => Promise<boolean>;
  onVbanAudio: (cb: (p: VbanPacket) => void) => () => void;
  onVbanError: (cb: (m: string) => void) => () => void;
}

export const linkBridge = (): LinkBridge | null => (window as unknown as { vipadDesktop?: { link?: LinkBridge } }).vipadDesktop?.link ?? null;

/** Worklet: TX packs input into interleaved Int16 blocks of 256 frames; RX plays a jitter-buffered ring with rate conversion. */
const WORKLET = `
class VbanTx extends AudioWorkletProcessor {
  constructor(o) { super(); this.ch = o.processorOptions.channels; this.buf = new Int16Array(256 * this.ch); this.n = 0; }
  process(inputs) {
    const inp = inputs[0];
    if (!inp || !inp.length) return true;
    const len = inp[0].length;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < this.ch; c++) {
        const s = (inp[c] || inp[0])[i];
        const v = Math.max(-1, Math.min(1, s));
        this.buf[this.n * this.ch + c] = v < 0 ? v * 32768 : v * 32767;
      }
      if (++this.n === 256) { this.port.postMessage(this.buf, [this.buf.buffer]); this.buf = new Int16Array(256 * this.ch); this.n = 0; }
    }
    return true;
  }
}
class VbanRx extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = sampleRate * 2; this.ring = [new Float32Array(this.size), new Float32Array(this.size)];
    this.w = 0; this.r = 0; this.ratio = 1; this.started = false; this.target = Math.round(sampleRate * 0.06);
    this.port.onmessage = (e) => {
      const { samples, channels, rate } = e.data;
      this.ratio = rate / sampleRate;
      const frames = samples.length / channels;
      for (let i = 0; i < frames; i++) {
        const l = samples[i * channels] / 32768, rr = channels > 1 ? samples[i * channels + 1] / 32768 : l;
        this.ring[0][this.w % this.size] = l; this.ring[1][this.w % this.size] = rr; this.w++;
      }
      // too far behind (e.g. tab was asleep): jump forward to keep latency low
      if ((this.w - this.r) > this.target * 4 * this.ratio) this.r = this.w - this.target * this.ratio;
    };
  }
  process(_i, outputs) {
    const out = outputs[0];
    const avail = this.w - this.r;
    if (!this.started) { if (avail < this.target * this.ratio) return true; this.started = true; }
    for (let i = 0; i < out[0].length; i++) {
      if (this.w - this.r < 2) { this.started = false; break; }
      const p = Math.floor(this.r), f = this.r - p;
      for (let c = 0; c < out.length; c++) {
        const ring = this.ring[Math.min(c, 1)];
        out[c][i] = ring[p % this.size] * (1 - f) + ring[(p + 1) % this.size] * f;
      }
      this.r += this.ratio;
    }
    return true;
  }
}
registerProcessor('vban-tx', VbanTx);
registerProcessor('vban-rx', VbanRx);
`;
const loaded = new WeakSet<BaseAudioContext>();
async function loadWorklet(ctx: BaseAudioContext) {
  if (loaded.has(ctx)) return;
  const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
  await ctx.audioWorklet.addModule(url);
  URL.revokeObjectURL(url);
  loaded.add(ctx);
}

interface VbanState {
  sending: boolean;
  sendSource: 'mic' | 'link';
  host: string;
  streamName: string;
  receiving: boolean;
  rxStream: string;
  rxFrom: string | null;
  rxFormat: string | null;
  error: string | null;
  setOpts: (p: Partial<Pick<VbanState, 'sendSource' | 'host' | 'streamName' | 'rxStream'>>) => void;
  startSend: () => Promise<void>;
  stopSend: () => Promise<void>;
  startReceive: () => Promise<void>;
  stopReceive: () => Promise<void>;
}

let txCtx: AudioContext | null = null;
let txStream: MediaStream | null = null;
let txNode: AudioWorkletNode | null = null;
let rxNode: AudioWorkletNode | null = null;
let rxOff: (() => void) | null = null;
let rxErrOff: (() => void) | null = null;

export const useVban = create<VbanState>((set, get) => ({
  sending: false,
  sendSource: 'mic',
  host: '',
  streamName: 'Vipad',
  receiving: false,
  rxStream: '',
  rxFrom: null,
  rxFormat: null,
  error: null,
  setOpts: (p) => set(p),

  startSend: async () => {
    const b = linkBridge();
    if (!b) return set({ error: 'VBAN needs the Vipad desktop app.' });
    const { host, streamName, sendSource } = get();
    if (!/^[\w.-]+$/.test(host.trim())) return set({ error: 'Enter the IP address of the computer running Voicemeeter (e.g. 192.168.1.20).' });
    try {
      const s = useSettings.getState();
      const channels = 2;
      txCtx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
      await loadWorklet(txCtx);
      let src: MediaStream | null;
      if (sendSource === 'link') {
        src = useLink.getState().mixStream();
        if (!src) throw new Error('Start receiving with Vipad Link first, then forward the guests to VBAN.');
      } else {
        txStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: s.micDeviceId ? { exact: s.micDeviceId } : undefined, channelCount: { ideal: 2 }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        src = txStream;
      }
      await b.vbanSendStart({ host: host.trim(), port: s.vbanPort, streamName: streamName || 'Vipad' });
      txNode = new AudioWorkletNode(txCtx, 'vban-tx', { numberOfOutputs: 0, channelCount: channels, channelCountMode: 'explicit', processorOptions: { channels } });
      txNode.port.onmessage = (e) => b.vbanPacket(48000, channels, e.data as Int16Array);
      txCtx.createMediaStreamSource(src).connect(txNode);
      set({ sending: true, error: null });
    } catch (e) {
      await get().stopSend();
      set({ error: (e as Error).message });
    }
  },
  stopSend: async () => {
    txNode?.disconnect();
    txNode = null;
    txStream?.getTracks().forEach((t) => t.stop());
    txStream = null;
    void txCtx?.close();
    txCtx = null;
    await linkBridge()?.vbanSendStop();
    set({ sending: false });
  },

  startReceive: async () => {
    const b = linkBridge();
    if (!b) return set({ error: 'VBAN needs the Vipad desktop app.' });
    try {
      hostAudioUsers.add('vban');
      const { ctx, mixBus } = ensureHostAudio();
      await loadWorklet(ctx);
      rxNode = new AudioWorkletNode(ctx, 'vban-rx', { numberOfInputs: 0, outputChannelCount: [2] });
      rxNode.connect(mixBus);
      rxOff = b.onVbanAudio((p) => {
        rxNode?.port.postMessage({ samples: p.samples, channels: p.channels, rate: p.sampleRate });
        const fmt = `${p.sampleRate / 1000} kHz · ${p.channels === 1 ? 'mono' : `${p.channels} ch`}`;
        if (get().rxFrom !== `${p.from} · ${p.streamName}` || get().rxFormat !== fmt) set({ rxFrom: `${p.from} · ${p.streamName}`, rxFormat: fmt });
      });
      rxErrOff = b.onVbanError((m) => set({ error: `VBAN: ${m}` }));
      await b.vbanRecvStart({ port: useSettings.getState().vbanPort, streamName: get().rxStream.trim() });
      if (ctx.state === 'suspended') await ctx.resume();
      await useLink.getState().refreshOutputs();
      set({ receiving: true, error: null });
    } catch (e) {
      await get().stopReceive();
      set({ error: (e as Error).message });
    }
  },
  stopReceive: async () => {
    rxOff?.();
    rxErrOff?.();
    rxOff = rxErrOff = null;
    rxNode?.disconnect();
    rxNode = null;
    await linkBridge()?.vbanRecvStop();
    hostAudioUsers.delete('vban');
    if (useLink.getState().role !== 'host') releaseHostAudio();
    set({ receiving: false, rxFrom: null, rxFormat: null });
  },
}));
