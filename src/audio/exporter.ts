/** Export rendering: channel conversion, high-quality sample-rate conversion and encoding to every supported format. */
import { AudioData, length, toMono, toStereo } from './buffer';
import { encodeWav, WavBitDepth } from './wav';
import { encodeMp3 } from './mp3';
import { encodeFlac } from './codecs/flac';
import { encodeAiff } from './codecs/aiff';
import { encodeAu } from './codecs/au';
import { quantize } from './codecs/bits';
import { Tags, id3v2, hasTags, concatBytes } from './codecs/tags';
import { canEncode, encodeOggOpus, encodeWebmOpus, encodeM4a } from './codecs/webcodecs';

export type ExportFormat = 'mp3' | 'm4a' | 'ogg' | 'webm' | 'wav' | 'flac' | 'aiff' | 'au' | 'raw';
export type ExportChannels = 'mono' | 'stereo';
export type Encoding = 'pcm' | 'ulaw' | 'alaw';

export interface FormatInfo {
  label: string;
  ext: string;
  mime: string;
  group: 'Compressed (small files)' | 'Lossless (studio quality)' | 'Other';
  description: string;
  /** Fixed set of sample rates the format allows; undefined = any 10–225 kHz. */
  rates?: number[];
  bitDepths?: number[];
  encodings?: Encoding[];
  bitrates?: number[];
  tags: boolean;
  /** Needs the platform encoder (checked with canEncode). */
  platform?: 'opus' | 'aac';
}

export const FORMATS: Record<ExportFormat, FormatInfo> = {
  mp3: { label: 'MP3', ext: 'mp3', mime: 'audio/mpeg', group: 'Compressed (small files)', description: 'Plays everywhere. Best for sharing.', rates: [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000], bitrates: [64, 96, 128, 160, 192, 256, 320], tags: true },
  m4a: { label: 'M4A (AAC)', ext: 'm4a', mime: 'audio/mp4', group: 'Compressed (small files)', description: 'Apple / iPhone / YouTube standard. Better than MP3 at the same size.', rates: [44100, 48000], bitrates: [96, 128, 160, 192, 256, 320], tags: false, platform: 'aac' },
  ogg: { label: 'OGG (Opus)', ext: 'ogg', mime: 'audio/ogg', group: 'Compressed (small files)', description: 'Modern open codec — excellent quality at small sizes. Great for voice.', rates: [48000], bitrates: [32, 48, 64, 96, 128, 160, 192, 256], tags: true, platform: 'opus' },
  webm: { label: 'WebM (Opus)', ext: 'webm', mime: 'audio/webm', group: 'Compressed (small files)', description: 'Opus audio in a WebM container, for the web.', rates: [48000], bitrates: [32, 48, 64, 96, 128, 160, 192, 256], tags: false, platform: 'opus' },
  wav: { label: 'WAV', ext: 'wav', mime: 'audio/wav', group: 'Lossless (studio quality)', description: 'Uncompressed — exact quality, universally supported.', bitDepths: [8, 16, 24, 32], encodings: ['pcm', 'ulaw', 'alaw'], tags: true },
  flac: { label: 'FLAC', ext: 'flac', mime: 'audio/flac', group: 'Lossless (studio quality)', description: 'Lossless and about half the size of WAV.', bitDepths: [16, 24], tags: true },
  aiff: { label: 'AIFF', ext: 'aiff', mime: 'audio/aiff', group: 'Lossless (studio quality)', description: 'Apple’s uncompressed format (Logic, GarageBand).', bitDepths: [8, 16, 24], tags: true },
  au: { label: 'AU', ext: 'au', mime: 'audio/basic', group: 'Other', description: 'Sun/Unix audio, incl. 8-bit µ-law.', bitDepths: [16, 24, 32], encodings: ['pcm', 'ulaw'], tags: false },
  raw: { label: 'RAW PCM', ext: 'raw', mime: 'application/octet-stream', group: 'Other', description: 'Headerless samples (16-bit little-endian or 32-bit float) for developers and hardware.', bitDepths: [16, 32], tags: false },
};
export const FORMAT_ORDER: ExportFormat[] = ['mp3', 'm4a', 'ogg', 'webm', 'wav', 'flac', 'aiff', 'au', 'raw'];

export interface ExportOptions {
  format: ExportFormat;
  bitDepth: WavBitDepth;
  bitrate: number;
  /** Target sample rate in Hz (MIN_RATE..MAX_RATE), or 'keep' for the original rate. */
  sampleRate: number | 'keep';
  /** Explicit mono/stereo, or 'keep' for the original layout. */
  channels: ExportChannels | 'keep';
  encoding?: Encoding;
  tags?: Tags;
}

export const MIN_RATE = 10_000;
export const MAX_RATE = 225_000;
export const MP3_MAX_RATE = 48_000;
export const MP3_RATES = FORMATS.mp3.rates!;
export const RATE_PRESETS = [11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 176400, 192000, 225000];

export const clampRate = (hz: number) => Math.round(Math.min(MAX_RATE, Math.max(MIN_RATE, hz)));
export const isValidRate = (hz: number) => Number.isFinite(hz) && hz >= MIN_RATE && hz <= MAX_RATE;

/** The rate that will actually be written (some formats only allow fixed rates). */
export function effectiveRate(srcRate: number, o: Pick<ExportOptions, 'format' | 'sampleRate'>): number {
  const wanted = o.sampleRate === 'keep' ? srcRate : clampRate(o.sampleRate);
  const rates = FORMATS[o.format].rates;
  if (!rates) return wanted;
  const capped = Math.min(wanted, rates[rates.length - 1]);
  return rates.reduce((best, r) => (Math.abs(r - capped) < Math.abs(best - capped) ? r : best), rates[0]);
}

export const effectiveChannels = (src: AudioData, o: Pick<ExportOptions, 'channels'>) =>
  o.channels === 'keep' ? Math.min(2, src.channels.length) : o.channels === 'mono' ? 1 : 2;

/** Bit depth / encoding actually used for the chosen format. */
export function effectiveDepth(o: ExportOptions): { bits: number; encoding: Encoding } {
  const f = FORMATS[o.format];
  const encoding = o.encoding && f.encodings?.includes(o.encoding) ? o.encoding : 'pcm';
  if (encoding !== 'pcm') return { bits: 8, encoding };
  const depths = f.bitDepths ?? [16];
  return { bits: depths.includes(o.bitDepth) ? o.bitDepth : depths.includes(16) ? 16 : depths[0], encoding };
}

export function effectiveBitrate(o: ExportOptions): number {
  const list = FORMATS[o.format].bitrates;
  if (!list) return o.bitrate;
  return list.reduce((best, b) => (Math.abs(b - o.bitrate) < Math.abs(best - o.bitrate) ? b : best), list[0]);
}

/** Formats this device can produce (platform codecs are feature-detected). */
export async function availableFormats(): Promise<ExportFormat[]> {
  const out: ExportFormat[] = [];
  for (const f of FORMAT_ORDER) {
    const p = FORMATS[f].platform;
    if (!p || (await canEncode(p, p === 'opus' ? 48000 : 44100, 2))) out.push(f);
  }
  return out;
}

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
  const ZERO_CROSSINGS = 12;
  const cutoff = 0.95 / ratio;
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
          const w = 0.42 + 0.5 * Math.cos((Math.PI * d) / half) + 0.08 * Math.cos((2 * Math.PI * d) / half);
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

function encodeRaw(a: AudioData, bits: number): Uint8Array {
  const n = length(a), ch = a.channels.length, bps = bits / 8;
  const out = new Uint8Array(n * ch * bps);
  const v = new DataView(out.buffer);
  const ints = bits === 16 ? a.channels.map((c) => quantize(c, 16)) : null;
  let o = 0;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    if (ints) v.setInt16(o, ints[c][i], true);
    else v.setFloat32(o, a.channels[c][i], true);
    o += bps;
  }
  return out;
}

export async function renderExport(src: AudioData, o: ExportOptions, onProgress?: (p: number) => void): Promise<{ blob: Blob; ext: string; audio: AudioData }> {
  const a = prepareExport(src, o);
  const f = FORMATS[o.format];
  const { bits, encoding } = effectiveDepth(o);
  const kbps = effectiveBitrate(o);
  const tags = o.tags ?? {};
  let bytes: Uint8Array;
  switch (o.format) {
    case 'mp3': {
      const mp3 = encodeMp3(a, kbps, onProgress);
      bytes = hasTags(tags) ? concatBytes([id3v2(tags), mp3]) : mp3;
      break;
    }
    case 'wav': bytes = new Uint8Array(encodeWav(a, bits as WavBitDepth, true, { encoding, tags })); break;
    case 'flac': bytes = encodeFlac(a, bits as 16 | 24, tags); break;
    case 'aiff': bytes = encodeAiff(a, bits as 8 | 16 | 24, tags); break;
    case 'au': bytes = encodeAu(a, encoding === 'ulaw' ? 'ulaw' : (bits as 16 | 24 | 32), tags); break;
    case 'raw': bytes = encodeRaw(a, bits); break;
    case 'ogg': bytes = await encodeOggOpus(a, kbps * 1000, tags, onProgress); break;
    case 'webm': bytes = await encodeWebmOpus(a, kbps * 1000, onProgress); break;
    case 'm4a': bytes = await encodeM4a(a, kbps * 1000, onProgress); break;
  }
  return { blob: new Blob([bytes as BlobPart], { type: f.mime }), ext: f.ext, audio: a };
}

export function estimateSize(a: AudioData, o: ExportOptions): number {
  const sec = length(a) / a.sampleRate;
  const ch = effectiveChannels(a, o);
  const rate = effectiveRate(a.sampleRate, o);
  if (FORMATS[o.format].bitrates) return (sec * effectiveBitrate(o) * 1000) / 8;
  const { bits } = effectiveDepth(o);
  const pcm = sec * rate * ch * (bits / 8);
  return o.format === 'flac' ? pcm * 0.55 : 44 + pcm;
}
