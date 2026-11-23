import { describe, expect, it } from 'vitest';
import { prepareExport, resampleHQ, effectiveRate, estimateSize, clampRate, isValidRate, ExportOptions, MIN_RATE, MAX_RATE } from '../../src/audio/exporter';
import { encodeWav, decodeWav } from '../../src/audio/wav';
import { tone } from '../../src/audio/generators';
import { spectrum, stats } from '../../src/audio/analysis';
import { length, AudioData } from '../../src/audio/buffer';

const opts = (o: Partial<ExportOptions>): ExportOptions => ({ format: 'wav', bitDepth: 16, bitrate: 192, sampleRate: 'keep', channels: 'keep', ...o });

function peakFreq(a: AudioData) {
  const size = 8192;
  const start = Math.floor(length(a) / 4);
  const sp = spectrum(a.channels[0].subarray(start, start + size), size);
  let best = 1;
  for (let i = 1; i < sp.length; i++) if (sp[i] > sp[best]) best = i;
  return (best * a.sampleRate) / size;
}

describe('export: channels', () => {
  it('saves stereo as mono (mixed) and mono as stereo (duplicated)', () => {
    const st: AudioData = { sampleRate: 48000, channels: [new Float32Array(100).fill(0.5), new Float32Array(100).fill(-0.1)] };
    const m = prepareExport(st, opts({ channels: 'mono' }));
    expect(m.channels.length).toBe(1);
    expect(m.channels[0][10]).toBeCloseTo(0.2, 6);
    const s = prepareExport({ sampleRate: 48000, channels: [new Float32Array(100).fill(0.3)] }, opts({ channels: 'stereo' }));
    expect(s.channels.length).toBe(2);
    expect(Array.from(s.channels[1])).toEqual(Array.from(s.channels[0]));
  });
});

describe('export: sample rate 10–225 kHz', () => {
  it('validates the allowed range', () => {
    expect(isValidRate(MIN_RATE)).toBe(true);
    expect(isValidRate(MAX_RATE)).toBe(true);
    expect(isValidRate(9_999)).toBe(false);
    expect(isValidRate(225_001)).toBe(false);
    expect(clampRate(5)).toBe(10_000);
    expect(clampRate(1e9)).toBe(225_000);
  });

  for (const rate of [10_000, 22_050, 44_100, 96_000, 192_000, 225_000, 123_457]) {
    it(`writes a valid WAV at ${rate} Hz with the right length and pitch`, () => {
      const src = tone(48000, 2, 1, 1000, -6);
      const out = prepareExport(src, opts({ sampleRate: rate }));
      expect(out.sampleRate).toBe(rate);
      expect(length(out)).toBe(Math.round(48000 / (48000 / rate)));
      const back = decodeWav(encodeWav(out, 24, false));
      expect(back.sampleRate).toBe(rate);
      expect(back.channels.length).toBe(2);
      expect(Math.abs(peakFreq(back) - 1000)).toBeLessThan(rate / 8192 + 2);
      expect(stats(back).peakDb).toBeGreaterThan(-6.5);
      expect(stats(back).peakDb).toBeLessThan(-5.5);
    });
  }

  it('removes content above the new Nyquist instead of aliasing it', () => {
    // 8 kHz tone cannot exist at 10 kHz (Nyquist 5 kHz): it must be filtered out, not folded to 2 kHz
    const out = resampleHQ(tone(48000, 1, 1, 8000, -6), 10_000);
    expect(stats(out, { start: 2000, end: 8000 }).peakDb).toBeLessThan(-40);
  });

  it('caps MP3 at 48 kHz and picks a legal MP3 rate', () => {
    expect(effectiveRate(48000, { format: 'mp3', sampleRate: 192_000 })).toBe(48000);
    expect(effectiveRate(48000, { format: 'mp3', sampleRate: 10_000 })).toBe(11025);
    expect(effectiveRate(48000, { format: 'wav', sampleRate: 192_000 })).toBe(192_000);
  });

  it('estimates WAV size from rate and channels', () => {
    const a = tone(48000, 2, 1, 440);
    expect(estimateSize(a, opts({ sampleRate: 225_000, channels: 'mono', bitDepth: 16 }))).toBe(44 + 225_000 * 2);
  });
});
