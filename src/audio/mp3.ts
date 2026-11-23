import { Mp3Encoder } from '@breezystack/lamejs';
import { AudioData, length, resample } from './buffer';

const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

/** Encode to MP3 (CBR). Resamples to the nearest MP3-legal rate when needed. */
export function encodeMp3(input: AudioData, kbps = 192, onProgress?: (p: number) => void): Uint8Array {
  const rate = MP3_RATES.reduce((best, r) => (Math.abs(r - input.sampleRate) < Math.abs(best - input.sampleRate) ? r : best), 44100);
  const a = resample(input, rate);
  const numCh = Math.min(2, a.channels.length);
  const enc = new Mp3Encoder(numCh, rate, kbps);
  const n = length(a);
  const block = 1152;
  const toInt = (c: Float32Array, s: number, e: number) => {
    const o = new Int16Array(e - s);
    for (let i = s; i < e; i++) {
      const v = Math.max(-1, Math.min(1, c[i]));
      o[i - s] = v < 0 ? v * 32768 : v * 32767;
    }
    return o;
  };
  const parts: Uint8Array[] = [];
  for (let i = 0; i < n; i += block) {
    const e = Math.min(n, i + block);
    const l = toInt(a.channels[0], i, e);
    const out = numCh === 2 ? enc.encodeBuffer(l, toInt(a.channels[1], i, e)) : enc.encodeBuffer(l);
    if (out.length) parts.push(new Uint8Array(out));
    if (onProgress && (i / block) % 200 === 0) onProgress(i / n);
  }
  const tail = enc.flush();
  if (tail.length) parts.push(new Uint8Array(tail));
  const total = parts.reduce((s, p) => s + p.length, 0);
  const res = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { res.set(p, off); off += p.length; }
  onProgress?.(1);
  return res;
}
