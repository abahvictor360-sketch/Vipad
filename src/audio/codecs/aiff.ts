/** AIFF writer/reader (big-endian PCM, 80-bit extended sample rate). Reads AIFF and AIFF-C (NONE / sowt / fl32). */
import { AudioData, length } from '../buffer';
import { quantize, utf8 } from './bits';
import { Tags, aiffText, concatBytes } from './tags';

function writeExtended(v: DataView, o: number, value: number) {
  let exp = 16383 + Math.floor(Math.log2(value));
  let mant = value / 2 ** (exp - 16383);
  v.setUint16(o, exp);
  const hi = Math.floor(mant * 2 ** 31);
  const lo = Math.floor((mant * 2 ** 31 - hi) * 2 ** 32);
  v.setUint32(o + 2, hi >>> 0);
  v.setUint32(o + 6, lo >>> 0);
  exp = 0; mant = 0;
}
function readExtended(v: DataView, o: number): number {
  const exp = (v.getUint16(o) & 0x7fff) - 16383;
  const hi = v.getUint32(o + 2), lo = v.getUint32(o + 6);
  return (hi * 2 ** -31 + lo * 2 ** -63) * 2 ** exp;
}

export function encodeAiff(a: AudioData, bitDepth: 8 | 16 | 24 = 16, tags: Tags = {}): Uint8Array {
  const n = length(a), ch = a.channels.length, bps = bitDepth / 8;
  const ints = a.channels.map((c) => quantize(c, bitDepth, bitDepth < 24));
  const comm = new DataView(new ArrayBuffer(26));
  comm.setUint32(0, 0x434f4d4d); comm.setUint32(4, 18);
  comm.setUint16(8, ch); comm.setUint32(10, n); comm.setUint16(14, bitDepth);
  writeExtended(comm, 16, a.sampleRate);
  const dataLen = n * ch * bps;
  const ssnd = new Uint8Array(16 + dataLen + (dataLen & 1));
  const sv = new DataView(ssnd.buffer);
  sv.setUint32(0, 0x53534e44); sv.setUint32(4, 8 + dataLen);
  let o = 16;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const s = ints[c][i];
    if (bitDepth === 8) sv.setInt8(o, s);
    else if (bitDepth === 16) sv.setInt16(o, s);
    else { sv.setInt8(o, s >> 16); sv.setUint8(o + 1, (s >> 8) & 255); sv.setUint8(o + 2, s & 255); }
    o += bps;
  }
  const text = aiffText(tags);
  const body = concatBytes([utf8('AIFF'), new Uint8Array(comm.buffer), text, ssnd]);
  const head = new DataView(new ArrayBuffer(8));
  head.setUint32(0, 0x464f524d); head.setUint32(4, body.length);
  return concatBytes([new Uint8Array(head.buffer), body]);
}

export function isAiff(b: ArrayBuffer) {
  if (b.byteLength < 12) return false;
  const t = new TextDecoder().decode(new Uint8Array(b, 0, 12));
  return t.startsWith('FORM') && (t.endsWith('AIFF') || t.endsWith('AIFC'));
}

export function decodeAiff(buf: ArrayBuffer): AudioData {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (!isAiff(buf)) throw new Error('Not an AIFF file');
  const aifc = tag(8) === 'AIFC';
  let ch = 1, frames = 0, bits = 16, rate = 44100, comp = 'NONE', dataOff = -1;
  let o = 12;
  while (o + 8 <= v.byteLength) {
    const id = tag(o), size = v.getUint32(o + 4);
    if (id === 'COMM') {
      ch = v.getUint16(o + 8); frames = v.getUint32(o + 10); bits = v.getUint16(o + 14); rate = readExtended(v, o + 16);
      if (aifc) comp = tag(o + 26);
    } else if (id === 'SSND') dataOff = o + 16 + v.getUint32(o + 8);
    o += 8 + size + (size & 1);
  }
  if (dataOff < 0) throw new Error('AIFF has no sound data');
  const little = comp === 'sowt';
  const float = comp === 'fl32' || comp === 'FL32';
  const bps = float ? 4 : Math.ceil(bits / 8);
  frames = Math.min(frames, Math.floor((v.byteLength - dataOff) / (bps * ch)));
  const channels = Array.from({ length: ch }, () => new Float32Array(frames));
  let p = dataOff;
  for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) {
    let s: number;
    if (float) s = v.getFloat32(p, little);
    else if (bps === 1) s = v.getInt8(p) / 128;
    else if (bps === 2) s = v.getInt16(p, little) / 32768;
    else if (bps === 3) {
      let x = little ? v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16) : (v.getUint8(p) << 16) | (v.getUint8(p + 1) << 8) | v.getUint8(p + 2);
      if (x & 0x800000) x |= ~0xffffff;
      s = x / 8388608;
    } else s = v.getInt32(p, little) / 2147483648;
    channels[c][i] = s;
    p += bps;
  }
  return { sampleRate: Math.round(rate), channels };
}
