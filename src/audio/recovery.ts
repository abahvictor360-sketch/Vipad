/**
 * Crash-safe storage. Separate IndexedDB database so it never conflicts with the library.
 * - docs:      every open file (audio + markers), continuously autosaved; closed files kept 30 days
 * - session:   the multitrack session
 * - recChunks: in-progress recordings, flushed every couple of seconds while recording
 * - recMeta:   metadata for each recording (finished=false means it was interrupted)
 */
import { AudioData } from './buffer';
import type { Session } from './mixer';

export interface StoredDoc {
  id: string;
  name: string;
  sampleRate: number;
  channels: Float32Array[];
  markers: { id: string; pos: number; label: string }[];
  dirty: boolean;
  updatedAt: number;
  closedAt: number | null;
  order: number;
}

export interface RecMeta {
  recId: string;
  name: string;
  sampleRate: number;
  numCh: number;
  startedAt: number;
  finished: boolean;
}

export const RETENTION_MS = 30 * 24 * 3600 * 1000;
const DB = 'vipad-recovery';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        d.createObjectStore('docs', { keyPath: 'id' });
        d.createObjectStore('session');
        d.createObjectStore('recChunks', { keyPath: 'key' }).createIndex('recId', 'recId');
        d.createObjectStore('recMeta', { keyPath: 'recId' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbp.catch(() => (dbp = null));
  }
  return dbp;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const t = d.transaction(store, mode);
        const r = fn(t.objectStore(store));
        t.oncomplete = () => resolve(r ? r.result : (undefined as T));
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

// ---------- docs
export const putDoc = (d: StoredDoc) => run('docs', 'readwrite', (s) => s.put(d));
export const getDoc = (id: string) => run<StoredDoc | undefined>('docs', 'readonly', (s) => s.get(id));
export const allDocs = () => run<StoredDoc[]>('docs', 'readonly', (s) => s.getAll());
export const deleteDoc = (id: string) => run('docs', 'readwrite', (s) => s.delete(id));

export async function markClosed(id: string) {
  const d = await getDoc(id);
  if (d) await putDoc({ ...d, closedAt: Date.now() });
}

export async function purgeExpired(now = Date.now()) {
  const docs = await allDocs();
  await Promise.all(docs.filter((d) => d.closedAt && now - d.closedAt > RETENTION_MS).map((d) => deleteDoc(d.id)));
}

// ---------- session
export const putSession = (s: Session) => run('session', 'readwrite', (st) => st.put({ session: s, updatedAt: Date.now() }, 'current'));
export const getSession = () => run<{ session: Session } | undefined>('session', 'readonly', (st) => st.get('current'));

// ---------- recordings in progress
export const startRecording = (m: RecMeta) => run('recMeta', 'readwrite', (s) => s.put(m));
export const putChunk = (recId: string, seq: number, channels: Float32Array[]) =>
  run('recChunks', 'readwrite', (s) => s.put({ key: `${recId}:${String(seq).padStart(8, '0')}`, recId, seq, channels }));

export async function finishRecording(recId: string) {
  await run('recMeta', 'readwrite', (s) => s.delete(recId));
  const d = await db();
  await new Promise<void>((resolve, reject) => {
    const t = d.transaction('recChunks', 'readwrite');
    const idx = t.objectStore('recChunks').index('recId');
    const req = idx.openCursor(IDBKeyRange.only(recId));
    req.onsuccess = () => {
      const c = req.result;
      if (c) { c.delete(); c.continue(); }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

/** Rebuild every recording that was interrupted (crash, closed tab, battery died…). */
export async function recoverInterruptedRecordings(): Promise<{ meta: RecMeta; audio: AudioData }[]> {
  const metas = await run<RecMeta[]>('recMeta', 'readonly', (s) => s.getAll());
  const out: { meta: RecMeta; audio: AudioData }[] = [];
  for (const meta of metas.filter((m) => !m.finished)) {
    const chunks = await run<{ seq: number; channels: Float32Array[] }[]>('recChunks', 'readonly', (s) => s.index('recId').getAll(IDBKeyRange.only(meta.recId)));
    chunks.sort((a, b) => a.seq - b.seq);
    const total = chunks.reduce((n, c) => n + (c.channels[0]?.length ?? 0), 0);
    if (total > 0) {
      const channels = Array.from({ length: meta.numCh }, () => new Float32Array(total));
      let off = 0;
      for (const c of chunks) {
        for (let ch = 0; ch < meta.numCh; ch++) channels[ch].set(c.channels[Math.min(ch, c.channels.length - 1)], off);
        off += c.channels[0].length;
      }
      out.push({ meta, audio: { sampleRate: meta.sampleRate, channels } });
    }
  }
  return out;
}

/** Ask the browser not to evict our storage under pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}
