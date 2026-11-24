/**
 * Loudness measurement per ITU-R BS.1770-4 / EBU R128:
 * K-weighting, 400 ms gated blocks (absolute −70 LUFS, relative −10 LU) for integrated loudness,
 * loudness range (LRA) from 3 s short-term blocks, and 4× oversampled true peak.
 */
import { AudioData, length } from './buffer';
import { applyBiquad, biquadCoeffs } from './dsp';

export interface Loudness {
  integrated: number; // LUFS
  range: number; // LU
  truePeak: number; // dBTP
  shortTermMax: number; // LUFS
}

function kWeight(c: Float32Array, sr: number): Float32Array {
  // Stage 1: high shelf ≈ +4 dB above ~1.7 kHz (head effect); stage 2: RLB high-pass ≈ 38 Hz
  const shelf = applyBiquad(c, biquadCoeffs('highshelf', sr, 1681.97, 0.7071752, 3.99984));
  return applyBiquad(shelf, biquadCoeffs('highpass', sr, 38.1355, 0.5003270));
}

const lufs = (ms: number) => (ms > 0 ? -0.691 + 10 * Math.log10(ms) : -Infinity);

function blockLoudness(weighted: Float32Array[], sr: number, blockSec: number, hopSec: number): number[] {
  const n = weighted[0]?.length ?? 0;
  const B = Math.round(blockSec * sr), H = Math.round(hopSec * sr);
  const out: number[] = [];
  if (n < B) {
    if (n === 0) return out;
    let ms = 0;
    for (const c of weighted) { let s = 0; for (let i = 0; i < n; i++) s += c[i] * c[i]; ms += s / n; }
    return [lufs(ms)];
  }
  // prefix sums of squares per channel for O(1) block energy
  const pre = weighted.map((c) => {
    const p = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) p[i + 1] = p[i] + c[i] * c[i];
    return p;
  });
  for (let s = 0; s + B <= n; s += H) {
    let ms = 0;
    for (const p of pre) ms += (p[s + B] - p[s]) / B; // channel weights are 1.0 for L/R/mono
    out.push(lufs(ms));
  }
  return out;
}

function gatedMean(blocks: number[], relGate: number): number {
  const abs = blocks.filter((l) => l > -70);
  if (!abs.length) return -Infinity;
  const mean = (arr: number[]) => lufs(arr.reduce((s, l) => s + 10 ** ((l + 0.691) / 10), 0) / arr.length);
  const rel = mean(abs) + relGate;
  const gated = abs.filter((l) => l > rel);
  return gated.length ? mean(gated) : -Infinity;
}

export function truePeak(a: AudioData): number {
  // 4× oversampling with a short windowed-sinc interpolator catches inter-sample peaks
  let peak = 0;
  const taps = 8;
  for (const c of a.channels) {
    const n = c.length;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(c[i]);
      if (v > peak) peak = v;
      if (v < peak * 0.5) continue; // only look between already-loud samples
      for (let k = 1; k < 4; k++) {
        const t = k / 4;
        let s = 0;
        for (let j = -taps + 1; j <= taps; j++) {
          const idx = i + j;
          if (idx < 0 || idx >= n) continue;
          const x = t - j;
          const w = 0.5 + 0.5 * Math.cos((Math.PI * x) / taps);
          s += c[idx] * (Math.sin(Math.PI * x) / (Math.PI * x)) * w;
        }
        if (Math.abs(s) > peak) peak = Math.abs(s);
      }
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

export function measureLoudness(a: AudioData): Loudness {
  if (!length(a)) return { integrated: -Infinity, range: 0, truePeak: -Infinity, shortTermMax: -Infinity };
  const sr = a.sampleRate;
  const w = a.channels.slice(0, 2).map((c) => kWeight(c, sr));
  const integrated = gatedMean(blockLoudness(w, sr, 0.4, 0.1), -10);
  const st = blockLoudness(w, sr, 3, 1);
  // LRA: 10th–95th percentile of short-term loudness after absolute and −20 LU relative gates
  const abs = st.filter((l) => l > -70);
  let range = 0;
  if (abs.length > 1) {
    const mean = -0.691 + 10 * Math.log10(abs.reduce((s, l) => s + 10 ** ((l + 0.691) / 10), 0) / abs.length);
    const g = abs.filter((l) => l > mean - 20).sort((x, y) => x - y);
    if (g.length > 1) range = g[Math.min(g.length - 1, Math.round(0.95 * (g.length - 1)))] - g[Math.round(0.1 * (g.length - 1))];
  }
  return { integrated, range, truePeak: truePeak(a), shortTermMax: st.length ? Math.max(...st) : integrated };
}

export const LOUDNESS_TARGETS = [
  { value: '-14', label: '−14 LUFS — Spotify, YouTube, Tidal' },
  { value: '-16', label: '−16 LUFS — Apple Music / Apple Podcasts' },
  { value: '-19', label: '−19 LUFS — mono podcast / audiobook' },
  { value: '-23', label: '−23 LUFS — EBU R128 broadcast (Europe)' },
  { value: '-24', label: '−24 LKFS — ATSC A/85 broadcast (US)' },
];
