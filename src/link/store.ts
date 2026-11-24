/**
 * Vipad Link engine.
 * Host ("Receive"): shows a code, accepts guests, mixes their audio and plays it into the chosen
 * output — ideally a virtual microphone so other apps (Zoom, OBS, Discord, DAWs) can use it.
 * Guest ("Send"): captures a microphone and streams it to the host over WebRTC (Opus, encrypted).
 */
import { create } from 'zustand';
import { openSignal, iceServers, Signal } from './signal';
import { SignalMsg, Quality, QUALITY, makeRoomCode, peerId, tuneOpus, findVirtualOutput } from './protocol';
import { useSettings } from '../store/settings';

export interface Guest {
  id: string;
  name: string;
  device: string;
  quality: Quality;
  lowLatency: boolean;
  status: 'pending' | 'connecting' | 'connected' | 'reconnecting' | 'lost';
  volume: number;
  muted: boolean;
  level: number;
  latencyMs: number | null;
  kbps: number | null;
}

export interface OutputDevice { deviceId: string; label: string }

interface LinkState {
  role: 'idle' | 'host' | 'guest';
  error: string | null;
  // host
  code: string | null;
  guests: Guest[];
  autoAccept: boolean;
  outputs: OutputDevice[];
  outputId: string;
  virtualOutput: ReturnType<typeof findVirtualOutput>;
  monitor: boolean;
  recordLink: boolean;
  // guest
  sendStatus: 'idle' | 'connecting' | 'waiting' | 'connected' | 'reconnecting' | 'error';
  sendLevel: number;
  sendLatencyMs: number | null;
  sendMuted: boolean;
  hostName: string | null;

  startHosting: (code?: string) => Promise<void>;
  stopHosting: () => void;
  accept: (id: string) => void;
  reject: (id: string) => void;
  kick: (id: string) => void;
  setGuest: (id: string, patch: Partial<Pick<Guest, 'volume' | 'muted'>>) => void;
  setAutoAccept: (v: boolean) => void;
  refreshOutputs: () => Promise<void>;
  setOutput: (deviceId: string) => Promise<void>;
  setMonitor: (v: boolean) => void;
  setRecordLink: (v: boolean) => void;
  mixStream: () => MediaStream | null;

  join: (code: string, opts: { name: string; quality: Quality; lowLatency: boolean; voice: boolean; deviceId?: string }) => Promise<void>;
  leave: () => void;
  toggleSendMute: () => void;
}

// ---------------------------------------------------------------- runtime objects (not in React state)
const me = peerId();
let signal: Signal | null = null;
let ctx: AudioContext | null = null;
let mixBus: GainNode | null = null;
let mixDest: MediaStreamAudioDestinationNode | null = null;
let monitorEl: HTMLAudioElement | null = null;
const peers = new Map<string, { pc: RTCPeerConnection; gain?: GainNode; analyser?: AnalyserNode; holder?: HTMLAudioElement; pendingIce: RTCIceCandidateInit[] }>();
let meterTimer: ReturnType<typeof setInterval> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;
// guest side
let guestPc: RTCPeerConnection | null = null;
let guestStream: MediaStream | null = null;
let guestAnalyser: AnalyserNode | null = null;
let guestCtx: AudioContext | null = null;
let wakeLock: { release: () => Promise<void> } | null = null;
let hostId: string | null = null;
const guestPendingIce: RTCIceCandidateInit[] = [];

const turn = () => {
  const s = useSettings.getState();
  return s.linkTurnUrl ? { url: s.linkTurnUrl, username: s.linkTurnUser, credential: s.linkTurnPass } : null;
};

function peak(an: AnalyserNode, buf: Float32Array) {
  an.getFloatTimeDomainData(buf);
  let p = 0;
  for (const v of buf) p = Math.max(p, Math.abs(v));
  return p;
}

/** One-way latency estimate: network (RTT/2) + jitter buffer + Opus frame + output device. */
async function measureLatency(pc: RTCPeerConnection, outLatencySec: number): Promise<{ ms: number | null; kbps: number | null }> {
  const stats = await pc.getStats();
  let rtt: number | null = null, jb: number | null = null, kbps: number | null = null;
  stats.forEach((r) => {
    if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated && typeof r.currentRoundTripTime === 'number') rtt = r.currentRoundTripTime;
    if (r.type === 'inbound-rtp' && r.kind === 'audio' && r.jitterBufferEmittedCount) jb = r.jitterBufferDelay / r.jitterBufferEmittedCount;
    if ((r.type === 'inbound-rtp' || r.type === 'outbound-rtp') && r.kind === 'audio') {
      const prev = lastBytes.get(r.id);
      const bytes = r.bytesReceived ?? r.bytesSent ?? 0;
      if (prev) kbps = ((bytes - prev.bytes) * 8) / (r.timestamp - prev.t);
      lastBytes.set(r.id, { bytes, t: r.timestamp });
    }
  });
  if (rtt === null) return { ms: null, kbps };
  return { ms: Math.round((rtt / 2 + (jb ?? 0.04) + 0.02 + outLatencySec) * 1000), kbps: kbps === null ? null : Math.round(kbps) };
}
const lastBytes = new Map<string, { bytes: number; t: number }>();

/** Other features (VBAN receive) that keep the receiving audio graph alive after hosting stops. */
export const hostAudioUsers = new Set<string>();
export function releaseHostAudio() {
  monitorEl?.pause();
  void ctx?.close();
  ctx = mixBus = mixDest = null;
  monitorEl = null;
}

/** The receiving audio graph (created on demand): everything connected to mixBus reaches the chosen output. */
export function ensureHostAudio() {
  if (ctx) return { ctx, mixBus: mixBus! };
  ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: 48000 });
  mixBus = ctx.createGain();
  mixDest = ctx.createMediaStreamDestination();
  mixBus.connect(ctx.destination);
  mixBus.connect(mixDest);
  monitorEl = new Audio();
  monitorEl.srcObject = mixDest.stream;
  return { ctx, mixBus };
}

export const useLink = create<LinkState>((set, get) => {
  const patchGuest = (id: string, patch: Partial<Guest>) => set((s) => ({ guests: s.guests.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));

  function dropPeer(id: string) {
    const p = peers.get(id);
    if (p) {
      p.pc.close();
      p.gain?.disconnect();
      p.holder?.pause();
      peers.delete(id);
    }
  }

  async function onHostMessage(m: SignalMsg) {
    if ('to' in m && m.to && m.to !== me) return;
    if (m.type === 'hello') {
      const existing = get().guests.find((g) => g.id === m.from);
      if (!existing) {
        set((s) => ({ guests: [...s.guests, { id: m.from, name: m.name || 'Guest', device: m.device, quality: m.quality, lowLatency: !!(m as { lowLatency?: boolean }).lowLatency, status: 'pending', volume: 1, muted: false, level: 0, latencyMs: null, kbps: null }] }));
      }
      if (get().autoAccept) get().accept(m.from);
      return;
    }
    if (m.type === 'offer') {
      const g = get().guests.find((x) => x.id === m.from);
      if (!g || g.status === 'pending') return;
      const { ctx: hctx } = ensureHostAudio();
      if (hctx.state === 'suspended') void hctx.resume();
      dropPeer(m.from);
      const pc = new RTCPeerConnection({ iceServers: iceServers(turn()) });
      const entry: { pc: RTCPeerConnection; gain?: GainNode; analyser?: AnalyserNode; holder?: HTMLAudioElement; pendingIce: RTCIceCandidateInit[] } = { pc, pendingIce: [] };
      peers.set(m.from, entry);
      pc.onicecandidate = (e) => e.candidate && signal?.send({ type: 'ice', from: me, to: m.from, candidate: e.candidate.toJSON() });
      pc.ontrack = (e) => {
        const stream = e.streams[0] ?? new MediaStream([e.track]);
        // Chrome only pulls remote audio into Web Audio if it is also attached to a media element
        const holder = new Audio();
        holder.srcObject = stream;
        holder.muted = true;
        void holder.play().catch(() => undefined);
        const src = ctx!.createMediaStreamSource(stream);
        const gain = ctx!.createGain();
        const analyser = ctx!.createAnalyser();
        analyser.fftSize = 512;
        src.connect(gain);
        gain.connect(analyser);
        gain.connect(mixBus!);
        Object.assign(entry, { gain, analyser, holder });
        const cur = get().guests.find((x) => x.id === m.from);
        gain.gain.value = cur?.muted ? 0 : cur?.volume ?? 1;
        if (g.lowLatency && 'jitterBufferTarget' in e.receiver) (e.receiver as RTCRtpReceiver & { jitterBufferTarget: number | null }).jitterBufferTarget = 0;
      };
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') patchGuest(m.from, { status: 'connected' });
        else if (st === 'disconnected') patchGuest(m.from, { status: 'reconnecting' });
        else if (st === 'failed') patchGuest(m.from, { status: 'lost' });
      };
      await pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
      for (const c of entry.pendingIce.splice(0)) await pc.addIceCandidate(c).catch(() => undefined);
      const answer = await pc.createAnswer();
      answer.sdp = tuneOpus(answer.sdp ?? '', g.quality, g.lowLatency);
      await pc.setLocalDescription(answer);
      signal?.send({ type: 'answer', from: me, to: m.from, sdp: answer.sdp! });
      patchGuest(m.from, { status: 'connecting' });
      return;
    }
    if (m.type === 'ice') {
      const p = peers.get(m.from);
      if (!p) return;
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(m.candidate).catch(() => undefined);
      else p.pendingIce.push(m.candidate);
      return;
    }
    if (m.type === 'bye') {
      dropPeer(m.from);
      set((s) => ({ guests: s.guests.filter((g) => g.id !== m.from) }));
    }
  }

  async function onGuestMessage(m: SignalMsg, opts: { quality: Quality; lowLatency: boolean }) {
    if ('to' in m && m.to && m.to !== me) return;
    if (m.type === 'welcome') {
      hostId = m.from;
      set({ hostName: m.host, sendStatus: 'connecting' });
      const pc = new RTCPeerConnection({ iceServers: iceServers(turn()) });
      guestPc = pc;
      pc.onicecandidate = (e) => e.candidate && signal?.send({ type: 'ice', from: me, to: m.from, candidate: e.candidate.toJSON() });
      for (const t of guestStream!.getAudioTracks()) pc.addTrack(t, guestStream!);
      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        if (st === 'connected') set({ sendStatus: 'connected', error: null });
        else if (st === 'disconnected') set({ sendStatus: 'reconnecting' });
        else if (st === 'failed') set({ sendStatus: 'error', error: 'The connection failed. If the devices are on different networks, add a TURN relay in Settings → Vipad Link.' });
      };
      const offer = await pc.createOffer();
      offer.sdp = tuneOpus(offer.sdp ?? '', opts.quality, opts.lowLatency);
      await pc.setLocalDescription(offer);
      const sender = pc.getSenders()[0];
      if (sender) {
        const params = sender.getParameters();
        params.encodings = params.encodings?.length ? params.encodings : [{}];
        params.encodings[0].maxBitrate = QUALITY[opts.quality].kbps * 1000;
        params.encodings[0].priority = 'high';
        params.encodings[0].networkPriority = 'high';
        await sender.setParameters(params).catch(() => undefined);
      }
      signal?.send({ type: 'offer', from: me, to: m.from, sdp: offer.sdp! });
      return;
    }
    if (m.type === 'answer' && guestPc) {
      await guestPc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
      for (const c of guestPendingIce.splice(0)) await guestPc.addIceCandidate(c).catch(() => undefined);
      return;
    }
    if (m.type === 'ice') {
      if (guestPc?.remoteDescription) await guestPc.addIceCandidate(m.candidate).catch(() => undefined);
      else guestPendingIce.push(m.candidate);
      return;
    }
    if (m.type === 'reject') {
      set({ sendStatus: 'error', error: m.reason });
      get().leave();
      set({ sendStatus: 'error', error: m.reason });
      return;
    }
    if (m.type === 'bye' && m.from === hostId) {
      get().leave();
      set({ sendStatus: 'error', error: 'The receiver ended the session.' });
    }
  }

  function startMeters() {
    if (meterTimer) return;
    const buf = new Float32Array(512);
    meterTimer = setInterval(() => {
      const st = get();
      if (st.role === 'host') {
        set({ guests: st.guests.map((g) => { const p = peers.get(g.id); return p?.analyser ? { ...g, level: Math.max(peak(p.analyser, buf), g.level * 0.7) } : g; }) });
      } else if (st.role === 'guest' && guestAnalyser) {
        set({ sendLevel: Math.max(peak(guestAnalyser, buf), st.sendLevel * 0.7) });
      }
    }, 80);
    statsTimer = setInterval(async () => {
      const st = get();
      if (st.role === 'host') {
        for (const [id, p] of peers) {
          const r = await measureLatency(p.pc, (ctx?.outputLatency || ctx?.baseLatency || 0.01));
          patchGuest(id, { latencyMs: r.ms, kbps: r.kbps });
        }
      } else if (st.role === 'guest' && guestPc) {
        const r = await measureLatency(guestPc, 0.02);
        set({ sendLatencyMs: r.ms });
      }
    }, 1000);
  }
  function stopMeters() {
    if (meterTimer) clearInterval(meterTimer);
    if (statsTimer) clearInterval(statsTimer);
    meterTimer = statsTimer = null;
  }

  return {
    role: 'idle',
    error: null,
    code: null,
    guests: [],
    autoAccept: false,
    outputs: [],
    outputId: '',
    virtualOutput: null,
    monitor: false,
    recordLink: false,
    sendStatus: 'idle',
    sendLevel: 0,
    sendLatencyMs: null,
    sendMuted: false,
    hostName: null,

    startHosting: async (code) => {
      if (get().role !== 'idle') return;
      const room = code ?? makeRoomCode();
      set({ role: 'host', code: room, guests: [], error: null });
      try {
        signal = await openSignal(room);
        signal.onMessage((m) => void onHostMessage(m));
        ensureHostAudio();
        await get().refreshOutputs();
        startMeters();
      } catch (e) {
        set({ role: 'idle', code: null, error: (e as Error).message });
      }
    },
    stopHosting: () => {
      signal?.send({ type: 'bye', from: me });
      for (const id of [...peers.keys()]) dropPeer(id);
      signal?.close();
      signal = null;
      stopMeters();
      if (!hostAudioUsers.size) releaseHostAudio();
      set({ role: 'idle', code: null, guests: [], monitor: false, recordLink: false });
    },
    accept: (id) => {
      const g = get().guests.find((x) => x.id === id);
      if (!g) return;
      patchGuest(id, { status: 'connecting' });
      signal?.send({ type: 'welcome', from: me, to: id, host: useSettings.getState().linkName || 'Vipad' });
    },
    reject: (id) => {
      signal?.send({ type: 'reject', from: me, to: id, reason: 'The receiver declined your request.' });
      set((s) => ({ guests: s.guests.filter((g) => g.id !== id) }));
    },
    kick: (id) => {
      signal?.send({ type: 'reject', from: me, to: id, reason: 'The receiver disconnected you.' });
      dropPeer(id);
      set((s) => ({ guests: s.guests.filter((g) => g.id !== id) }));
    },
    setGuest: (id, patch) => {
      patchGuest(id, patch);
      const g = get().guests.find((x) => x.id === id);
      const p = peers.get(id);
      if (g && p?.gain) p.gain.gain.value = g.muted ? 0 : g.volume;
    },
    setAutoAccept: (v) => {
      set({ autoAccept: v });
      if (v) for (const g of get().guests) if (g.status === 'pending') get().accept(g.id);
    },
    refreshOutputs: async () => {
      const all = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
      const outputs = all.filter((d) => d.kind === 'audiooutput').map((d) => ({ deviceId: d.deviceId, label: d.label || 'Speaker' }));
      const virtualOutput = findVirtualOutput(outputs);
      set({ outputs, virtualOutput });
      // route into the virtual microphone automatically when one exists
      if (virtualOutput && !get().outputId) await get().setOutput(virtualOutput.deviceId);
    },
    setOutput: async (deviceId) => {
      set({ outputId: deviceId });
      const c = ctx as (AudioContext & { setSinkId?: (id: string) => Promise<void> }) | null;
      try {
        await c?.setSinkId?.(deviceId === 'default' ? '' : deviceId);
      } catch (e) {
        set({ error: `Could not use that output: ${(e as Error).message}` });
      }
    },
    setMonitor: (v) => {
      set({ monitor: v });
      if (!monitorEl) return;
      if (v) void monitorEl.play().catch(() => undefined);
      else monitorEl.pause();
    },
    setRecordLink: (v) => set({ recordLink: v }),
    mixStream: () => mixDest?.stream ?? null,

    join: async (code, opts) => {
      if (get().role !== 'idle') get().leave();
      set({ role: 'guest', sendStatus: 'connecting', error: null, hostName: null, sendLatencyMs: null });
      try {
        const q = QUALITY[opts.quality];
        guestStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: opts.deviceId ? { exact: opts.deviceId } : undefined,
            channelCount: { ideal: q.channels },
            sampleRate: { ideal: 48000 },
            echoCancellation: opts.voice,
            noiseSuppression: opts.voice,
            autoGainControl: opts.voice,
          },
        });
        guestCtx = new AudioContext();
        if (guestCtx.state === 'suspended') await guestCtx.resume().catch(() => undefined);
        guestAnalyser = guestCtx.createAnalyser();
        guestAnalyser.fftSize = 512;
        guestCtx.createMediaStreamSource(guestStream).connect(guestAnalyser);
        try { wakeLock = await (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { wakeLock = null; }
        signal = await openSignal(code);
        signal.onMessage((m) => void onGuestMessage(m, opts));
        set({ sendStatus: 'waiting' });
        startMeters();
        const hello = () => signal?.send({ type: 'hello', from: me, name: opts.name || 'Guest', device: navigator.userAgent.includes('Mobile') ? 'Phone' : 'Computer', quality: opts.quality, lowLatency: opts.lowLatency } as SignalMsg);
        hello();
        // repeat the hello until the receiver answers (it may open the code a moment later)
        const retry = setInterval(() => { if (get().sendStatus === 'waiting') hello(); else clearInterval(retry); }, 3000);
      } catch (e) {
        const err = e as DOMException;
        get().leave();
        set({ sendStatus: 'error', error: err.name === 'NotAllowedError' ? 'Microphone permission was denied. Allow microphone access and try again.' : err.message || 'Could not connect.' });
      }
    },
    leave: () => {
      if (hostId) signal?.send({ type: 'bye', from: me, to: hostId });
      guestPc?.close();
      guestPc = null;
      guestStream?.getTracks().forEach((t) => t.stop());
      guestStream = null;
      void guestCtx?.close();
      guestCtx = null;
      guestAnalyser = null;
      void wakeLock?.release().catch(() => undefined);
      wakeLock = null;
      hostId = null;
      guestPendingIce.length = 0;
      signal?.close();
      signal = null;
      stopMeters();
      set({ role: 'idle', sendStatus: 'idle', sendLevel: 0, sendMuted: false, hostName: null });
    },
    toggleSendMute: () => {
      const m = !get().sendMuted;
      guestStream?.getAudioTracks().forEach((t) => (t.enabled = !m));
      set({ sendMuted: m });
    },
  };
});

export const linkActive = () => useLink.getState().role !== 'idle';
