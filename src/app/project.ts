/** Vipad project files (.vipad): every open file plus the multitrack session, lossless (32-bit float WAV inside JSON). */
import { encodeWav, decodeWav } from '../audio/wav';
import { AudioData } from '../audio/buffer';
import { Session } from '../audio/mixer';

const toB64 = (buf: ArrayBuffer) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (b64: string) => {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
};
const pack = (a: AudioData) => toB64(encodeWav(a, 32, false));
const unpack = (s: string) => decodeWav(fromB64(s));

export interface ProjectFile {
  format: 'vipad-project';
  version: 1;
  docs: { name: string; wav: string }[];
  session: {
    sampleRate: number;
    tracks: { name: string; volumeDb: number; pan: number; mute: boolean; solo: boolean; clips: { name: string; start: number; gainDb: number; wav: string }[] }[];
  };
}

export function serializeProject(docs: { name: string; audio: AudioData }[], session: Session): string {
  const p: ProjectFile = {
    format: 'vipad-project',
    version: 1,
    docs: docs.map((d) => ({ name: d.name, wav: pack(d.audio) })),
    session: {
      sampleRate: session.sampleRate,
      tracks: session.tracks.map((t) => ({
        name: t.name, volumeDb: t.volumeDb, pan: t.pan, mute: t.mute, solo: t.solo,
        clips: t.clips.map((c) => ({ name: c.name, start: c.start, gainDb: c.gainDb, wav: pack(c.audio) })),
      })),
    },
  };
  return JSON.stringify(p);
}

export function parseProject(text: string, newId: () => string): { docs: { name: string; audio: AudioData }[]; session: Session } {
  const p = JSON.parse(text) as ProjectFile;
  if (p?.format !== 'vipad-project') throw new Error('Not a Vipad project file');
  return {
    docs: p.docs.map((d) => ({ name: d.name, audio: unpack(d.wav) })),
    session: {
      sampleRate: p.session.sampleRate,
      tracks: p.session.tracks.map((t) => ({
        id: newId(), name: t.name, volumeDb: t.volumeDb, pan: t.pan, mute: t.mute, solo: t.solo,
        clips: t.clips.map((c) => ({ id: newId(), name: c.name, start: c.start, gainDb: c.gainDb, audio: unpack(c.wav) })),
      })),
    },
  };
}
