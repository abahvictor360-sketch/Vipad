import { AudioData } from './buffer';
import { EFFECTS_BY_ID, Params } from './effects';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (a: AudioData) => void; reject: (e: Error) => void }>();

function getWorker(): Worker | null {
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const { id, ok, error, sampleRate, channels } = e.data;
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (ok) p.resolve({ sampleRate, channels });
      else p.reject(new Error(error));
    };
    worker.onerror = () => { worker = null; };
    return worker;
  } catch {
    return null;
  }
}

/** Run an effect off the main thread (falls back to the main thread if workers are unavailable). */
export function runEffect(effectId: string, a: AudioData, params: Params): Promise<AudioData> {
  const w = getWorker();
  if (!w) return Promise.resolve(EFFECTS_BY_ID[effectId].apply(a, params));
  const id = ++seq;
  const channels = a.channels.map((c) => new Float32Array(c));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, effectId, params, sampleRate: a.sampleRate, channels }, channels.map((c) => c.buffer));
  });
}
