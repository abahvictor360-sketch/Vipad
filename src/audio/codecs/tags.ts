/** Metadata tag writers: ID3v2.3 (MP3), Vorbis comments (FLAC / Ogg Opus), RIFF INFO (WAV), AIFF text chunks. */
import { utf8 } from './bits';

export interface Tags {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  genre?: string;
  comment?: string;
}

const clean = (t: Tags) => Object.fromEntries(Object.entries(t).filter(([, v]) => v && String(v).trim())) as Tags;
export const hasTags = (t: Tags = {}) => Object.keys(clean(t)).length > 0;

const le32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);
const be32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const VENDOR = 'Vipad audio editor';

/** Vorbis comment block body (little-endian lengths), shared by FLAC and OpusTags. */
export function vorbisComment(t: Tags, vendor = VENDOR): Uint8Array {
  const c = clean(t);
  const map: [keyof Tags, string][] = [['title', 'TITLE'], ['artist', 'ARTIST'], ['album', 'ALBUM'], ['year', 'DATE'], ['genre', 'GENRE'], ['comment', 'COMMENT']];
  const entries = map.filter(([k]) => c[k]).map(([k, name]) => utf8(`${name}=${c[k]}`));
  entries.push(utf8('ENCODER=Vipad'));
  const v = utf8(vendor);
  return concatBytes([le32(v.length), v, le32(entries.length), ...entries.flatMap((e) => [le32(e.length), e])]);
}

/** ID3v2.3 tag (UTF-16 text frames) to prepend to an MP3. */
export function id3v2(t: Tags): Uint8Array {
  const c = clean(t);
  if (!Object.keys(c).length) return new Uint8Array(0);
  const utf16 = (s: string) => {
    const b = new Uint8Array(2 + s.length * 2);
    b[0] = 0xff; b[1] = 0xfe;
    for (let i = 0; i < s.length; i++) { const code = s.charCodeAt(i); b[2 + i * 2] = code & 255; b[3 + i * 2] = code >> 8; }
    return b;
  };
  const frame = (id: string, body: Uint8Array) => concatBytes([utf8(id), be32(body.length), new Uint8Array(2), body]);
  const text = (id: string, v?: string) => (v ? [frame(id, concatBytes([new Uint8Array([1]), utf16(v)]))] : []);
  const frames = [
    ...text('TIT2', c.title), ...text('TPE1', c.artist), ...text('TALB', c.album), ...text('TYER', c.year), ...text('TCON', c.genre),
    ...(c.comment ? [frame('COMM', concatBytes([new Uint8Array([1]), utf8('eng'), new Uint8Array([0xff, 0xfe, 0, 0]), utf16(c.comment).subarray(0)]))] : []),
    ...text('TSSE', 'Vipad'),
  ];
  const body = concatBytes(frames);
  const size = body.length;
  const syncsafe = new Uint8Array([(size >> 21) & 127, (size >> 14) & 127, (size >> 7) & 127, size & 127]);
  return concatBytes([utf8('ID3'), new Uint8Array([3, 0, 0]), syncsafe, body]);
}

/** RIFF "LIST/INFO" chunk for WAV files. */
export function riffInfo(t: Tags): Uint8Array {
  const c = clean(t);
  const map: [keyof Tags, string][] = [['title', 'INAM'], ['artist', 'IART'], ['album', 'IPRD'], ['year', 'ICRD'], ['genre', 'IGNR'], ['comment', 'ICMT']];
  const subs = map.filter(([k]) => c[k]).map(([k, id]) => {
    const v = concatBytes([utf8(c[k]!), new Uint8Array([0])]);
    const pad = v.length & 1 ? new Uint8Array([0]) : new Uint8Array(0);
    return concatBytes([utf8(id), le32(v.length), v, pad]);
  });
  subs.push(concatBytes([utf8('ISFT'), le32(6), utf8('Vipad'), new Uint8Array([0])]));
  const body = concatBytes([utf8('INFO'), ...subs]);
  return concatBytes([utf8('LIST'), le32(body.length), body]);
}

/** AIFF NAME / AUTH / ANNO / (c) text chunks. */
export function aiffText(t: Tags): Uint8Array {
  const c = clean(t);
  const chunk = (id: string, s?: string) => {
    if (!s) return new Uint8Array(0);
    const v = utf8(s);
    return concatBytes([utf8(id), be32(v.length), v, v.length & 1 ? new Uint8Array([0]) : new Uint8Array(0)]);
  };
  const anno = [c.album && `Album: ${c.album}`, c.genre && `Genre: ${c.genre}`, c.comment].filter(Boolean).join(' — ');
  return concatBytes([chunk('NAME', c.title), chunk('AUTH', c.artist), chunk('(c) ', c.year), chunk('ANNO', anno || undefined)]);
}
