// VBAN audio over UDP: the protocol used by VB-Audio Voicemeeter, VBAN Receptor/Talkie and Matrix.
// Spec: https://vb-audio.com/Voicemeeter/VBANProtocol_Specifications.pdf
// Packet: 28-byte header + interleaved little-endian PCM (≤ 256 frames, ≤ 1436 bytes payload).
const dgram = require('node:dgram');

const SR_LIST = [6000, 12000, 24000, 48000, 96000, 192000, 384000, 8000, 16000, 32000, 64000, 128000, 256000, 512000, 11025, 22050, 44100, 88200, 176400, 352800, 705600];
const FMT_INT16 = 0x01;
const MAX_PAYLOAD = 1436;
const DEFAULT_PORT = 6980;

/** Encode one VBAN audio packet from interleaved Int16 samples. */
function encode({ streamName, sampleRate, channels, frame, samples }) {
  const srIndex = SR_LIST.indexOf(sampleRate);
  if (srIndex < 0) throw new Error(`VBAN does not support ${sampleRate} Hz`);
  const frames = samples.length / channels;
  if (!Number.isInteger(frames) || frames < 1 || frames > 256) throw new Error('VBAN packets carry 1–256 frames');
  if (frames * channels * 2 > MAX_PAYLOAD) throw new Error('VBAN payload too large');
  const buf = Buffer.alloc(28 + samples.length * 2);
  buf.write('VBAN', 0, 'ascii');
  buf[4] = srIndex & 0x1f; // sub-protocol 0 = audio
  buf[5] = frames - 1;
  buf[6] = channels - 1;
  buf[7] = FMT_INT16; // codec 0 = PCM
  buf.write(String(streamName).slice(0, 16), 8, 16, 'ascii');
  buf.writeUInt32LE(frame >>> 0, 24);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(samples[i], 28 + i * 2);
  return buf;
}

/** Decode a VBAN audio packet, or return null for anything else (text/serial/other codecs). */
function decode(buf) {
  if (buf.length < 28 || buf.toString('ascii', 0, 4) !== 'VBAN') return null;
  if ((buf[4] & 0xe0) !== 0) return null; // not audio
  const sampleRate = SR_LIST[buf[4] & 0x1f];
  const frames = buf[5] + 1;
  const channels = buf[6] + 1;
  if (!sampleRate || (buf[7] & 0x07) !== FMT_INT16 || (buf[7] & 0xf0) !== 0) return null;
  const streamName = buf.toString('ascii', 8, 24).replace(/\0.*$/, '');
  const frame = buf.readUInt32LE(24);
  const n = frames * channels;
  if (buf.length < 28 + n * 2) return null;
  const samples = new Int16Array(n);
  for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(28 + i * 2);
  return { streamName, sampleRate, channels, frames, frame, samples };
}

/** Sender: one UDP socket, sends to a host:port. */
function createSender({ host, port = DEFAULT_PORT, streamName = 'Vipad' }) {
  const sock = dgram.createSocket('udp4');
  let frame = 0;
  let closed = false;
  if (host === '255.255.255.255' || /\.255$/.test(host)) sock.bind(() => sock.setBroadcast(true));
  return {
    send(sampleRate, channels, samples) {
      if (closed) return;
      // split into ≤256-frame packets
      const per = Math.min(256, Math.floor(MAX_PAYLOAD / 2 / channels));
      for (let off = 0; off < samples.length; off += per * channels) {
        const chunk = samples.subarray(off, Math.min(samples.length, off + per * channels));
        sock.send(encode({ streamName, sampleRate, channels, frame: frame++, samples: chunk }), port, host);
      }
    },
    close() { closed = true; try { sock.close(); } catch { /* already closed */ } },
  };
}

/** Receiver: listens on a port, calls onAudio for packets matching the stream name (or any if empty). */
function createReceiver({ port = DEFAULT_PORT, streamName = '', onAudio, onError }) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  sock.on('message', (msg, rinfo) => {
    const p = decode(msg);
    if (!p) return;
    if (streamName && p.streamName.toLowerCase() !== streamName.toLowerCase()) return;
    onAudio({ ...p, from: rinfo.address });
  });
  sock.on('error', (e) => onError?.(e));
  sock.bind(port);
  return { close() { try { sock.close(); } catch { /* already closed */ } } };
}

module.exports = { encode, decode, createSender, createReceiver, SR_LIST, DEFAULT_PORT };
