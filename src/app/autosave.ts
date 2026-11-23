/**
 * Continuous autosave + crash recovery.
 * Every open file and the multitrack session are written to IndexedDB shortly after each change,
 * and restored automatically the next time the app starts (after a crash, an accidental close,
 * a reload or a dead battery). Closed files stay recoverable for 30 days.
 */
import { create } from 'zustand';
import { useEditor, Doc } from '../store/editor';
import { useMultitrack } from '../store/multitrack';
import { useSettings } from '../store/settings';
import * as R from '../audio/recovery';
import { length } from '../audio/buffer';

type Status = 'idle' | 'saving' | 'saved' | 'error';
export const useAutosave = create<{ status: Status; lastSaved: number | null; restored: boolean }>(() => ({ status: 'idle', lastSaved: null, restored: false }));

const DEBOUNCE = 700;
const savedKey = new Map<string, string>(); // doc id -> fingerprint of last save
const pendingDocs = new Set<string>();
let docTimer: ReturnType<typeof setTimeout> | null = null;
let sessionTimer: ReturnType<typeof setTimeout> | null = null;
let sessionDirty = false;
let inflight = 0;

const fingerprint = (d: Doc) => `${d.version}|${d.name}|${d.dirty}|${d.markers.map((m) => `${m.pos}:${m.label}`).join(',')}`;

function setStatus(status: Status) {
  useAutosave.setState(status === 'saved' ? { status, lastSaved: Date.now() } : { status });
}

async function track<T>(p: Promise<T>): Promise<T | undefined> {
  inflight++;
  setStatus('saving');
  try {
    const r = await p;
    return r;
  } catch (e) {
    console.warn('[vipad] autosave failed', e);
    setStatus('error');
    return undefined;
  } finally {
    inflight--;
    if (inflight === 0 && useAutosave.getState().status !== 'error') setStatus('saved');
  }
}

async function writeDocs() {
  docTimer = null;
  const ids = [...pendingDocs];
  pendingDocs.clear();
  const docs = useEditor.getState().docs;
  for (const id of ids) {
    const d = docs.find((x) => x.id === id);
    if (!d) continue;
    savedKey.set(id, fingerprint(d));
    await track(
      R.putDoc({
        id: d.id,
        name: d.name,
        sampleRate: d.audio.sampleRate,
        channels: d.audio.channels,
        markers: d.markers,
        dirty: d.dirty,
        updatedAt: Date.now(),
        closedAt: null,
        order: docs.indexOf(d),
      }),
    );
  }
}

async function writeSession() {
  sessionTimer = null;
  if (!sessionDirty) return;
  sessionDirty = false;
  await track(R.putSession(useMultitrack.getState().session));
}

/** Write everything pending right now (page hide / app close). */
export function flushNow() {
  if (docTimer) { clearTimeout(docTimer); void writeDocs(); }
  if (sessionTimer) { clearTimeout(sessionTimer); void writeSession(); }
}

export const hasPendingWrites = () => !!docTimer || !!sessionTimer || inflight > 0;

/** Restore the previous session, then start watching for changes. Call once at startup. */
export async function startAutosave(): Promise<void> {
  void R.requestPersistence();
  const ed = useEditor.getState();
  let restoredFiles = 0;
  let recovered = 0;
  try {
    await R.purgeExpired();
    // 1) interrupted recordings
    for (const { meta, audio } of await R.recoverInterruptedRecordings()) {
      const name = `${meta.name} (recovered)`;
      ed.newDoc(name, audio, { dirty: true, background: true });
      await R.finishRecording(meta.recId);
      recovered++;
    }
    // 2) files that were open when the app last closed
    const open = (await R.allDocs()).filter((d) => !d.closedAt).sort((a, b) => a.order - b.order);
    for (const d of open) {
      if (useEditor.getState().docs.some((x) => x.id === d.id)) continue;
      useEditor.getState().newDoc(d.name, { sampleRate: d.sampleRate, channels: d.channels }, { id: d.id, markers: d.markers, dirty: d.dirty, background: true });
      restoredFiles++;
    }
    // 3) multitrack session
    const s = await R.getSession();
    if (s?.session?.tracks?.length && !useMultitrack.getState().session.tracks.length) {
      useMultitrack.setState((st) => ({ session: s.session, version: st.version + 1 }));
    }
  } catch (e) {
    console.warn('[vipad] recovery unavailable', e);
  }
  for (const d of useEditor.getState().docs) savedKey.set(d.id, fingerprint(d));
  useAutosave.setState({ restored: true });
  if (recovered) ed.toast(`Recovered ${recovered} unfinished recording${recovered > 1 ? 's' : ''}. Nothing was lost.`, 'success');
  else if (restoredFiles) ed.toast(`Restored ${restoredFiles} file${restoredFiles > 1 ? 's' : ''} from your last session`, 'success');

  // watch editor docs
  let prevIds = new Set(useEditor.getState().docs.map((d) => d.id));
  useEditor.subscribe((st) => {
    const ids = new Set(st.docs.map((d) => d.id));
    for (const d of st.docs) {
      if (savedKey.get(d.id) !== fingerprint(d)) pendingDocs.add(d.id);
    }
    for (const id of prevIds) {
      if (!ids.has(id)) {
        pendingDocs.delete(id);
        savedKey.delete(id);
        void track(R.markClosed(id)); // kept for 30 days in "Recently closed"
      }
    }
    prevIds = ids;
    if (pendingDocs.size && !docTimer) docTimer = setTimeout(writeDocs, DEBOUNCE);
  });

  // watch multitrack session
  let prevVersion = useMultitrack.getState().version;
  useMultitrack.subscribe((st) => {
    if (st.version === prevVersion) return;
    prevVersion = st.version;
    sessionDirty = true;
    if (!sessionTimer) sessionTimer = setTimeout(writeSession, DEBOUNCE);
  });

  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => document.hidden && flushNow());
  void useSettings; // settings persist themselves
}

// ---------- recording safety net used by the record dialog
export class RecordingGuard {
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  readonly recId = Math.random().toString(36).slice(2, 10);

  constructor(private drain: () => Float32Array[] | null) {}

  async start(name: string, sampleRate: number, numCh: number) {
    await R.startRecording({ recId: this.recId, name, sampleRate, numCh, startedAt: Date.now(), finished: false }).catch(() => undefined);
    this.timer = setInterval(() => this.flush(), 2000);
    window.addEventListener('pagehide', this.flush);
  }

  flush = () => {
    const chunk = this.drain();
    if (chunk && chunk[0].length) void R.putChunk(this.recId, this.seq++, chunk).catch(() => undefined);
  };

  /** Recording ended normally: the take now lives in a document (which is autosaved). */
  async done() {
    this.stopTimer();
    await R.finishRecording(this.recId).catch(() => undefined);
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    window.removeEventListener('pagehide', this.flush);
  }
}

export const describeLength = (d: { sampleRate: number; channels: Float32Array[] }) => length(d) / d.sampleRate;
