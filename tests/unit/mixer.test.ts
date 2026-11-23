import { describe, expect, it } from 'vitest';
import { mixdown, sessionLength, splitClip, panGains, conform, Session, Clip } from '../../src/audio/mixer';
import { length } from '../../src/audio/buffer';

const clip = (id: string, start: number, vals: number[]): Clip => ({ id, name: id, start, gainDb: 0, audio: { sampleRate: 1000, channels: [Float32Array.from(vals), Float32Array.from(vals)] } });
const sess = (tracks: Session['tracks']): Session => ({ sampleRate: 1000, tracks });
const track = (id: string, clips: Clip[], extra: Partial<Session['tracks'][0]> = {}) => ({ id, name: id, clips, volumeDb: 0, pan: 0, mute: false, solo: false, ...extra });

describe('mixer', () => {
  it('sums clips at their offsets', () => {
    const s = sess([track('a', [clip('c1', 0, [1, 1])]), track('b', [clip('c2', 1, [0.5, 0.5])])]);
    expect(sessionLength(s)).toBe(3);
    expect(Array.from(mixdown(s).channels[0])).toEqual([1, 1.5, 0.5]);
  });
  it('honours mute and solo', () => {
    const a = track('a', [clip('c1', 0, [1])]);
    const b = track('b', [clip('c2', 0, [0.25])]);
    expect(mixdown(sess([{ ...a, mute: true }, b])).channels[0][0]).toBe(0.25);
    expect(mixdown(sess([a, { ...b, solo: true }])).channels[0][0]).toBe(0.25);
  });
  it('applies track volume and pan', () => {
    const s = sess([track('a', [clip('c1', 0, [1])], { volumeDb: -6.0206, pan: -1 })]);
    const m = mixdown(s);
    expect(m.channels[0][0]).toBeCloseTo(0.5, 3);
    expect(m.channels[1][0]).toBeCloseTo(0, 6);
    expect(panGains(0)).toEqual([1, 1]);
  });
  it('renders a sub-range', () => {
    const s = sess([track('a', [clip('c1', 0, [1, 2, 3, 4])])]);
    expect(Array.from(mixdown(s, { start: 1, end: 3 }).channels[0])).toEqual([2, 3]);
  });
  it('splits clips at the timeline position', () => {
    const [l, r] = splitClip(clip('c', 10, [1, 2, 3, 4]), 12, () => 'n')!;
    expect(Array.from(l.audio.channels[0])).toEqual([1, 2]);
    expect(r.start).toBe(12);
    expect(Array.from(r.audio.channels[0])).toEqual([3, 4]);
    expect(splitClip(clip('c', 10, [1, 2]), 5, () => 'n')).toBeNull();
  });
  it('conforms mono audio to stereo at the session rate', () => {
    const c = conform({ sampleRate: 2000, channels: [new Float32Array(200)] }, 1000);
    expect(c.channels.length).toBe(2);
    expect(length(c)).toBe(100);
  });
});

import { serializeProject, parseProject } from '../../src/app/project';
describe('project files', () => {
  it('round-trips docs and the multitrack session losslessly', () => {
    const s = sess([track('a', [clip('c1', 5, [0.25, -0.5])], { pan: 0.3, mute: true })]);
    let n = 0;
    const out = parseProject(serializeProject([{ name: 'Doc', audio: { sampleRate: 1000, channels: [Float32Array.from([0.1])] } }], s), () => `id${n++}`);
    expect(out.docs[0].name).toBe('Doc');
    expect(out.docs[0].audio.channels[0][0]).toBeCloseTo(0.1, 6);
    expect(out.session.tracks[0].pan).toBe(0.3);
    expect(out.session.tracks[0].mute).toBe(true);
    expect(out.session.tracks[0].clips[0].start).toBe(5);
    expect(Array.from(out.session.tracks[0].clips[0].audio.channels[1])).toEqual([0.25, -0.5]);
  });
  it('rejects other JSON', () => {
    expect(() => parseProject('{"a":1}', () => 'x')).toThrow(/Vipad project/);
  });
});
