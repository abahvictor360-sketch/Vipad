/**
 * Core, framework-free representation of audio used throughout Vipad.
 * All editing operations are pure: they never mutate their input and return new data.
 */
export interface AudioData {
  sampleRate: number;
  channels: Float32Array[];
}

export interface Range {
  start: number; // inclusive sample index
  end: number; // exclusive sample index
}

export function length(a: AudioData): number {
  return a.channels[0]?.length ?? 0;
}

export function duration(a: AudioData): number {
  return length(a) / a.sampleRate;
}

export function numChannels(a: AudioData): number {
  return a.channels.length;
}

export function createSilence(sampleRate: number, numCh: number, frames: number): AudioData {
  return {
    sampleRate,
    channels: Array.from({ length: Math.max(1, numCh) }, () => new Float32Array(Math.max(0, Math.floor(frames)))),
  };
}

export function clone(a: AudioData): AudioData {
  return { sampleRate: a.sampleRate, channels: a.channels.map((c) => new Float32Array(c)) };
}

export function clampRange(a: AudioData, r: Range): Range {
  const n = length(a);
  const s = Math.max(0, Math.min(n, Math.floor(Math.min(r.start, r.end))));
  const e = Math.max(0, Math.min(n, Math.floor(Math.max(r.start, r.end))));
  return { start: s, end: e };
}

export function slice(a: AudioData, r: Range): AudioData {
  const { start, end } = clampRange(a, r);
  return { sampleRate: a.sampleRate, channels: a.channels.map((c) => c.slice(start, end)) };
}

/** Make `b` match `a`'s channel count (duplicating / mixing as needed). Sample rate must already match. */
export function matchChannels(b: AudioData, numCh: number): AudioData {
  if (b.channels.length === numCh) return b;
  if (numCh === 1) return toMono(b);
  const out: Float32Array[] = [];
  for (let i = 0; i < numCh; i++) out.push(new Float32Array(b.channels[Math.min(i, b.channels.length - 1)]));
  return { sampleRate: b.sampleRate, channels: out };
}

export function remove(a: AudioData, r: Range): AudioData {
  const { start, end } = clampRange(a, r);
  const n = length(a);
  return {
    sampleRate: a.sampleRate,
    channels: a.channels.map((c) => {
      const out = new Float32Array(n - (end - start));
      out.set(c.subarray(0, start), 0);
      out.set(c.subarray(end), start);
      return out;
    }),
  };
}

export function insert(a: AudioData, at: number, b: AudioData): AudioData {
  const src = resample(matchChannels(b, a.channels.length), a.sampleRate);
  const pos = Math.max(0, Math.min(length(a), Math.floor(at)));
  const bl = length(src);
  return {
    sampleRate: a.sampleRate,
    channels: a.channels.map((c, i) => {
      const out = new Float32Array(c.length + bl);
      out.set(c.subarray(0, pos), 0);
      out.set(src.channels[i], pos);
      out.set(c.subarray(pos), pos + bl);
      return out;
    }),
  };
}

/** Replace range `r` in `a` with `b` (lengths may differ). */
export function replace(a: AudioData, r: Range, b: AudioData): AudioData {
  const cr = clampRange(a, r);
  return insert(remove(a, cr), cr.start, b);
}

/** Mix `b` onto `a` starting at `at` (overdub), extending `a` if needed. */
export function mixInto(a: AudioData, at: number, b: AudioData, gain = 1): AudioData {
  const src = resample(matchChannels(b, a.channels.length), a.sampleRate);
  const pos = Math.max(0, Math.floor(at));
  const newLen = Math.max(length(a), pos + length(src));
  return {
    sampleRate: a.sampleRate,
    channels: a.channels.map((c, i) => {
      const out = new Float32Array(newLen);
      out.set(c);
      const s = src.channels[i];
      for (let j = 0; j < s.length; j++) out[pos + j] += s[j] * gain;
      return out;
    }),
  };
}

export function concat(a: AudioData, b: AudioData): AudioData {
  return insert(a, length(a), b);
}

/** Keep only the range (crop / trim). */
export function crop(a: AudioData, r: Range): AudioData {
  return slice(a, r);
}

export function silenceRange(a: AudioData, r: Range): AudioData {
  const { start, end } = clampRange(a, r);
  const out = clone(a);
  for (const c of out.channels) c.fill(0, start, end);
  return out;
}

export function insertSilence(a: AudioData, at: number, seconds: number): AudioData {
  return insert(a, at, createSilence(a.sampleRate, a.channels.length, seconds * a.sampleRate));
}

export function toMono(a: AudioData): AudioData {
  if (a.channels.length === 1) return clone(a);
  const n = length(a);
  const out = new Float32Array(n);
  const k = 1 / a.channels.length;
  for (const c of a.channels) for (let i = 0; i < n; i++) out[i] += c[i] * k;
  return { sampleRate: a.sampleRate, channels: [out] };
}

export function toStereo(a: AudioData): AudioData {
  if (a.channels.length === 2) return clone(a);
  const m = toMono(a).channels[0];
  return { sampleRate: a.sampleRate, channels: [new Float32Array(m), new Float32Array(m)] };
}

/** Band-limited-enough linear-interpolating resampler with a simple anti-alias pre-filter when downsampling. */
export function resample(a: AudioData, targetRate: number): AudioData {
  if (a.sampleRate === targetRate || length(a) === 0) {
    return a.sampleRate === targetRate ? a : { sampleRate: targetRate, channels: a.channels.map((c) => new Float32Array(c)) };
  }
  const ratio = a.sampleRate / targetRate;
  const n = length(a);
  const outLen = Math.max(1, Math.round(n / ratio));
  const channels = a.channels.map((c) => {
    let src = c;
    if (ratio > 1) {
      // crude moving-average low-pass to reduce aliasing when downsampling
      const w = Math.max(1, Math.round(ratio));
      if (w > 1) {
        src = new Float32Array(n);
        let acc = 0;
        for (let i = 0; i < n; i++) {
          acc += c[i];
          if (i >= w) acc -= c[i - w];
          src[i] = acc / Math.min(i + 1, w);
        }
      }
    }
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = i * ratio;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      const s0 = src[Math.min(i0, n - 1)];
      const s1 = src[Math.min(i0 + 1, n - 1)];
      out[i] = s0 + (s1 - s0) * frac;
    }
    return out;
  });
  return { sampleRate: targetRate, channels };
}

export function fromAudioBuffer(b: AudioBuffer): AudioData {
  const channels: Float32Array[] = [];
  for (let i = 0; i < b.numberOfChannels; i++) channels.push(new Float32Array(b.getChannelData(i)));
  return { sampleRate: b.sampleRate, channels };
}

export function toAudioBuffer(ctx: BaseAudioContext, a: AudioData): AudioBuffer {
  const buf = ctx.createBuffer(a.channels.length, Math.max(1, length(a)), a.sampleRate);
  a.channels.forEach((c, i) => buf.copyToChannel(c, i));
  return buf;
}

export function byteSize(a: AudioData): number {
  return a.channels.reduce((s, c) => s + c.byteLength, 0);
}
