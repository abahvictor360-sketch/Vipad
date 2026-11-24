/** Sun/NeXT AU (.au/.snd) writer and reader. */
import { AudioData, length } from '../buffer';
import { quantize, utf8 } from './bits';
import { linearToUlaw, ulawToLinear, alawToLinear } from './g711';
import { Tags, concatBytes } from './tags';

export type AuEncoding = 'ulaw' | 16 | 24 | 32;

export function encodeAu(a: AudioData, enc: AuEncoding = 16, tags: Tags = {}): Uint8Array {
  const n = length(a), ch = a.channels.length;
  const code = enc === 'ulaw' ? 1 : enc === 16 ? 3 : enc === 24 ? 4 : 6;
  const bps = enc === 'ulaw' ? 1 : enc / 8;
  let note = utf8([tags.title, tags.artist].filter(Boolean).join(' — ') || 'Vipad');
  note = concatBytes([note, new Uint8Array(8 - (note.length % 8))]); // NUL-terminated, 8-byte aligned
  const hdr = 24 + note.length;
  const out = new Uint8Array(hdr + n * ch * bps);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x2e736e64); v.setUint32(4, hdr); v.setUint32(8, n * ch * bps);
  v.setUint32(12, code); v.setUint32(16, a.sampleRate); v.setUint32(20, ch);
  out.set(note, 24);
  const ints = typeof enc === 'number' && enc < 32 ? a.channels.map((c) => quantize(c, enc, enc === 16)) : null;
  let o = hdr;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    if (enc === 'ulaw') v.setUint8(o, linearToUlaw(a.channels[c][i]));
    else if (enc === 32) v.setFloat32(o, a.channels[c][i]);
    else if (enc === 16) v.setInt16(o, ints![c][i]);
    else { const s = ints![c][i]; v.setInt8(o, s >> 16); v.setUint8(o + 1, (s >> 8) & 255); v.setUint8(o + 2, s & 255); }
    o += bps;
  }
  return out;
}

export const isAu = (b: ArrayBuffer) => b.byteLength >= 24 && new DataView(b).getUint32(0) === 0x2e736e64;

export function decodeAu(buf: ArrayBuffer): AudioData {
  const v = new DataView(buf);
  if (!isAu(buf)) throw new Error('Not an AU file');
  const off = v.getUint32(4), code = v.getUint32(12), rate = v.getUint32(16), ch = v.getUint32(20);
  let size = v.getUint32(8);
  if (size === 0xffffffff || off + size > buf.byteLength) size = buf.byteLength - off;
  const bps = { 1: 1, 2: 1, 3: 2, 4: 3, 5: 4, 6: 4, 27: 1 }[code as 1];
  if (!bps) throw new Error(`Unsupported AU encoding ${code}`);
  const frames = Math.floor(size / (bps * ch));
  const channels = Array.from({ length: ch }, () => new Float32Array(frames));
  let p = off;
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) {
    let s: number;
    switch (code) {
      case 1: s = ulawToLinear(v.getUint8(p)); break;
      case 27: s = alawToLinear(v.getUint8(p)); break;
      case 2: s = v.getInt8(p) / 128; break;
      case 3: s = v.getInt16(p) / 32768; break;
      case 4: { let x = (v.getUint8(p) << 16) | (v.getUint8(p + 1) << 8) | v.getUint8(p + 2); if (x & 0x800000) x |= ~0xffffff; s = x / 8388608; break; }
      case 5: s = v.getInt32(p) / 2147483648; break;
      default: s = v.getFloat32(p);
    }
    channels[c][i] = s;
    p += bps;
  }
  return { sampleRate: rate, channels };
}
