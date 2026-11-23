/** Multitrack session model + offline mixdown (pure, unit-tested). */
import { AudioData, length, matchChannels, resample } from './buffer';
import { linearFromDb } from './analysis';

export interface Clip {
  id: string;
  name: string;
  audio: AudioData; // already at session sample rate
  start: number; // position on the timeline, in samples
  gainDb: number;
}

export interface Track {
  id: string;
  name: string;
  clips: Clip[];
  volumeDb: number;
  pan: number; // -1 (left) .. 1 (right)
  mute: boolean;
  solo: boolean;
}

export interface Session {
  sampleRate: number;
  tracks: Track[];
}

export const clipEnd = (c: Clip) => c.start + length(c.audio);

export function sessionLength(s: Session): number {
  let n = 0;
  for (const t of s.tracks) for (const c of t.clips) n = Math.max(n, clipEnd(c));
  return n;
}

/** Prepare any audio for a session: resample to session rate and make it stereo. */
export function conform(a: AudioData, sampleRate: number): AudioData {
  return resample(matchChannels(a, 2), sampleRate);
}

/** Equal-power pan gains. */
export function panGains(pan: number): [number, number] {
  const p = Math.max(-1, Math.min(1, pan));
  const angle = ((p + 1) * Math.PI) / 4;
  return [Math.cos(angle) * Math.SQRT2, Math.sin(angle) * Math.SQRT2].map((g) => Math.min(1, g)) as [number, number];
}

export function audibleTracks(s: Session): Track[] {
  const anySolo = s.tracks.some((t) => t.solo);
  return s.tracks.filter((t) => !t.mute && (!anySolo || t.solo));
}

/** Render the whole session to a stereo buffer. */
export function mixdown(s: Session, range?: { start: number; end: number }): AudioData {
  const total = sessionLength(s);
  const start = Math.max(0, range?.start ?? 0);
  const end = Math.min(total, range?.end ?? total);
  const n = Math.max(0, end - start);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (const t of audibleTracks(s)) {
    const [pl, pr] = panGains(t.pan);
    const tv = linearFromDb(t.volumeDb);
    for (const c of t.clips) {
      const g = tv * linearFromDb(c.gainDb);
      const src = c.audio.channels;
      const cl = src[0];
      const cr = src[1] ?? src[0];
      const from = Math.max(c.start, start);
      const to = Math.min(clipEnd(c), end);
      for (let i = from; i < to; i++) {
        const k = i - c.start;
        L[i - start] += cl[k] * g * pl;
        R[i - start] += cr[k] * g * pr;
      }
    }
  }
  return { sampleRate: s.sampleRate, channels: [L, R] };
}

/** Split a clip at an absolute timeline position; returns [left, right] or null if outside. */
export function splitClip(c: Clip, at: number, newId: () => string): [Clip, Clip] | null {
  const k = Math.round(at - c.start);
  if (k <= 0 || k >= length(c.audio)) return null;
  const a: Clip = { ...c, audio: { sampleRate: c.audio.sampleRate, channels: c.audio.channels.map((ch) => ch.slice(0, k)) } };
  const b: Clip = { ...c, id: newId(), name: `${c.name} (2)`, start: c.start + k, audio: { sampleRate: c.audio.sampleRate, channels: c.audio.channels.map((ch) => ch.slice(k)) } };
  return [a, b];
}
