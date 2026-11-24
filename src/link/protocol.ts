/** Vipad Link: shared types, pairing codes and Opus/SDP tuning. */
export const PUBLIC_APP_URL = 'https://vipad-five.vercel.app/app.html';

export type Quality = 'voice' | 'music' | 'hifi';
export const QUALITY: Record<Quality, { label: string; channels: 1 | 2; kbps: number; desc: string }> = {
  voice: { label: 'Voice', channels: 1, kbps: 64, desc: 'Mono 64 kbps — clear speech, lowest bandwidth' },
  music: { label: 'Music', channels: 2, kbps: 128, desc: 'Stereo 128 kbps — instruments and singing' },
  hifi: { label: 'Hi-fi', channels: 2, kbps: 256, desc: 'Stereo 256 kbps — near-lossless, needs good Wi-Fi' },
};

export type SignalMsg =
  | { type: 'hello'; from: string; name: string; device: string; quality: Quality }
  | { type: 'welcome'; from: string; to: string; host: string }
  | { type: 'reject'; from: string; to: string; reason: string }
  | { type: 'offer' | 'answer'; from: string; to: string; sdp: string }
  | { type: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }
  | { type: 'bye'; from: string; to?: string }
  | { type: 'ping'; from: string };

// no 0/O, 1/I/L: easy to read aloud and type on a phone
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function makeRoomCode(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  return s;
}

/** Accepts "abc-234", "ABC 234", "abc234" → "ABC234"; null if invalid. */
export function normalizeCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return c.length === 6 && [...c].every((ch) => ALPHABET.includes(ch)) ? c : null;
}

export const formatCode = (c: string) => `${c.slice(0, 3)}-${c.slice(3)}`;
export const joinUrl = (code: string, base = PUBLIC_APP_URL) => `${base}?link=${code}`;
export const peerId = () => Math.random().toString(36).slice(2, 10);

/**
 * Tune Opus in an SDP: stereo, target bitrate, in-band FEC (survives packet loss),
 * no DTX (keeps music continuous) and 10 ms frames for lower latency.
 */
export function tuneOpus(sdp: string, q: Quality, lowLatency: boolean): string {
  const m = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!m) return sdp;
  const pt = m[1];
  const { channels, kbps } = QUALITY[q];
  const params: Record<string, string> = {
    minptime: lowLatency ? '10' : '20',
    useinbandfec: '1',
    usedtx: '0',
    stereo: channels === 2 ? '1' : '0',
    'sprop-stereo': channels === 2 ? '1' : '0',
    maxaveragebitrate: String(kbps * 1000),
    maxplaybackrate: '48000',
  };
  const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  const existing = sdp.match(re);
  const merged: Record<string, string> = {};
  if (existing) for (const kv of existing[1].split(';')) { const [k, v] = kv.trim().split('='); if (k) merged[k] = v ?? ''; }
  Object.assign(merged, params);
  const line = `a=fmtp:${pt} ${Object.entries(merged).map(([k, v]) => `${k}=${v}`).join(';')}`;
  let out = existing ? sdp.replace(re, line) : sdp.replace(m[0], `${m[0]}\r\n${line}`);
  if (lowLatency && !/a=ptime:/.test(out)) out = out.replace(m[0], `${m[0]}\r\na=ptime:10`);
  return out;
}

/** Pick the device that acts as a virtual microphone on this OS, by its output name. */
export const VIRTUAL_MIC_PATTERNS: { re: RegExp; product: string; micName: string }[] = [
  { re: /vipad link/i, product: 'Vipad Link (Linux)', micName: 'Vipad Link Microphone' },
  { re: /cable input/i, product: 'VB-CABLE', micName: 'CABLE Output (VB-Audio Virtual Cable)' },
  { re: /voicemeeter (aux )?input/i, product: 'Voicemeeter', micName: 'Voicemeeter Out B1 / B2' },
  { re: /blackhole/i, product: 'BlackHole', micName: 'BlackHole' },
  { re: /loopback audio/i, product: 'Loopback', micName: 'Loopback Audio' },
];

export function findVirtualOutput(outputs: { deviceId: string; label: string }[]) {
  for (const p of VIRTUAL_MIC_PATTERNS) {
    const d = outputs.find((o) => p.re.test(o.label));
    if (d) return { deviceId: d.deviceId, label: d.label, product: p.product, micName: p.micName };
  }
  return null;
}
