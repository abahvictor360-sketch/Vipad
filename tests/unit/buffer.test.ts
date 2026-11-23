import { describe, expect, it } from 'vitest';
import * as B from '../../src/audio/buffer';

const ramp = (n: number, ch = 1): B.AudioData => ({
  sampleRate: 1000,
  channels: Array.from({ length: ch }, () => Float32Array.from({ length: n }, (_, i) => i)),
});

describe('buffer ops', () => {
  it('slices, removes and inserts without mutating input', () => {
    const a = ramp(10);
    expect(Array.from(B.slice(a, { start: 2, end: 5 }).channels[0])).toEqual([2, 3, 4]);
    const r = B.remove(a, { start: 2, end: 5 });
    expect(Array.from(r.channels[0])).toEqual([0, 1, 5, 6, 7, 8, 9]);
    const ins = B.insert(r, 2, B.slice(a, { start: 2, end: 5 }));
    expect(Array.from(ins.channels[0])).toEqual(Array.from(a.channels[0]));
    expect(a.channels[0].length).toBe(10);
  });

  it('clamps and normalises reversed ranges', () => {
    expect(B.clampRange(ramp(10), { start: 12, end: -3 })).toEqual({ start: 0, end: 10 });
  });

  it('replace swaps a range with different-length audio', () => {
    const out = B.replace(ramp(6), { start: 1, end: 4 }, { sampleRate: 1000, channels: [Float32Array.from([9])] });
    expect(Array.from(out.channels[0])).toEqual([0, 9, 4, 5]);
  });

  it('crops, silences and inserts silence', () => {
    expect(B.length(B.crop(ramp(10), { start: 3, end: 7 }))).toBe(4);
    const s = B.silenceRange(ramp(5), { start: 1, end: 3 });
    expect(Array.from(s.channels[0])).toEqual([0, 0, 0, 3, 4]);
    expect(B.length(B.insertSilence(ramp(5), 2, 0.01))).toBe(15);
  });

  it('matches channel counts when pasting mono into stereo', () => {
    const out = B.insert(ramp(4, 2), 4, ramp(2, 1));
    expect(out.channels.length).toBe(2);
    expect(Array.from(out.channels[1])).toEqual([0, 1, 2, 3, 0, 1]);
  });

  it('resamples pasted audio to the destination rate', () => {
    const src: B.AudioData = { sampleRate: 2000, channels: [new Float32Array(200)] };
    expect(B.length(B.insert(ramp(10), 0, src))).toBe(110);
  });

  it('mixes overdubs and extends length', () => {
    const out = B.mixInto(ramp(4), 3, { sampleRate: 1000, channels: [Float32Array.from([1, 1])] });
    expect(Array.from(out.channels[0])).toEqual([0, 1, 2, 4, 1]);
  });

  it('converts between mono and stereo', () => {
    const st: B.AudioData = { sampleRate: 1000, channels: [Float32Array.from([1, 1]), Float32Array.from([0, -1])] };
    expect(Array.from(B.toMono(st).channels[0])).toEqual([0.5, 0]);
    expect(B.toStereo(B.toMono(st)).channels.length).toBe(2);
  });
});
