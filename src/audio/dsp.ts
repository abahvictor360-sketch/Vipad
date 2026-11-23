/** Low-level DSP building blocks (biquad filters, envelope followers, time-stretch, STFT denoise). */
import { AudioData, length } from './buffer';
import { fft, hann, linearFromDb } from './analysis';

export type BiquadType = 'lowpass' | 'highpass' | 'bandpass' | 'notch' | 'peaking' | 'lowshelf' | 'highshelf';

export interface BiquadCoeffs {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** RBJ Audio-EQ-Cookbook coefficients, normalised so a0 = 1. */
export function biquadCoeffs(type: BiquadType, sampleRate: number, freq: number, q = Math.SQRT1_2, gainDb = 0): BiquadCoeffs {
  const f = Math.min(Math.max(freq, 1), sampleRate * 0.49);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const alpha = sin / (2 * Math.max(q, 0.0001));
  const A = Math.pow(10, gainDb / 40);
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (type) {
    case 'lowpass':
      b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'highpass':
      b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'bandpass':
      b0 = alpha; b1 = 0; b2 = -alpha; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'notch':
      b0 = 1; b1 = -2 * cos; b2 = 1; a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
      break;
    case 'peaking':
      b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
      break;
    case 'lowshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 - (A - 1) * cos + s); b1 = 2 * A * (A - 1 - (A + 1) * cos); b2 = A * (A + 1 - (A - 1) * cos - s);
      a0 = A + 1 + (A - 1) * cos + s; a1 = -2 * (A - 1 + (A + 1) * cos); a2 = A + 1 + (A - 1) * cos - s;
      break;
    }
    case 'highshelf': {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cos + s); b1 = -2 * A * (A - 1 + (A + 1) * cos); b2 = A * (A + 1 + (A - 1) * cos - s);
      a0 = A + 1 - (A - 1) * cos + s; a1 = 2 * (A - 1 - (A + 1) * cos); a2 = A + 1 - (A - 1) * cos - s;
      break;
    }
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

/** Direct-form-I biquad over a whole channel. */
export function applyBiquad(input: Float32Array, c: BiquadCoeffs): Float32Array {
  const out = new Float32Array(input.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    out[i] = y;
  }
  return out;
}

/** Magnitude response (linear) of a biquad at a frequency — used by tests and the EQ curve UI. */
export function biquadMagnitude(c: BiquadCoeffs, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos1 = Math.cos(w), sin1 = Math.sin(w), cos2 = Math.cos(2 * w), sin2 = Math.sin(2 * w);
  const nr = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const ni = -(c.b1 * sin1 + c.b2 * sin2);
  const dr = 1 + c.a1 * cos1 + c.a2 * cos2;
  const di = -(c.a1 * sin1 + c.a2 * sin2);
  return Math.hypot(nr, ni) / Math.hypot(dr, di);
}

export function mapChannels(a: AudioData, fn: (c: Float32Array, index: number) => Float32Array): AudioData {
  return { sampleRate: a.sampleRate, channels: a.channels.map(fn) };
}

/** Stereo-linked dynamics: computes a gain curve from the loudest channel at each sample. */
export function dynamics(
  a: AudioData,
  gainFor: (levelDb: number) => number, // returns gain in dB to apply for a detected level
  attackMs: number,
  releaseMs: number,
): AudioData {
  const n = length(a);
  const sr = a.sampleRate;
  const atk = Math.exp(-1 / Math.max(1, (attackMs / 1000) * sr));
  const rel = Math.exp(-1 / Math.max(1, (releaseMs / 1000) * sr));
  const out = a.channels.map(() => new Float32Array(n));
  let env = 0;
  for (let i = 0; i < n; i++) {
    let lvl = 0;
    for (const c of a.channels) lvl = Math.max(lvl, Math.abs(c[i]));
    env = lvl > env ? atk * env + (1 - atk) * lvl : rel * env + (1 - rel) * lvl;
    const db = env <= 1e-9 ? -180 : 20 * Math.log10(env);
    const g = Math.pow(10, gainFor(db) / 20);
    for (let ch = 0; ch < a.channels.length; ch++) out[ch][i] = a.channels[ch][i] * g;
  }
  return { sampleRate: sr, channels: out };
}

/**
 * WSOLA time-stretch. `factor` = output length / input length (2 = twice as long / half tempo).
 * Pitch is preserved. Channels share alignment decisions so stereo image stays coherent.
 */
export function timeStretch(a: AudioData, factor: number): AudioData {
  const n = length(a);
  if (n === 0 || Math.abs(factor - 1) < 1e-4) return { sampleRate: a.sampleRate, channels: a.channels.map((c) => new Float32Array(c)) };
  const N = a.sampleRate >= 32000 ? 2048 : 1024;
  const Hs = N / 2;
  const Ha = Hs / factor;
  const tol = N / 4;
  const win = hann(N);
  const outLen = Math.ceil(n * factor);
  const total = outLen + N;
  const outs = a.channels.map(() => new Float32Array(total));
  const norm = new Float32Array(total);
  // Analysis signal: mono mix.
  const mono = new Float32Array(n);
  for (const c of a.channels) for (let i = 0; i < n; i++) mono[i] += c[i] / a.channels.length;
  const at = (i: number) => (i >= 0 && i < n ? mono[i] : 0);

  let prev = 0;
  const frames = Math.ceil(outLen / Hs) + 1;
  for (let k = 0; k < frames; k++) {
    const ideal = Math.round(k * Ha);
    let best = ideal;
    if (k > 0) {
      const target = prev + Hs;
      let bestScore = -Infinity;
      const corr = (d: number, stride: number) => {
        let s = 0;
        const base = ideal + d;
        for (let j = 0; j < Hs; j += stride) s += at(base + j) * at(target + j);
        return s;
      };
      let coarse = 0;
      for (let d = -tol; d <= tol; d += 4) {
        const sc = corr(d, 4);
        if (sc > bestScore) { bestScore = sc; coarse = d; }
      }
      bestScore = -Infinity;
      let fine = coarse;
      for (let d = coarse - 4; d <= coarse + 4; d++) {
        const sc = corr(d, 1);
        if (sc > bestScore) { bestScore = sc; fine = d; }
      }
      best = ideal + fine;
    }
    const outPos = k * Hs;
    if (outPos >= total) break;
    for (let j = 0; j < N && outPos + j < total; j++) {
      const src = best + j;
      const w = win[j];
      norm[outPos + j] += w;
      if (src < 0 || src >= n) continue;
      for (let ch = 0; ch < outs.length; ch++) outs[ch][outPos + j] += a.channels[ch][src] * w;
    }
    prev = best;
  }
  return {
    sampleRate: a.sampleRate,
    channels: outs.map((o) => {
      const r = new Float32Array(outLen);
      for (let i = 0; i < outLen; i++) r[i] = norm[i] > 1e-3 ? o[i] / norm[i] : o[i];
      return r;
    }),
  };
}

/** Change playback speed by resampling (pitch and tempo both change). speed 2 = twice as fast. */
export function changeSpeed(a: AudioData, speed: number): AudioData {
  const n = length(a);
  const outLen = Math.max(1, Math.round(n / speed));
  return mapChannels(a, (c) => {
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * speed;
      const i0 = Math.floor(pos);
      const f = pos - i0;
      const s0 = c[Math.min(i0, n - 1)] ?? 0;
      const s1 = c[Math.min(i0 + 1, n - 1)] ?? 0;
      out[i] = s0 + (s1 - s0) * f;
    }
    return out;
  });
}

/** Pitch shift in semitones keeping duration (time-stretch then resample). */
export function pitchShift(a: AudioData, semitones: number): AudioData {
  if (semitones === 0) return mapChannels(a, (c) => new Float32Array(c));
  const ratio = Math.pow(2, semitones / 12);
  const stretched = timeStretch(a, ratio);
  const shifted = changeSpeed(stretched, ratio);
  const n = length(a);
  return mapChannels(shifted, (c) => {
    const out = new Float32Array(n);
    out.set(c.subarray(0, n));
    return out;
  });
}

/**
 * Spectral-subtraction noise reduction. The noise profile is learned from the quietest
 * frames of the material (or an explicit profile clip).
 */
export function spectralDenoise(a: AudioData, reductionDb: number, sensitivity: number, profile?: AudioData): AudioData {
  const N = 2048;
  const hop = N / 4;
  const win = hann(N);
  const floor = linearFromDb(-Math.abs(reductionDb));
  const n = length(a);
  const bins = N / 2 + 1;

  const frameMags = (c: Float32Array, len: number): Float32Array[] => {
    const res: Float32Array[] = [];
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    for (let pos = -N + hop; pos < len; pos += hop) {
      re.fill(0); im.fill(0);
      for (let j = 0; j < N; j++) {
        const s = pos + j;
        re[j] = s >= 0 && s < len ? c[s] * win[j] : 0;
      }
      fft(re, im);
      const m = new Float32Array(bins);
      for (let b = 0; b < bins; b++) m[b] = Math.hypot(re[b], im[b]);
      res.push(m);
    }
    return res;
  };

  const out = a.channels.map((c, ci) => {
    // ---- noise profile
    const src = profile ? profile.channels[Math.min(ci, profile.channels.length - 1)] : c;
    const mags = frameMags(src, src.length);
    let noise = new Float32Array(bins);
    if (mags.length) {
      const energies = mags.map((m, i) => ({ i, e: m.reduce((s, v) => s + v * v, 0) }));
      energies.sort((x, y) => x.e - y.e);
      const take = profile ? energies.length : Math.max(1, Math.floor(energies.length * 0.1));
      for (let k = 0; k < take; k++) {
        const m = mags[energies[k].i];
        for (let b = 0; b < bins; b++) noise[b] += m[b] / take;
      }
    } else noise = new Float32Array(bins);

    // ---- process
    const res = new Float32Array(n + N);
    const norm = new Float32Array(n + N);
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    const prevGain = new Float32Array(bins).fill(1);
    for (let pos = -N + hop; pos < n; pos += hop) {
      for (let j = 0; j < N; j++) {
        const s = pos + j;
        re[j] = s >= 0 && s < n ? c[s] * win[j] : 0;
        im[j] = 0;
      }
      fft(re, im);
      for (let b = 0; b < bins; b++) {
        const mag = Math.hypot(re[b], im[b]);
        let g = mag > 1e-12 ? 1 - (sensitivity * noise[b]) / mag : 0;
        g = Math.max(floor, Math.min(1, g));
        g = 0.6 * g + 0.4 * prevGain[b]; // temporal smoothing reduces musical noise
        prevGain[b] = g;
        re[b] *= g; im[b] *= g;
        if (b > 0 && b < N / 2) { re[N - b] *= g; im[N - b] *= g; }
      }
      fft(re, im, true);
      for (let j = 0; j < N; j++) {
        const s = pos + j;
        if (s < 0 || s >= n) continue;
        res[s] += re[j] * win[j];
        norm[s] += win[j] * win[j];
      }
    }
    const o = new Float32Array(n);
    for (let i = 0; i < n; i++) o[i] = norm[i] > 1e-6 ? res[i] / norm[i] : 0;
    return o;
  });
  return { sampleRate: a.sampleRate, channels: out };
}

/** Freeverb-style Schroeder/Moorer reverb. Returns input length + tail. */
export function reverb(a: AudioData, roomSize: number, damping: number, wet: number, dry: number, tailSec: number, width = 1): AudioData {
  const sr = a.sampleRate;
  const scale = sr / 44100;
  const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  const apT = [556, 441, 341, 225];
  const n = length(a);
  const outLen = n + Math.round(tailSec * sr);
  const feedback = 0.7 + 0.28 * roomSize;
  const damp = damping * 0.4;
  const stereo = a.channels.length >= 2;
  const inputMono = new Float32Array(n);
  for (const c of a.channels) for (let i = 0; i < n; i++) inputMono[i] += c[i] / a.channels.length;

  const runTank = (spread: number) => {
    const combs = combT.map((t) => ({ buf: new Float32Array(Math.round((t + spread) * scale)), idx: 0, store: 0 }));
    const aps = apT.map((t) => ({ buf: new Float32Array(Math.round((t + spread) * scale)), idx: 0 }));
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const x = (i < n ? inputMono[i] : 0) * 0.015;
      let acc = 0;
      for (const c of combs) {
        const y = c.buf[c.idx];
        c.store = y * (1 - damp) + c.store * damp;
        c.buf[c.idx] = x + c.store * feedback;
        c.idx = (c.idx + 1) % c.buf.length;
        acc += y;
      }
      for (const ap of aps) {
        const bo = ap.buf[ap.idx];
        const y = -acc + bo;
        ap.buf[ap.idx] = acc + bo * 0.5;
        ap.idx = (ap.idx + 1) % ap.buf.length;
        acc = y;
      }
      out[i] = acc;
    }
    return out;
  };
  const wetL = runTank(0);
  const wetR = stereo ? runTank(23) : wetL;
  const w1 = wet * (width / 2 + 0.5);
  const w2 = wet * ((1 - width) / 2);
  return {
    sampleRate: sr,
    channels: a.channels.map((c, ch) => {
      const o = new Float32Array(outLen);
      const mine = ch % 2 === 0 ? wetL : wetR;
      const other = ch % 2 === 0 ? wetR : wetL;
      for (let i = 0; i < outLen; i++) o[i] = (i < n ? c[i] * dry : 0) + mine[i] * w1 + other[i] * w2;
      return o;
    }),
  };
}
