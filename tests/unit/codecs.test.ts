import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeFlac } from '../../src/audio/codecs/flac';
import { encodeAiff, decodeAiff } from '../../src/audio/codecs/aiff';
import { encodeAu, decodeAu } from '../../src/audio/codecs/au';
import { linearToUlaw, ulawToLinear, linearToAlaw, alawToLinear } from '../../src/audio/codecs/g711';
import { id3v2, vorbisComment } from '../../src/audio/codecs/tags';
import { encodeWav, decodeWav } from '../../src/audio/wav';
import { encodeMp3 } from '../../src/audio/mp3';
import { tone, noise } from '../../src/audio/generators';
import { AudioData, length } from '../../src/audio/buffer';

let hasFfmpeg = false;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); hasFfmpeg = true; } catch { /* optional */ }
const ff = hasFfmpeg ? it : it.skip;
const dir = mkdtempSync(join(tmpdir(), 'vipad-codec-'));

/** Decode any file with ffmpeg to interleaved 32-bit floats. */
function ffDecode(bytes: Uint8Array, ext: string, extra: string[] = []) {
  const src = join(dir, `in-${Math.random().toString(36).slice(2)}.${ext}`);
  writeFileSync(src, bytes);
  const out = execFileSync('ffmpeg', ['-v', 'error', ...extra, '-i', src, '-f', 'f32le', '-'], { maxBuffer: 1 << 28 });
  return new Float32Array(out.buffer, out.byteOffset, out.length / 4);
}
function ffProbe(bytes: Uint8Array, ext: string) {
  const src = join(dir, `p-${Math.random().toString(36).slice(2)}.${ext}`);
  writeFileSync(src, bytes);
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', src]).toString());
}

/** Audio whose samples are exact 24-bit integers, so lossless round-trips must be bit-exact. */
function exact24(sr: number, ch: number, sec: number): AudioData {
  const t = tone(sr, ch, sec, 997, -3);
  const nz = noise(sr, ch, sec, 'pink', -20, 3);
  return { sampleRate: sr, channels: t.channels.map((c, k) => c.map((v, i) => Math.round((v + nz.channels[k][i] * (k ? -1 : 1)) * 8388607) / 8388608)) };
}

describe('FLAC encoder', () => {
  ff('is bit-exact (24-bit stereo) and readable by ffmpeg', () => {
    const a = exact24(48000, 2, 2.3);
    const flac = encodeFlac(a, 24, { title: 'Test', artist: 'Vipad' });
    const pcm = ffDecode(flac, 'flac');
    expect(pcm.length).toBe(length(a) * 2);
    let maxErr = 0;
    for (let i = 0; i < length(a); i++) for (let c = 0; c < 2; c++) maxErr = Math.max(maxErr, Math.abs(pcm[i * 2 + c] - a.channels[c][i]));
    expect(maxErr).toBe(0);
    const p = ffProbe(flac, 'flac');
    expect(p.streams[0].sample_rate).toBe('48000');
    expect(p.format.tags.TITLE ?? p.format.tags.title).toBe('Test');
    // it actually compresses
    expect(flac.length).toBeLessThan(length(a) * 2 * 3 * 0.85);
  });

  ff('handles mono, silence, odd lengths and high sample rates', () => {
    for (const [sr, ch, sec] of [[44100, 1, 0.37], [96000, 2, 0.2], [225000, 1, 0.1]] as const) {
      const a = exact24(sr, ch, sec);
      a.channels[0].fill(0, 0, Math.floor(length(a) / 3)); // silent stretch → CONSTANT subframes
      const pcm = ffDecode(encodeFlac(a, 24), 'flac');
      expect(pcm.length, `${sr}/${ch}`).toBe(length(a) * ch);
      for (let i = 0; i < length(a); i += 97) expect(pcm[i * ch]).toBe(a.channels[0][i]);
    }
  });

  ff('16-bit FLAC is within one LSB (dithered)', () => {
    const a = tone(44100, 2, 1, 440, -6);
    const pcm = ffDecode(encodeFlac(a, 16), 'flac');
    for (let i = 0; i < length(a); i += 13) expect(Math.abs(pcm[i * 2] - a.channels[0][i])).toBeLessThan(3 / 32768);
  });
});

describe('AIFF / AU / G.711 / WAV variants', () => {
  it('AIFF round-trips through our reader (8/16/24-bit)', () => {
    for (const bits of [8, 16, 24] as const) {
      const a = tone(44100, 2, 0.2, 440, -6);
      const b = decodeAiff(encodeAiff(a, bits, { title: 'x' }).buffer as ArrayBuffer);
      expect(b.sampleRate).toBe(44100);
      expect(length(b)).toBe(length(a));
      for (let i = 0; i < length(a); i += 31) expect(Math.abs(b.channels[1][i] - a.channels[1][i])).toBeLessThan(bits === 8 ? 0.02 : 1e-3);
    }
  });
  ff('AIFF and AU are readable by ffmpeg', () => {
    const a = tone(22050, 1, 0.3, 440, -6);
    for (const [bytes, ext] of [[encodeAiff(a, 16), 'aiff'], [encodeAu(a, 16), 'au'], [encodeAu(a, 'ulaw'), 'au'], [encodeAu(a, 24), 'au']] as const) {
      const pcm = ffDecode(bytes, ext);
      expect(pcm.length).toBe(length(a));
      expect(Math.abs(pcm[1000] - a.channels[0][1000])).toBeLessThan(0.02);
    }
  });
  it('AU round-trips through our reader', () => {
    const a = tone(16000, 2, 0.1, 300, -6);
    for (const enc of [16, 24, 32, 'ulaw'] as const) {
      const b = decodeAu(encodeAu(a, enc).buffer as ArrayBuffer);
      expect(b.channels.length).toBe(2);
      expect(Math.abs(b.channels[0][500] - a.channels[0][500])).toBeLessThan(enc === 'ulaw' ? 0.02 : 1e-3);
    }
  });
  it('µ-law and A-law companding stays within telephony accuracy', () => {
    for (let x = -1; x <= 1; x += 0.01) {
      expect(Math.abs(ulawToLinear(linearToUlaw(x)) - x)).toBeLessThan(Math.max(0.002, Math.abs(x) * 0.07));
      expect(Math.abs(alawToLinear(linearToAlaw(x)) - x)).toBeLessThan(Math.max(0.002, Math.abs(x) * 0.07));
    }
  });
  ff('WAV µ-law / A-law and tagged WAV are valid for ffmpeg and our reader', () => {
    const a = tone(8000, 1, 0.5, 400, -6);
    for (const encoding of ['ulaw', 'alaw'] as const) {
      const w = new Uint8Array(encodeWav(a, 16, false, { encoding }));
      const p = ffProbe(w, 'wav');
      expect(p.streams[0].codec_name).toBe(encoding === 'ulaw' ? 'pcm_mulaw' : 'pcm_alaw');
      const ours = decodeWav(w.buffer);
      expect(Math.abs(ours.channels[0][100] - a.channels[0][100])).toBeLessThan(0.02);
    }
    const tagged = new Uint8Array(encodeWav(a, 24, false, { tags: { title: 'Hello', artist: 'Me' } }));
    const p = ffProbe(tagged, 'wav');
    expect(p.format.tags.title).toBe('Hello');
    expect(p.format.tags.artist).toBe('Me');
    expect(length(decodeWav(tagged.buffer))).toBe(length(a));
  });
  ff('MP3 with ID3 tags is read by ffmpeg with the right title/artist', () => {
    const mp3 = new Uint8Array([...id3v2({ title: 'Song – ünïcode', artist: 'Vipad', album: 'Album', year: '2026' }), ...encodeMp3(tone(44100, 2, 0.5, 440), 128)]);
    const p = ffProbe(mp3, 'mp3');
    expect(p.format.tags.title).toBe('Song – ünïcode');
    expect(p.format.tags.artist).toBe('Vipad');
    expect(p.format.tags.album).toBe('Album');
  });
  it('builds a Vorbis comment block', () => {
    const v = vorbisComment({ title: 'T' });
    expect(new TextDecoder().decode(v)).toContain('TITLE=T');
  });
});
