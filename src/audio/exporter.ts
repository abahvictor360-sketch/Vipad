/** Export rendering: channel conversion, high-quality sample-rate conversion, WAV/MP3 encoding. */
import { AudioData, length, toMono, toStereo } from './buffer';
import { encodeWav, WavBitDepth } from './wav';
import { encodeMp3 } from './mp3';

export type ExportFormat = 'wav' | 'mp3';
export type ExportChannels = 'mono' | 'stereo';

export interface ExportOptions {
  format: ExportFormat;
  bitDepth: WavBitDepth;
  bitrate: number;
  /** Target sample rate in Hz (MIN_RATE..MAX_RATE), or 'keep' for the original rate. */
  sampleRate: number | 'keep';
  /** Explicit mono/stereo, or 'keep' for the original layout. */
  channels: ExportChannels | 'keep';
}

export const MIN_RATE = 10_000;
export const MAX_RATE = 225_000;
export const MP3_MAX_RATE = 48_000;
export const MP3_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];
export const RATE_PRESETS = [11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000, 225000];

export const clampRate = (hz: number) => Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, hz)));
export const isValidRate = (hz: number) => Number.isFinite(hz) && hz >= MIN_RATE && hz <= MAX_RATE;

/** The rate that will actually be written (MP3 only supports a fixed set up to 48 kHz). */
export function effectiveRate(srcRate: number, o: Pick<ExportOptions, 'format' | 'sampleRate'>): number {
  const wanted = o.sampleRate === 'keep' ? srcRate : clampRate(o.sampleRate);
  if (o.format !== 'mp3') return wanted;
  const capped = Math.min(wanted, MP3_MAX_RATE);
  return MP3_RATES.reduce((best, r) => (Math.abs(r - capped) < Math.abs(best - capped) ? r : best), 44100);
}

export const effectiveChannels = (src: AudioData, o: Pick<ExportOptions, 'channels'>) =>
  o.channels === 'keep' ? Math.min(2, src.channels.length) : o.channels === 'mono' ? 1 : 2;

/**
 * High-quality sample-rate conversion.
 * Downsampling: windowed-sinc (Blackman) low-pass at the new Nyquist, so content above it can't alias.
 * Upsampling: 4-point cubic Hermite interpolation (smooth, no new frequency content).
 */
export function resampleHQ(a: AudioData, target: number): AudioData {
  const src = a.sampleRate;
  if (src === target || length(a) === 0) return { sampleRate: target, channels: a.channels.map((c) => new Float32Array(c)) };
  const n = length(a);
  const ratio = src / target;
  const outLen = Math.max(1, Math.round(n / ratio));
  if (ratio < 1) {
    return {
      sampleRate: target,
      channels: a.channels.map((c) => {
        const out = new Float32Array(outLen);
        const at = (i: number) => c[i < 0 ? 0 : i >= n ? n - 1 : i];
        for (let k = 0; k < outLen; k++) {
          const pos = k * ratio;
          const i = Math.floor(pos);
          const t = pos - i;
          const y0 = at(i - 1), y1 = at(i), y2 = at(i + 1), y3 = at(i + 2);
          const c1 = 0.5 * (y2 - y0);
          const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
          const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
          out[k] = ((c3 * t + c2) * t + c1) * t + y1;
        }
        return out;
      }),
    };
  }
  // downsampling: cutoff at 0.95 × target Nyquist, kernel spans ZERO_CROSSINGS lobes of the output rate
  const ZERO_CROSSINGS = 12;
  const cutoff = 0.95 / ratio; // normalised to the source Nyquist
  const half = Math.ceil(ZERO_CROSSINGS * ratio);
  const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  return {
    sampleRate: target,
    channels: a.channels.map((c) => {
      const out = new Float32Array(outLen);
      for (let k = 0; k < outLen; k++) {
        const center = k * ratio;
        const i0 = Math.ceil(center - half);
        const i1 = Math.floor(center + half);
        let acc = 0;
        let wsum = 0;
        for (let i = i0; i <= i1; i++) {
          const d = i - center;
          const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / half) + 0.08 * Math.cos((2 * Math.PI * d) / half); // Blackman
          const h = cutoff * sinc(cutoff * d) * w;
          wsum += h;
          if (i >= 0 && i < n) acc += c[i] * h;
        }
        out[k] = wsum ? acc / wsum : 0;
      }
      return out;
    }),
  };
}

/** Apply channel layout + sample rate exactly as the file will be written. */
export function prepareExport(src: AudioData, o: ExportOptions): AudioData {
  let a = src;
  const ch = effectiveChannels(src, o);
  if (ch === 1 && a.channels.length !== 1) a = toMono(a);
  else if (ch === 2 && a.channels.length !== 2) a = toStereo(a);
  const rate = effectiveRate(src.sampleRate, o);
  if (rate !== a.sampleRate) a = resampleHQ(a, rate);
  return a;
}

export function renderExport(src: AudioData, o: ExportOptions): { blob: Blob; ext: string; audio: AudioData } {
  const a = prepareExport(src, o);
  if (o.format === 'mp3') {
    const bytes = encodeMp3(a, o.bitrate);
    return { blob: new Blob([bytes as BlobPart], { type: 'audio/mpeg' }), ext: 'mp3', audio: a };
  }
  return { blob: new Blob([encodeWav(a, o.bitDepth)], { type: 'audio/wav' }), ext: 'wav', audio: a };
}

export function estimateSize(a: AudioData, o: ExportOptions): number {
  const sec = length(a) / a.sampleRate;
  const ch = effectiveChannels(a, o);
  return o.format === 'mp3' ? (sec * o.bitrate * 1000) / 8 : 44 + sec * effectiveRate(a.sampleRate, o) * ch * (o.bitDepth / 8);
}
