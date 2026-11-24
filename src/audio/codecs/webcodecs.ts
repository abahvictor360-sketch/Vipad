/**
 * Formats encoded by the platform's own codecs (WebCodecs): Opus in Ogg or WebM, AAC in M4A.
 * Availability depends on the browser/OS, so every format is feature-detected before it is offered.
 */
import { AudioData as Audio, length } from '../buffer';
import { crc32ogg, utf8 } from './bits';
import { Tags, vorbisComment, concatBytes } from './tags';

type Codec = 'opus' | 'aac';
const CODEC_STRING: Record<Codec, string> = { opus: 'opus', aac: 'mp4a.40.2' };
const cache = new Map<string, Promise<boolean>>();

export function canEncode(codec: Codec, sampleRate = 48000, channels = 2): Promise<boolean> {
  const key = `${codec}:${sampleRate}:${channels}`;
  if (!cache.has(key)) {
    const p = (async () => {
      try {
        const AE = (globalThis as unknown as { AudioEncoder?: { isConfigSupported(c: unknown): Promise<{ supported?: boolean }> } }).AudioEncoder;
        if (!AE) return false;
        return !!(await AE.isConfigSupported({ codec: CODEC_STRING[codec], sampleRate, numberOfChannels: channels, bitrate: 128000 })).supported;
      } catch {
        return false;
      }
    })();
    cache.set(key, p);
  }
  return cache.get(key)!;
}

interface Encoded { chunks: EncodedAudioChunk[]; metas: (EncodedAudioChunkMetadata | undefined)[]; description?: Uint8Array }

async function encodeWith(a: Audio, codec: Codec, bitrate: number, onProgress?: (p: number) => void): Promise<Encoded> {
  const ch = Math.min(2, a.channels.length);
  const sr = a.sampleRate;
  const chunks: EncodedAudioChunk[] = [];
  const metas: (EncodedAudioChunkMetadata | undefined)[] = [];
  let description: Uint8Array | undefined;
  let failure: unknown = null;
  const enc = new AudioEncoder({
    output: (chunk, meta) => {
      chunks.push(chunk);
      metas.push(meta);
      const d = meta?.decoderConfig?.description;
      if (d && !description) description = new Uint8Array(d instanceof ArrayBuffer ? d : (d as ArrayBufferView).buffer.slice((d as ArrayBufferView).byteOffset, (d as ArrayBufferView).byteOffset + (d as ArrayBufferView).byteLength));
    },
    error: (e) => (failure = e),
  });
  enc.configure({ codec: CODEC_STRING[codec], sampleRate: sr, numberOfChannels: ch, bitrate });
  const n = length(a);
  const STEP = sr; // one second per AudioData
  for (let off = 0; off < n; off += STEP) {
    const len = Math.min(STEP, n - off);
    const planar = new Float32Array(len * ch);
    for (let c = 0; c < ch; c++) planar.set(a.channels[c].subarray(off, off + len), c * len);
    const frame = new AudioData({ format: 'f32-planar', sampleRate: sr, numberOfFrames: len, numberOfChannels: ch, timestamp: Math.round((off / sr) * 1e6), data: planar });
    enc.encode(frame);
    frame.close();
    if (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
    onProgress?.(off / n);
    if (failure) break;
  }
  await enc.flush();
  enc.close();
  if (failure) throw failure instanceof Error ? failure : new Error(String(failure));
  return { chunks, metas, description };
}

// ---------------------------------------------------------------- Ogg Opus
function oggPage(packets: Uint8Array[], granule: bigint, serial: number, seq: number, flags: number): Uint8Array {
  const lacing: number[] = [];
  for (const p of packets) {
    let len = p.length;
    while (len >= 255) { lacing.push(255); len -= 255; }
    lacing.push(len);
  }
  const header = new Uint8Array(27 + lacing.length);
  const v = new DataView(header.buffer);
  header.set(utf8('OggS'), 0);
  header[4] = 0;
  header[5] = flags;
  v.setBigInt64(6, granule, true);
  v.setUint32(14, serial, true);
  v.setUint32(18, seq, true);
  header[26] = lacing.length;
  header.set(lacing, 27);
  const page = concatBytes([header, ...packets]);
  new DataView(page.buffer).setUint32(22, crc32ogg(page), true);
  return page;
}

export async function encodeOggOpus(a: Audio, bitrate = 128000, tags: Tags = {}, onProgress?: (p: number) => void): Promise<Uint8Array> {
  if (a.sampleRate !== 48000) throw new Error('Opus encoding expects 48 kHz audio');
  const ch = Math.min(2, a.channels.length);
  const { chunks, description } = await encodeWith(a, 'opus', bitrate, onProgress);
  // pre-skip from the encoder's own OpusHead if it provided one, else libopus' default lookahead
  let preSkip = 312;
  if (description && description.length >= 12 && new TextDecoder().decode(description.subarray(0, 8)) === 'OpusHead') {
    preSkip = new DataView(description.buffer, description.byteOffset).getUint16(10, true);
  }
  const serial = (Math.random() * 0xffffffff) >>> 0;
  const head = new Uint8Array(19);
  const hv = new DataView(head.buffer);
  head.set(utf8('OpusHead'));
  head[8] = 1;
  head[9] = ch;
  hv.setUint16(10, preSkip, true);
  hv.setUint32(12, 48000, true);
  hv.setInt16(16, 0, true);
  head[18] = 0;
  const pages: Uint8Array[] = [oggPage([head], 0n, serial, 0, 0x02), oggPage([concatBytes([utf8('OpusTags'), vorbisComment(tags)])], 0n, serial, 1, 0)];
  let seq = 2;
  let granule = BigInt(preSkip);
  const total = BigInt(preSkip + length(a));
  let batch: Uint8Array[] = [];
  let segs = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const data = new Uint8Array(c.byteLength);
    c.copyTo(data);
    const samples = Math.round(((c.duration ?? 20000) / 1e6) * 48000);
    const need = Math.floor(data.length / 255) + 1;
    if (segs + need > 255 || batch.length >= 50) {
      pages.push(oggPage(batch, granule, serial, seq++, 0));
      batch = [];
      segs = 0;
    }
    batch.push(data);
    segs += need;
    granule += BigInt(samples);
  }
  // final page: granule trimmed to the real length so players drop the encoder padding
  pages.push(oggPage(batch, granule < total ? granule : total, serial, seq, 0x04));
  return concatBytes(pages);
}

// ---------------------------------------------------------------- WebM Opus / M4A AAC
export async function encodeWebmOpus(a: Audio, bitrate = 128000, onProgress?: (p: number) => void): Promise<Uint8Array> {
  const { Muxer, ArrayBufferTarget } = await import('webm-muxer');
  const ch = Math.min(2, a.channels.length);
  const { chunks, metas } = await encodeWith(a, 'opus', bitrate, onProgress);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), audio: { codec: 'A_OPUS', numberOfChannels: ch, sampleRate: a.sampleRate } });
  chunks.forEach((c, i) => muxer.addAudioChunk(c, metas[i]));
  muxer.finalize();
  return new Uint8Array(muxer.target.buffer);
}

export async function encodeM4a(a: Audio, bitrate = 192000, onProgress?: (p: number) => void): Promise<Uint8Array> {
  const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
  const ch = Math.min(2, a.channels.length);
  const { chunks, metas } = await encodeWith(a, 'aac', bitrate, onProgress);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), audio: { codec: 'aac', numberOfChannels: ch, sampleRate: a.sampleRate }, fastStart: 'in-memory' });
  chunks.forEach((c, i) => muxer.addAudioChunk(c, metas[i]));
  muxer.finalize();
  return new Uint8Array(muxer.target.buffer);
}
