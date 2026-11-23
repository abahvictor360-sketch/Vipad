import { describe, expect, it } from 'vitest';
import { encodeWav, decodeWav } from '../../src/audio/wav';
import { encodeMp3 } from '../../src/audio/mp3';
import { tone, noise, dtmf } from '../../src/audio/generators';
import { History } from '../../src/audio/history';
import { fft } from '../../src/audio/analysis';
import { length } from '../../src/audio/buffer';

describe('wav', () => {
  for (const bits of [8, 16, 24, 32] as const) {
    it(`round-trips ${bits}-bit`, () => {
      const a = tone(22050, 2, 0.1, 440, -3);
      const b = decodeWav(encodeWav(a, bits, false));
      expect(b.sampleRate).toBe(22050);
      expect(b.channels.length).toBe(2);
      expect(length(b)).toBe(length(a));
      const tol = bits === 8 ? 0.01 : bits === 16 ? 1e-4 : 1e-6;
      for (let i = 0; i < length(a); i += 37) expect(Math.abs(b.channels[1][i] - a.channels[1][i])).toBeLessThan(tol);
    });
  }
  it('writes a valid header', () => {
    const buf = encodeWav(tone(8000, 1, 0.01, 100), 16);
    const v = new DataView(buf);
    expect(String.fromCharCode(...new Uint8Array(buf, 0, 4))).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
  });
  it('rejects non-wav data', () => {
    expect(() => decodeWav(new ArrayBuffer(64))).toThrow();
  });
});

describe('mp3', () => {
  it('encodes frames with sync words', () => {
    const out = encodeMp3(tone(44100, 2, 0.5, 440), 128);
    expect(out.length).toBeGreaterThan(5000);
    const syncIdx = out.findIndex((b, i) => b === 0xff && (out[i + 1] & 0xe0) === 0xe0);
    expect(syncIdx).toBeGreaterThanOrEqual(0);
  });
  it('resamples non-standard rates', () => {
    expect(encodeMp3(tone(37000, 1, 0.2, 440), 96).length).toBeGreaterThan(500);
  });
});

describe('generators', () => {
  it('generates tones, noise and DTMF of requested length', () => {
    expect(length(tone(8000, 1, 1.5, 440))).toBe(12000);
    expect(noise(8000, 2, 1, 'pink').channels.length).toBe(2);
    expect(length(dtmf(8000, 1, '12#', 100, 50))).toBe(3 * 1200);
  });
  it('noise is deterministic for a seed', () => {
    expect(noise(8000, 1, 0.1, 'white', -6, 5).channels[0][10]).toBe(noise(8000, 1, 0.1, 'white', -6, 5).channels[0][10]);
  });
});

describe('history', () => {
  const snap = (v: number) => ({ audio: { sampleRate: 1, channels: [Float32Array.from([v])] }, label: `s${v}` });
  it('undoes and redoes', () => {
    const h = new History();
    h.push(snap(0));
    h.push(snap(1));
    const u = h.undo(snap(2))!;
    expect(u.label).toBe('s1');
    expect(h.canRedo).toBe(true);
    expect(h.redo(u)!.label).toBe('s2');
  });
  it('clears redo on new push and respects step limit', () => {
    const h = new History(1e9, 3);
    for (let i = 0; i < 5; i++) h.push(snap(i));
    expect(h.size).toBe(3);
    h.undo(snap(9));
    h.push(snap(10));
    expect(h.canRedo).toBe(false);
  });
});

describe('fft', () => {
  it('inverse restores the signal', () => {
    const re = Float64Array.from({ length: 64 }, (_, i) => Math.sin(i));
    const orig = re.slice();
    const im = new Float64Array(64);
    fft(re, im);
    fft(re, im, true);
    for (let i = 0; i < 64; i++) expect(re[i]).toBeCloseTo(orig[i], 9);
  });
});
