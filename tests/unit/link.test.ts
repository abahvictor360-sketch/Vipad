import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { makeRoomCode, normalizeCode, formatCode, joinUrl, tuneOpus, findVirtualOutput } from '../../src/link/protocol';

const require = createRequire(import.meta.url);
const vban = require('../../electron/vban.cjs');

const SDP = ['v=0', 'm=audio 9 UDP/TLS/RTP/SAVPF 111 63', 'a=rtpmap:111 opus/48000/2', 'a=fmtp:111 minptime=10;useinbandfec=1', 'a=rtpmap:63 red/48000/2', ''].join('\r\n');

describe('Vipad Link protocol', () => {
  it('makes readable 6-character codes without look-alike characters', () => {
    for (let i = 0; i < 200; i++) {
      const c = makeRoomCode();
      expect(c).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
      expect(normalizeCode(c)).toBe(c);
    }
  });
  it('accepts codes typed with dashes, spaces and lower case', () => {
    expect(normalizeCode(' abc-234 ')).toBe('ABC234');
    expect(normalizeCode('ABC23')).toBeNull();
    expect(normalizeCode('ABC10O')).toBeNull(); // 0, 1 and O are not in the alphabet
    expect(formatCode('ABC234')).toBe('ABC-234');
    expect(joinUrl('ABC234', 'https://x.test/app.html')).toBe('https://x.test/app.html?link=ABC234');
  });
  it('tunes Opus for stereo music at low latency', () => {
    const out = tuneOpus(SDP, 'music', true);
    const fmtp = out.match(/a=fmtp:111 (.*)/)![1];
    expect(fmtp).toContain('stereo=1');
    expect(fmtp).toContain('sprop-stereo=1');
    expect(fmtp).toContain('maxaveragebitrate=128000');
    expect(fmtp).toContain('useinbandfec=1');
    expect(fmtp).toContain('usedtx=0');
    expect(fmtp.match(/minptime/g)).toHaveLength(1);
    expect(out).toContain('a=ptime:10');
    expect(out).toContain('a=rtpmap:63 red/48000/2'); // other codecs untouched
  });
  it('tunes Opus for mono voice and adds an fmtp line when missing', () => {
    const out = tuneOpus(SDP.replace(/a=fmtp:111[^\r]*\r\n/, ''), 'voice', false);
    expect(out).toMatch(/a=rtpmap:111 opus\/48000\/2\r\na=fmtp:111 .*stereo=0.*maxaveragebitrate=64000/);
    expect(out).not.toContain('a=ptime:10');
  });
  it('leaves SDP without Opus alone', () => {
    expect(tuneOpus('v=0\r\n', 'hifi', true)).toBe('v=0\r\n');
  });
  it('finds the virtual microphone for each OS', () => {
    const outs = (labels: string[]) => labels.map((label, i) => ({ deviceId: `d${i}`, label }));
    expect(findVirtualOutput(outs(['Speakers (Realtek)', 'CABLE Input (VB-Audio Virtual Cable)']))?.product).toBe('VB-CABLE');
    expect(findVirtualOutput(outs(['MacBook Pro Speakers', 'BlackHole 2ch']))?.micName).toBe('BlackHole');
    expect(findVirtualOutput(outs(['Built-in Audio', 'Vipad Link']))?.micName).toBe('Vipad Link Microphone');
    expect(findVirtualOutput(outs(['Voicemeeter Input (VB-Audio Voicemeeter VAIO)']))?.product).toBe('Voicemeeter');
    expect(findVirtualOutput(outs(['Speakers']))).toBeNull();
  });
});

describe('VBAN', () => {
  it('encodes the header exactly as the VBAN spec', () => {
    const samples = new Int16Array([1, -1, 32767, -32768]);
    const b: Buffer = vban.encode({ streamName: 'Stream1', sampleRate: 48000, channels: 2, frame: 7, samples });
    expect(b.toString('ascii', 0, 4)).toBe('VBAN');
    expect(b[4]).toBe(3); // 48 kHz index, audio sub-protocol
    expect(b[5]).toBe(1); // 2 frames - 1
    expect(b[6]).toBe(1); // 2 channels - 1
    expect(b[7]).toBe(1); // INT16 PCM
    expect(b.toString('ascii', 8, 15)).toBe('Stream1');
    expect(b.readUInt32LE(24)).toBe(7);
    expect(b.length).toBe(28 + 8);
    expect(b.readInt16LE(32)).toBe(32767);
  });
  it('round-trips and rejects non-audio packets', () => {
    const samples = Int16Array.from({ length: 512 }, (_, i) => (i * 97) % 30000 - 15000);
    const p = vban.decode(vban.encode({ streamName: 'Vipad', sampleRate: 44100, channels: 2, frame: 123456, samples }));
    expect(p).toMatchObject({ streamName: 'Vipad', sampleRate: 44100, channels: 2, frames: 256, frame: 123456 });
    expect(Array.from(p.samples)).toEqual(Array.from(samples));
    const text = Buffer.alloc(40); text.write('VBAN'); text[4] = 0x40; // text sub-protocol
    expect(vban.decode(text)).toBeNull();
    expect(vban.decode(Buffer.from('nope'))).toBeNull();
    expect(() => vban.encode({ streamName: 'x', sampleRate: 47000, channels: 1, frame: 0, samples: new Int16Array(4) })).toThrow();
  });
  it('sends and receives over UDP, splitting into ≤256-frame packets', async () => {
    const port = 26000 + Math.floor(Math.random() * 2000);
    const got: { frames: number; frame: number; samples: Int16Array }[] = [];
    const rx = vban.createReceiver({ port, streamName: 'test', onAudio: (p: { frames: number; frame: number; samples: Int16Array }) => got.push(p) });
    await new Promise((r) => setTimeout(r, 100));
    const tx = vban.createSender({ host: '127.0.0.1', port, streamName: 'TEST' });
    const samples = Int16Array.from({ length: 600 * 2 }, (_, i) => i);
    tx.send(48000, 2, samples);
    for (let i = 0; i < 40 && got.length < 3; i++) await new Promise((r) => setTimeout(r, 25));
    tx.close();
    rx.close();
    expect(got.map((g) => g.frames)).toEqual([256, 256, 88]);
    expect(got.map((g) => g.frame)).toEqual([0, 1, 2]);
    expect(Array.from(got[2].samples).slice(-1)[0]).toBe(1199);
  });
});
