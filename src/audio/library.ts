import { AudioData, duration } from './buffer';

/** IndexedDB-backed local library so recordings survive reloads and crashes. */
export interface LibraryItem {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  duration: number;
  sampleRate: number;
  numChannels: number;
}

interface StoredItem extends LibraryItem { channels: Float32Array[] }

const DB = 'vipad';
const STORE = 'library';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function saveToLibrary(id: string, name: string, a: AudioData): Promise<LibraryItem> {
  const now = Date.now();
  const existing = await tx<StoredItem | undefined>('readonly', (s) => s.get(id)).catch(() => undefined);
  const item: StoredItem = {
    id,
    name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    duration: duration(a),
    sampleRate: a.sampleRate,
    numChannels: a.channels.length,
    channels: a.channels,
  };
  await tx('readwrite', (s) => s.put(item));
  const { channels: _c, ...meta } = item;
  void _c;
  return meta;
}

export async function listLibrary(): Promise<LibraryItem[]> {
  const all = await tx<StoredItem[]>('readonly', (s) => s.getAll());
  return all.map(({ channels: _c, ...m }) => (void _c, m)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadFromLibrary(id: string): Promise<AudioData | null> {
  const it = await tx<StoredItem | undefined>('readonly', (s) => s.get(id));
  return it ? { sampleRate: it.sampleRate, channels: it.channels } : null;
}

export async function deleteFromLibrary(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
}
