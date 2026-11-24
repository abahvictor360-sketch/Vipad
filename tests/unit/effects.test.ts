import { describe, expect, it } from 'vitest';
import { EFFECTS, EFFECTS_BY_ID, defaultParams } from '../../src/audio/effects';
import { stats, findSoundBounds, spectrum } from '../../src/audio/analysis';
import { tone, noise } from '../../src/audio/generators';
import { biquadCoeffs, biquadMagnitude, timeStretch, pitchShift, applyBiquad } from '../../src/audio/dsp';
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
        const out = e.apply(src, defaultParams(e), { profile: noise(SR, src.channels.length, 0.3, 'white', -40) });
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

describe('noise-sample workflow', () => {
  it('requires a profile and removes noise learned from it', () => {
    const e = EFFECTS_BY_ID.denoiseSample;
    const hiss = noise(SR, 1, 2, 'white', -30, 7);
    expect(() => e.apply(hiss, defaultParams(e))).toThrow(/noise sample/i);
    const profile: AudioData = { sampleRate: SR, channels: [hiss.channels[0].slice(0, SR / 2)] };
    const out = e.apply(hiss, defaultParams(e), { profile });
    expect(stats(hiss).rmsDb - stats(out, { start: 4000, end: 28000 }).rmsDb).toBeGreaterThan(12);
  });
  it('multi-band gate silences quiet broadband noise but passes a loud tone', () => {
    const quiet = run('mbgate', noise(SR, 1, 1, 'white', -70));
    expect(stats(quiet, { start: 4000, end: 16000 }).peakDb).toBeLessThan(-90);
    const loud = run('mbgate', tone(SR, 1, 1, 1000, -6));
    expect(stats(loud, { start: 4000, end: 16000 }).peakDb).toBeGreaterThan(-8);
  });
  it('manual click repair interpolates smoothly between the edges', () => {
    const a: AudioData = { sampleRate: SR, channels: [Float32Array.from([0, 1, -1, 0.9, 0.5])] };
    const out = run('interpolate', a).channels[0];
    expect(out[0]).toBe(0);
    expect(out[4]).toBeCloseTo(0.5);
    for (let i = 1; i < 5; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
  });
});

describe('pro effects', () => {
  it('loudness normalize hits the LUFS target and respects the true-peak ceiling', async () => {
    const { measureLoudness } = await import('../../src/audio/loudness');
    const out = run('loudnorm', tone(48000, 2, 6, 1000, -30), { target: '-16', ceiling: -1 });
    const l = measureLoudness(out);
    expect(l.integrated).toBeGreaterThan(-16.5);
    expect(l.integrated).toBeLessThan(-15.5);
    const loud = run('loudnorm', tone(48000, 2, 4, 1000, -20), { target: '-14', ceiling: -1 });
    expect(stats(loud).peakDb).toBeLessThan(-0.9);
  });
  it('remove silence shortens long pauses only', () => {
    const a = tone(SR, 1, 4, 440, -6);
    a.channels[0].fill(0, SR, SR * 3); // 2 s pause
    const out = run('removeSilence', a, { minPause: 700, keep: 200 });
    expect(length(out) / SR).toBeCloseTo(2.2, 1);
    const short = tone(SR, 1, 2, 440, -6);
    short.channels[0].fill(0, SR / 2, SR / 2 + SR * 0.3); // 300 ms pause is kept
    expect(length(run('removeSilence', short))).toBe(length(short));
  });
  it('de-clipper restores flattened peaks above the clip level', () => {
    const a = tone(SR, 1, 0.5, 100, 0);
    const clipped = { sampleRate: SR, channels: [a.channels[0].map((v) => Math.max(-0.6, Math.min(0.6, v)))] };
    const out = run('declip', clipped, { threshold: 99 });
    let pk = 0;
    for (const v of out.channels[0]) pk = Math.max(pk, Math.abs(v));
    expect(pk).toBeGreaterThan(0.7);
  });
  it('de-esser reduces strong high-frequency content but keeps lows', () => {
    const hiss = noise(SR, 1, 1, 'white', -6);
    const low = tone(SR, 1, 1, 200, -6);
    const mixd = { sampleRate: SR, channels: [hiss.channels[0].map((v, i) => v + low.channels[0][i])] };
    const out = run('deess', mixd, { freq: 5000, threshold: -40, reduction: 18 });
    const band = (x: AudioData, t: 'lowpass' | 'highpass', f: number) => ({ sampleRate: SR, channels: [applyBiquad(applyBiquad(x.channels[0], biquadCoeffs(t, SR, f)), biquadCoeffs(t, SR, f))] });
    // the sibilant band drops a lot…
    expect(stats(band(mixd, 'highpass', 6000)).rmsDb - stats(band(out, 'highpass', 6000)).rmsDb).toBeGreaterThan(10);
    // …while the voice body below 1 kHz is unchanged
    expect(Math.abs(stats(band(mixd, 'lowpass', 1000)).rmsDb - stats(band(out, 'lowpass', 1000)).rmsDb)).toBeLessThan(0.5);
  });
});
