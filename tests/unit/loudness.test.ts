import { describe, expect, it } from 'vitest';
import { measureLoudness, truePeak } from '../../src/audio/loudness';
import { tone } from '../../src/audio/generators';

describe('BS.1770 loudness', () => {
  // EBU Tech 3341: a stereo 1 kHz sine whose peak is X dBFS on each channel reads X LUFS.
  it('1 kHz stereo sine at -20 dBFS peak measures about -20 LUFS (EBU reference behaviour)', () => {
    const l = measureLoudness(tone(48000, 2, 10, 1000, -20));
    expect(l.integrated).toBeGreaterThan(-20.5);
    expect(l.integrated).toBeLessThan(-19.5);
    expect(l.range).toBeLessThan(0.5);
  });
  it('is 6 dB lower when the level drops 6 dB, and gates silence', () => {
    const a = measureLoudness(tone(48000, 2, 5, 1000, -10)).integrated;
    const b = measureLoudness(tone(48000, 2, 5, 1000, -16)).integrated;
    expect(a - b).toBeCloseTo(6, 1);
    const withSilence = tone(48000, 2, 10, 1000, -10);
    for (const c of withSilence.channels) c.fill(0, 0, 48000 * 5);
    expect(measureLoudness(withSilence).integrated).toBeCloseTo(a, 0);
  });
  it('true peak is at least the sample peak', () => {
    expect(truePeak(tone(48000, 1, 0.5, 997, -3))).toBeGreaterThan(-3.05);
  });
});
