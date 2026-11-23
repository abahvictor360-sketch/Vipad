import { AudioData, Range, clampRange, length } from './buffer';

/** In-place iterative radix-2 FFT. `re` and `im` must have power-of-two length. */
export function fft(re: Float32Array | Float64Array, im: Float32Array | Float64Array, inverse = false): void {
  const n = re.length;
  if (n & (n - 1)) throw new Error('FFT size must be a power of two');
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

export const dbFromLinear = (v: number) => (v <= 1e-10 ? -Infinity : 20 * Math.log10(v));
export const linearFromDb = (db: number) => Math.pow(10, db / 20);

export interface Stats {
  peak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  dcOffset: number;
  clippedSamples: number;
  duration: number;
}

export function stats(a: AudioData, r?: Range): Stats {
  const { start, end } = r ? clampRange(a, r) : { start: 0, end: length(a) };
  let peak = 0;
  let sumSq = 0;
  let sum = 0;
  let clipped = 0;
  let count = 0;
  for (const c of a.channels) {
    for (let i = start; i < end; i++) {
      const v = c[i];
      const av = Math.abs(v);
      if (av > peak) peak = av;
      if (av >= 0.999) clipped++;
      sumSq += v * v;
      sum += v;
      count++;
    }
  }
  const rms = count ? Math.sqrt(sumSq / count) : 0;
  return {
    peak,
    peakDb: dbFromLinear(peak),
    rms,
    rmsDb: dbFromLinear(rms),
    dcOffset: count ? sum / count : 0,
    clippedSamples: clipped,
    duration: (end - start) / a.sampleRate,
  };
}

/**
 * Compute min/max peak pairs for drawing. Returns interleaved [min0, max0, min1, max1, ...] for one channel.
 */
export function computePeaks(channel: Float32Array, startSample: number, samplesPerPixel: number, pixels: number): Float32Array {
  const out = new Float32Array(pixels * 2);
  const n = channel.length;
  for (let p = 0; p < pixels; p++) {
    const s = Math.floor(startSample + p * samplesPerPixel);
    const e = Math.min(n, Math.floor(startSample + (p + 1) * samplesPerPixel));
    if (s >= n || e <= 0) {
      out[p * 2] = 0;
      out[p * 2 + 1] = 0;
      continue;
    }
    let mn = 1;
    let mx = -1;
    if (e <= s) {
      const v = channel[Math.max(0, s)];
      mn = mx = v;
    } else {
      // stride over very long buckets to keep drawing fast; still catches peaks well in practice
      const step = e - s > 4096 ? Math.ceil((e - s) / 4096) : 1;
      for (let i = Math.max(0, s); i < e; i += step) {
        const v = channel[i];
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    out[p * 2] = mn;
    out[p * 2 + 1] = mx;
  }
  return out;
}

/** Magnitude spectrum (dB) of a block, used by the spectrum view. */
export function spectrum(block: Float32Array, size = 2048): Float32Array {
  const re = new Float32Array(size);
  const im = new Float32Array(size);
  const w = hann(size);
  for (let i = 0; i < size && i < block.length; i++) re[i] = block[i] * w[i];
  fft(re, im);
  const out = new Float32Array(size / 2);
  for (let i = 0; i < size / 2; i++) out[i] = dbFromLinear((Math.hypot(re[i], im[i]) * 2) / size);
  return out;
}

/** Find leading/trailing audio above threshold (dB). Returns null if all silent. */
export function findSoundBounds(a: AudioData, thresholdDb = -50): Range | null {
  const th = linearFromDb(thresholdDb);
  const n = length(a);
  let s = -1;
  let e = -1;
  for (let i = 0; i < n; i++) {
    if (a.channels.some((c) => Math.abs(c[i]) > th)) {
      s = i;
      break;
    }
  }
  if (s < 0) return null;
  for (let i = n - 1; i >= s; i--) {
    if (a.channels.some((c) => Math.abs(c[i]) > th)) {
      e = i + 1;
      break;
    }
  }
  return { start: s, end: e };
}
