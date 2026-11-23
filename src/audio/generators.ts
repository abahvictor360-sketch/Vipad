import { AudioData } from './buffer';
import { linearFromDb } from './analysis';

export type Waveform = 'sine' | 'square' | 'sawtooth' | 'triangle';
export type NoiseColor = 'white' | 'pink' | 'brown';

export function tone(sampleRate: number, numCh: number, seconds: number, freq: number, amplitudeDb = -6, wave: Waveform = 'sine'): AudioData {
  const n = Math.max(0, Math.round(seconds * sampleRate));
  const amp = linearFromDb(amplitudeDb);
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const ph = ((freq * i) / sampleRate) % 1;
    let v: number;
    switch (wave) {
      case 'square':
        v = ph < 0.5 ? 1 : -1;
        break;
      case 'sawtooth':
        v = 2 * ph - 1;
        break;
      case 'triangle':
        v = 1 - 4 * Math.abs(ph - 0.5);
        break;
      default:
        v = Math.sin(2 * Math.PI * ph);
    }
    c[i] = v * amp;
  }
  return { sampleRate, channels: Array.from({ length: Math.max(1, numCh) }, () => new Float32Array(c)) };
}

/** Deterministic PRNG so tests and previews are reproducible. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function noise(sampleRate: number, numCh: number, seconds: number, color: NoiseColor = 'white', amplitudeDb = -12, seed = 1): AudioData {
  const n = Math.max(0, Math.round(seconds * sampleRate));
  const amp = linearFromDb(amplitudeDb);
  const channels: Float32Array[] = [];
  for (let ch = 0; ch < Math.max(1, numCh); ch++) {
    const rnd = mulberry32(seed + ch * 9973);
    const c = new Float32Array(n);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd() * 2 - 1;
      let v = w;
      if (color === 'pink') {
        // Paul Kellet's refined method
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        v = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      } else if (color === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        v = last * 3.5;
      }
      c[i] = Math.max(-1, Math.min(1, v)) * amp;
    }
    channels.push(c);
  }
  return { sampleRate, channels };
}

const DTMF: Record<string, [number, number]> = {
  '1': [697, 1209], '2': [697, 1336], '3': [697, 1477], A: [697, 1633],
  '4': [770, 1209], '5': [770, 1336], '6': [770, 1477], B: [770, 1633],
  '7': [852, 1209], '8': [852, 1336], '9': [852, 1477], C: [852, 1633],
  '*': [941, 1209], '0': [941, 1336], '#': [941, 1477], D: [941, 1633],
};

export function dtmf(sampleRate: number, numCh: number, digits: string, toneMs = 120, gapMs = 80): AudioData {
  const valid = digits.toUpperCase().split('').filter((d) => DTMF[d]);
  const tn = Math.round((toneMs / 1000) * sampleRate);
  const gn = Math.round((gapMs / 1000) * sampleRate);
  const c = new Float32Array(valid.length * (tn + gn));
  valid.forEach((d, k) => {
    const [f1, f2] = DTMF[d];
    const off = k * (tn + gn);
    for (let i = 0; i < tn; i++) c[off + i] = 0.35 * (Math.sin((2 * Math.PI * f1 * i) / sampleRate) + Math.sin((2 * Math.PI * f2 * i) / sampleRate));
  });
  return { sampleRate, channels: Array.from({ length: Math.max(1, numCh) }, () => new Float32Array(c)) };
}
