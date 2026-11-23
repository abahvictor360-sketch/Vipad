import { AudioData, length } from './buffer';

export type WavBitDepth = 8 | 16 | 24 | 32;

/** Encode PCM WAV (8/16/24-bit integer or 32-bit float), with TPDF dither for integer formats. */
export function encodeWav(a: AudioData, bitDepth: WavBitDepth = 16, dither = true): ArrayBuffer {
  const numCh = a.channels.length;
  const n = length(a);
  const bps = bitDepth / 8;
  const isFloat = bitDepth === 32;
  const dataSize = n * numCh * bps;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, isFloat ? 3 : 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, a.sampleRate, true);
  v.setUint32(28, a.sampleRate * numCh * bps, true);
  v.setUint16(32, numCh * bps, true);
  v.setUint16(34, bitDepth, true);
  str(36, 'data');
  v.setUint32(40, dataSize, true);
  let o = 44;
  const maxInt = Math.pow(2, bitDepth - 1) - 1;
  const ditherAmp = dither && !isFloat ? 1 / maxInt : 0;
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s = a.channels[ch][i];
      if (isFloat) {
        v.setFloat32(o, s, true);
      } else {
        if (ditherAmp) s += (Math.random() - Math.random()) * ditherAmp;
        s = Math.max(-1, Math.min(1, s));
        const q = Math.round(s < 0 ? s * (maxInt + 1) : s * maxInt);
        if (bitDepth === 8) v.setUint8(o, q + 128);
        else if (bitDepth === 16) v.setInt16(o, q, true);
        else {
          v.setUint8(o, q & 0xff);
          v.setUint8(o + 1, (q >> 8) & 0xff);
          v.setUint8(o + 2, (q >> 16) & 0xff);
        }
      }
      o += bps;
    }
  }
  return buf;
}

/** Minimal RIFF/WAVE decoder (PCM 8/16/24/32 int and 32/64 float, incl. WAVE_FORMAT_EXTENSIBLE). */
export function decodeWav(buf: ArrayBuffer): AudioData {
  const v = new DataView(buf);
  const tag = (o: number) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let o = 12;
  let fmt = 1, numCh = 1, sr = 44100, bits = 16;
  let dataOff = -1, dataLen = 0;
  while (o + 8 <= v.byteLength) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      fmt = v.getUint16(o + 8, true);
      numCh = v.getUint16(o + 10, true);
      sr = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
      if (fmt === 0xfffe && size >= 40) fmt = v.getUint16(o + 32, true);
    } else if (id === 'data') {
      dataOff = o + 8;
      dataLen = Math.min(size, v.byteLength - dataOff);
      break;
    }
    o += 8 + size + (size & 1);
  }
  if (dataOff < 0) throw new Error('WAV has no data chunk');
  const bps = bits / 8;
  const n = Math.floor(dataLen / (bps * numCh));
  const channels = Array.from({ length: numCh }, () => new Float32Array(n));
  let p = dataOff;
  for (let i = 0; i < n; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      let s: number;
      if (fmt === 3) s = bits === 64 ? v.getFloat64(p, true) : v.getFloat32(p, true);
      else if (bits === 8) s = (v.getUint8(p) - 128) / 128;
      else if (bits === 16) s = v.getInt16(p, true) / 32768;
      else if (bits === 24) {
        let x = v.getUint8(p) | (v.getUint8(p + 1) << 8) | (v.getUint8(p + 2) << 16);
        if (x & 0x800000) x |= ~0xffffff;
        s = x / 8388608;
      } else s = v.getInt32(p, true) / 2147483648;
      channels[ch][i] = s;
      p += bps;
    }
  }
  return { sampleRate: sr, channels };
}
