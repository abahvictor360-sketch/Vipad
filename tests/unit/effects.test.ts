import { describe, expect, it } from 'vitest';
import { EFFECTS, EFFECTS_BY_ID, defaultParams } from '../../src/audio/effects';
import { stats, findSoundBounds, spectrum } from '../../src/audio/analysis';
import { tone, noise } from '../../src/audio/generators';
import { biquadCoeffs, biquadMagnitude, timeStretch, pitchShift } from '../../src/audio/dsp';
import { length, AudioData } from '../../src/audio/buffer';

const SR = 16000;
const run = (id: string, a: AudioData, p: Record<string, number | string> = {}) => EFFECTS_BY_ID[id].apply(a, { ...defaultParams(EFFECTS_BY_ID[id]), ...p });

/** Dominant frequency via FFT peak. */
function dominantFreq(a: AudioData) {
  const size = 8192;
  const sp = spectrum(a.channels[0].subarray(2000, 2000 + size), size);
  let best = 0;
  for (let i = 1; i < sp.length; i++) if (sp[i] > sp[best]) best = i;
  return (best * a.sampleRate) / size;
}

describe('effects registry', () => {
  it('every effect runs on mono and stereo without NaN', () => {
    const mono = tone(SR, 1, 0.5, 440, -6);
    const stereo = tone(SR, 2, 0.5, 440, -6);
    for (const e of EFFECTS) {
      for (const src of [mono, stereo]) {
        const out = e.apply(src, defaultParams(e));
        expect(out.channels.length, e.id).toBe(src.channels.length);
        for (const c of out.channels) for (let i = 0; i < c.length; i += 97) expect(Number.isFinite(c[i]), `${e.id} @${i}`).toBe(true);
      }
    }
  });

  it('has unique ids', () => {
    expect(new Set(EFFECTS.map((e) => e.id)).size).toBe(EFFECTS.length);
  });
});

describe('volume effects', () => {
  it('amplify +6 dB doubles amplitude', () => {
    const a = tone(SR, 1, 0.2, 440, -20);
    expect(stats(run('amplify', a, { gain: 6.0206 })).peak).toBeCloseTo(stats(a).peak * 2, 3);
  });
  it('normalize hits target peak', () => {
    expect(stats(run('normalize', tone(SR, 2, 0.2, 300, -30), { target: -1 })).peakDb).toBeCloseTo(-1, 2);
  });
  it('fade in starts silent, fade out ends silent', () => {
    const a = tone(SR, 1, 0.2, 100, 0, 'square');
    const fi = run('fadeIn', a).channels[0];
    const fo = run('fadeOut', a).channels[0];
    expect(fi[0]).toBe(0);
    expect(Math.abs(fi[fi.length - 1])).toBeCloseTo(1, 3);
    expect(fo[fo.length - 1]).toBeCloseTo(0, 6);
  });
});

describe('time & pitch', () => {
  it('reverse reverses', () => {
    const a: AudioData = { sampleRate: SR, channels: [Float32Array.from([1, 2, 3])] };
    expect(Array.from(run('reverse', a).channels[0])).toEqual([3, 2, 1]);
  });
  it('speed 200% halves length and doubles pitch', () => {
    const a = tone(SR, 1, 2, 500);
    const out = run('speed', a, { speed: 200 });
    expect(length(out)).toBe(length(a) / 2);
    expect(dominantFreq(out)).toBeGreaterThan(950);
    expect(dominantFreq(out)).toBeLessThan(1050);
  });
  it('tempo change alters length but keeps pitch', () => {
    const a = tone(SR, 1, 2, 500);
    const out = timeStretch(a, 1.5);
    expect(length(out)).toBe(Math.ceil(length(a) * 1.5));
    expect(Math.abs(dominantFreq(out) - 500)).toBeLessThan(15);
  });
  it('pitch shift +12 st doubles frequency, keeps length', () => {
    const a = tone(SR, 1, 2, 400);
    const out = pitchShift(a, 12);
    expect(length(out)).toBe(length(a));
    expect(Math.abs(dominantFreq(out) - 800)).toBeLessThan(25);
  });
  it('echo / reverb produce a tail', () => {
    const a = tone(SR, 1, 0.2, 440);
    expect(length(run('echo', a))).toBeGreaterThan(length(a));
    expect(length(run('reverb', a, { tail: 1 }))).toBe(length(a) + SR);
  });
});

describe('filters', () => {
  it('lowpass attenuates above cutoff', () => {
    const c = biquadCoeffs('lowpass', 48000, 1000);
    expect(biquadMagnitude(c, 100, 48000)).toBeCloseTo(1, 1);
    expect(biquadMagnitude(c, 10000, 48000)).toBeLessThan(0.02);
  });
  it('peaking EQ applies the requested gain at centre', () => {
    const c = biquadCoeffs('peaking', 48000, 1000, 1, 6);
    expect(20 * Math.log10(biquadMagnitude(c, 1000, 48000))).toBeCloseTo(6, 1);
  });
  it('highpass removes a low tone', () => {
    const out = run('highpass', tone(SR, 1, 1, 50), { freq: 1000 });
    expect(stats(out, { start: 4000, end: 16000 }).peakDb).toBeLessThan(-40);
  });
  it('hum notch removes 50 Hz', () => {
    const out = run('notch', tone(SR, 1, 2, 50, -6), { freq: '50' });
    expect(stats(out, { start: 16000, end: 32000 }).peakDb).toBeLessThan(-30);
  });
});

describe('dynamics & restoration', () => {
  it('limiter enforces the ceiling', () => {
    expect(stats(run('limiter', tone(SR, 1, 0.5, 200, 0), { ceiling: -6 })).peakDb).toBeLessThanOrEqual(-5.99);
  });
  it('compressor reduces dynamic range', () => {
    const loud = tone(SR, 1, 1, 200, 0);
    const out = run('compressor', loud, { threshold: -20, ratio: 10, makeup: 0 });
    expect(stats(out, { start: 8000, end: 16000 }).peakDb).toBeLessThan(-12);
  });
  it('noise gate silences quiet noise', () => {
    const out = run('gate', noise(SR, 1, 1, 'white', -60), { threshold: -40 });
    expect(stats(out, { start: 4000, end: 16000 }).peakDb).toBeLessThan(-100);
  });
  it('noise reduction lowers hiss while keeping signal', () => {
    const sig = tone(SR, 1, 2, 440, -10);
    const hiss = noise(SR, 1, 2, 'white', -35);
    // silence first 0.5s of signal so the profile can learn noise
    for (let i = 0; i < SR / 2; i++) sig.channels[0][i] = 0;
    const mixed: AudioData = { sampleRate: SR, channels: [sig.channels[0].map((v, i) => v + hiss.channels[0][i])] };
    const out = run('denoise', mixed, { reduction: 24 });
    const noiseBefore = stats(mixed, { start: 2000, end: 6000 }).rmsDb;
    const noiseAfter = stats(out, { start: 2000, end: 6000 }).rmsDb;
    expect(noiseBefore - noiseAfter).toBeGreaterThan(10);
    expect(stats(out, { start: 16000, end: 30000 }).rmsDb).toBeGreaterThan(stats(sig, { start: 16000, end: 30000 }).rmsDb - 2);
  });
  it('dc offset removal centres audio', () => {
    const a: AudioData = { sampleRate: SR, channels: [new Float32Array(1000).fill(0.3)] };
    expect(Math.abs(stats(run('dc', a)).dcOffset)).toBeLessThan(1e-6);
  });
  it('auto trim removes surrounding silence', () => {
    const a: AudioData = { sampleRate: 1000, channels: [new Float32Array(1000)] };
    a.channels[0].fill(0.5, 400, 600);
    expect(findSoundBounds(a)).toEqual({ start: 400, end: 600 });
    expect(length(run('trimSilence', a, { pad: 0 }))).toBe(200);
  });
});

describe('channel effects', () => {
  const st = (): AudioData => ({ sampleRate: SR, channels: [Float32Array.from([1, 1]), Float32Array.from([0.5, 0.5])] });
  it('swaps channels', () => {
    expect(Array.from(run('swap', st()).channels[0])).toEqual([0.5, 0.5]);
  });
  it('vocal remover cancels centred content', () => {
    const t = tone(SR, 2, 0.5, 1000);
    expect(stats(run('vocalRemove', t, { keepBass: 0 })).peak).toBeLessThan(1e-6);
  });
  it('invert flips sign', () => {
    expect(Array.from(run('invert', st()).channels[1])).toEqual([-0.5, -0.5]);
  });
});
