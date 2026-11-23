import { create } from 'zustand';
import * as B from '../audio/buffer';
import { AudioData, Range } from '../audio/buffer';
import { History } from '../audio/history';
import { EFFECTS_BY_ID, Params } from '../audio/effects';
import { runEffect } from '../audio/runEffect';
import { player } from '../audio/player';
import { decodeWav } from '../audio/wav';
import { saveToLibrary } from '../audio/library';

export interface Marker {
  id: string;
  pos: number; // sample index
  label: string;
}

export interface Doc {
  id: string;
  name: string;
  audio: AudioData;
  selection: Range | null;
  cursor: number;
  history: History<Marker[]>;
  markers: Marker[];
  dirty: boolean;
  /** samples per pixel; null = fit to view */
  zoom: number | null;
  scroll: number; // first visible sample
  version: number; // bumps on every audio change (cache key for views)
}

export interface Toast {
  id: number;
  kind: 'info' | 'success' | 'error';
  text: string;
}

export type DialogState =
  | { type: 'effect'; effectId: string }
  | { type: 'generate'; kind: 'tone' | 'noise' | 'silence' | 'dtmf' }
  | { type: 'export' }
  | { type: 'record' }
  | { type: 'new' }
  | { type: 'shortcuts' }
  | { type: 'library' }
  | { type: 'batch' }
  | { type: 'about' }
  | null;

const uid = () => Math.random().toString(36).slice(2, 10);
let toastSeq = 0;

interface EditorState {
  docs: Doc[];
  activeId: string | null;
  clipboard: AudioData | null;
  dialog: DialogState;
  busy: string | null;
  toasts: Toast[];
  loop: boolean;
  followPlayhead: boolean;
  snapToZero: boolean;
  lastParams: Record<string, Params>;

  active: () => Doc | null;
  setDialog: (d: DialogState) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;

  newDoc: (name: string, audio: AudioData) => string;
  openFiles: (files: File[] | FileList) => Promise<void>;
  closeDoc: (id: string) => void;
  setActive: (id: string) => void;
  renameDoc: (id: string, name: string) => void;
  updateView: (patch: Partial<Pick<Doc, 'zoom' | 'scroll'>>) => void;
  setSelection: (r: Range | null) => void;
  setCursor: (pos: number) => void;
  selectAll: () => void;

  edit: (label: string, fn: (a: AudioData, d: Doc) => { audio: AudioData; selection?: Range | null; cursor?: number }) => void;
  undo: () => void;
  redo: () => void;
  copy: () => void;
  cut: () => void;
  paste: (mix?: boolean) => void;
  deleteSel: () => void;
  trim: () => void;
  silence: () => void;
  insertAudio: (label: string, a: AudioData) => void;
  applyEffect: (effectId: string, params: Params) => Promise<void>;
  convertDoc: (label: string, fn: (a: AudioData) => AudioData) => void;
  addMarker: () => void;
  removeMarker: (id: string) => void;
  saveActiveToLibrary: () => Promise<void>;

  togglePlay: () => void;
  stop: () => void;
  setLoop: (v: boolean) => void;
  setFollow: (v: boolean) => void;
}

function targetRange(d: Doc): Range {
  return d.selection && d.selection.end > d.selection.start ? d.selection : { start: 0, end: B.length(d.audio) };
}

/** Decode an audio file: WAV parsed natively for full bit depth, everything else via the browser decoder. */
export async function decodeFile(file: Blob): Promise<AudioData> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(12, buf.byteLength));
  const isWav = String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'WAVE';
  if (isWav) {
    try {
      return decodeWav(buf);
    } catch {
      /* fall back to browser decoder (e.g. ADPCM) */
    }
  }
  const ab = await player.decode(buf);
  return B.fromAudioBuffer(ab);
}

export const useEditor = create<EditorState>((set, get) => {
  const patchActive = (fn: (d: Doc) => Partial<Doc>) =>
    set((s) => ({ docs: s.docs.map((d) => (d.id === s.activeId ? { ...d, ...fn(d) } : d)) }));

  const commit = (d: Doc, label: string, audio: AudioData, selection: Range | null | undefined, cursor: number | undefined) => {
    d.history.push({ audio: d.audio, label, meta: d.markers });
    player.invalidate();
    const n = B.length(audio);
    patchActive(() => ({
      audio,
      selection: selection === undefined ? d.selection && B.clampRange(audio, d.selection) : selection,
      cursor: Math.min(n, cursor ?? d.cursor),
      markers: d.markers.filter((m) => m.pos <= n),
      dirty: true,
      version: d.version + 1,
    }));
  };

  return {
    docs: [],
    activeId: null,
    clipboard: null,
    dialog: null,
    busy: null,
    toasts: [],
    loop: false,
    followPlayhead: true,
    snapToZero: false,
    lastParams: {},

    active: () => get().docs.find((d) => d.id === get().activeId) ?? null,
    setDialog: (dialog) => set({ dialog }),
    toast: (text, kind = 'info') => {
      const id = ++toastSeq;
      set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, text }] }));
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
    },
    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    newDoc: (name, audio) => {
      const id = uid();
      const doc: Doc = {
        id,
        name,
        audio,
        selection: null,
        cursor: 0,
        history: new History(),
        markers: [],
        dirty: false,
        zoom: null,
        scroll: 0,
        version: 0,
      };
      player.stop();
      set((s) => ({ docs: [...s.docs, doc], activeId: id }));
      return id;
    },

    openFiles: async (files) => {
      const list = Array.from(files);
      for (const f of list) {
        set({ busy: `Opening ${f.name}…` });
        try {
          const audio = await decodeFile(f);
          get().newDoc(f.name.replace(/\.[^.]+$/, ''), audio);
          get().toast(`Opened ${f.name}`, 'success');
        } catch (e) {
          get().toast(`Could not open ${f.name}: unsupported or corrupt audio. ${(e as Error).message ?? ''}`, 'error');
        }
      }
      set({ busy: null });
    },

    closeDoc: (id) => {
      player.stop();
      set((s) => {
        const docs = s.docs.filter((d) => d.id !== id);
        const activeId = s.activeId === id ? docs[docs.length - 1]?.id ?? null : s.activeId;
        return { docs, activeId };
      });
    },
    setActive: (id) => {
      player.stop();
      set({ activeId: id });
    },
    renameDoc: (id, name) => set((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, name } : d)) })),
    updateView: (patch) => patchActive(() => patch),
    setSelection: (r) => patchActive((d) => ({ selection: r && r.end - r.start > 0 ? B.clampRange(d.audio, r) : null })),
    setCursor: (pos) => patchActive((d) => ({ cursor: Math.max(0, Math.min(B.length(d.audio), Math.round(pos))) })),
    selectAll: () => patchActive((d) => ({ selection: B.length(d.audio) ? { start: 0, end: B.length(d.audio) } : null })),

    edit: (label, fn) => {
      const d = get().active();
      if (!d) return;
      player.stop();
      const r = fn(d.audio, d);
      commit(d, label, r.audio, r.selection, r.cursor);
    },

    undo: () => {
      const d = get().active();
      if (!d) return;
      player.stop();
      const s = d.history.undo({ audio: d.audio, label: d.history.undoLabel ?? '', meta: d.markers });
      if (!s) return;
      player.invalidate();
      patchActive((x) => ({ audio: s.audio, markers: s.meta ?? x.markers, selection: x.selection && B.clampRange(s.audio, x.selection), cursor: Math.min(x.cursor, B.length(s.audio)), version: x.version + 1, dirty: true }));
      get().toast(`Undo ${s.label}`);
    },
    redo: () => {
      const d = get().active();
      if (!d) return;
      player.stop();
      const label = d.history.redoLabel ?? '';
      const s = d.history.redo({ audio: d.audio, label, meta: d.markers });
      if (!s) return;
      player.invalidate();
      patchActive((x) => ({ audio: s.audio, markers: s.meta ?? x.markers, selection: x.selection && B.clampRange(s.audio, x.selection), cursor: Math.min(x.cursor, B.length(s.audio)), version: x.version + 1, dirty: true }));
      get().toast(`Redo ${label}`);
    },

    copy: () => {
      const d = get().active();
      if (!d?.selection) return get().toast('Select some audio to copy');
      set({ clipboard: B.slice(d.audio, d.selection) });
      get().toast('Copied selection');
    },
    cut: () => {
      const d = get().active();
      if (!d?.selection) return get().toast('Select some audio to cut');
      const sel = d.selection;
      set({ clipboard: B.slice(d.audio, sel) });
      get().edit('Cut', (a) => ({ audio: B.remove(a, sel), selection: null, cursor: sel.start }));
    },
    paste: (mix = false) => {
      const d = get().active();
      const clip = get().clipboard;
      if (!d || !clip) return get().toast('Clipboard is empty');
      if (mix) {
        get().edit('Mix paste', (a) => ({ audio: B.mixInto(a, d.selection?.start ?? d.cursor, clip), selection: null }));
        return;
      }
      if (d.selection) {
        const sel = d.selection;
        get().edit('Paste', (a) => {
          const out = B.replace(a, sel, clip);
          const len = B.length(out) - B.length(a) + (sel.end - sel.start);
          return { audio: out, selection: { start: sel.start, end: sel.start + len }, cursor: sel.start };
        });
      } else {
        get().edit('Paste', (a) => {
          const out = B.insert(a, d.cursor, clip);
          const len = B.length(out) - B.length(a);
          return { audio: out, selection: { start: d.cursor, end: d.cursor + len }, cursor: d.cursor };
        });
      }
    },
    deleteSel: () => {
      const d = get().active();
      if (!d?.selection) return get().toast('Select some audio to delete');
      const sel = d.selection;
      get().edit('Delete', (a) => ({ audio: B.remove(a, sel), selection: null, cursor: sel.start }));
    },
    trim: () => {
      const d = get().active();
      if (!d?.selection) return get().toast('Select the part you want to keep, then Trim');
      const sel = d.selection;
      get().edit('Trim', (a) => ({ audio: B.crop(a, sel), selection: null, cursor: 0 }));
      get().updateView({ zoom: null, scroll: 0 });
    },
    silence: () => {
      const d = get().active();
      if (!d?.selection) return get().toast('Select a region to silence');
      const sel = d.selection;
      get().edit('Silence', (a) => ({ audio: B.silenceRange(a, sel) }));
    },
    insertAudio: (label, clip) => {
      const d = get().active();
      if (!d) {
        get().newDoc(label, clip);
        return;
      }
      const at = d.selection ? d.selection.start : d.cursor;
      const fn = (a: AudioData) => {
        const out = d.selection ? B.replace(a, d.selection, clip) : B.insert(a, at, clip);
        const len = B.length(out) - B.length(a) + (d.selection ? d.selection.end - d.selection.start : 0);
        return { audio: out, selection: { start: at, end: at + len }, cursor: at };
      };
      get().edit(label, fn);
    },

    applyEffect: async (effectId, params) => {
      const d = get().active();
      const e = EFFECTS_BY_ID[effectId];
      if (!d || !e) return;
      if (B.length(d.audio) === 0) return get().toast('Nothing to process — record or open audio first');
      if (e.stereoOnly && d.audio.channels.length < 2) return get().toast(`${e.name} needs stereo audio`, 'error');
      const range = targetRange(d);
      set((s) => ({ busy: `Applying ${e.name}…`, lastParams: { ...s.lastParams, [effectId]: params } }));
      player.stop();
      try {
        const processed = await runEffect(effectId, B.slice(d.audio, range), params);
        // doc may have changed meanwhile
        const cur = get().docs.find((x) => x.id === d.id);
        if (!cur || cur.version !== d.version) throw new Error('Document changed while processing');
        const selLen = range.end - range.start;
        let out: AudioData;
        let newSel: Range;
        if (e.tailMode === 'mixTail' && B.length(processed) > selLen) {
          const head = B.slice(processed, { start: 0, end: selLen });
          const tail = B.slice(processed, { start: selLen, end: B.length(processed) });
          out = B.mixInto(B.replace(d.audio, range, head), range.end, tail);
          newSel = range;
        } else {
          out = B.replace(d.audio, range, processed);
          newSel = { start: range.start, end: range.start + B.length(processed) };
        }
        commit(cur, e.name, out, d.selection ? (newSel.end > newSel.start ? newSel : null) : null, undefined);
        get().toast(`${e.name} applied`, 'success');
      } catch (err) {
        get().toast(`${e.name} failed: ${(err as Error).message}`, 'error');
      } finally {
        set({ busy: null });
      }
    },

    convertDoc: (label, fn) => {
      get().edit(label, (a) => ({ audio: fn(a) }));
    },

    addMarker: () => {
      const d = get().active();
      if (!d) return;
      const pos = d.selection?.start ?? d.cursor;
      patchActive((x) => ({ markers: [...x.markers, { id: uid(), pos, label: `Marker ${x.markers.length + 1}` }].sort((a, b) => a.pos - b.pos) }));
    },
    removeMarker: (id) => patchActive((x) => ({ markers: x.markers.filter((m) => m.id !== id) })),

    saveActiveToLibrary: async () => {
      const d = get().active();
      if (!d) return;
      try {
        await saveToLibrary(d.id, d.name, d.audio);
        patchActive(() => ({ dirty: false }));
        get().toast(`Saved “${d.name}” to your library`, 'success');
      } catch (e) {
        get().toast(`Save failed: ${(e as Error).message}`, 'error');
      }
    },

    togglePlay: () => {
      const d = get().active();
      if (!d) return;
      if (player.playing) {
        const p = player.pause();
        get().setCursor(p * d.audio.sampleRate);
        return;
      }
      const sr = d.audio.sampleRate;
      const n = B.length(d.audio);
      if (d.selection) {
        player.play(d.audio, d.selection.start / sr, d.selection.end / sr, get().loop);
      } else {
        const from = d.cursor >= n ? 0 : d.cursor;
        player.play(d.audio, from / sr, undefined, get().loop);
      }
    },
    stop: () => {
      player.stop();
    },
    setLoop: (loop) => set({ loop }),
    setFollow: (followPlayhead) => set({ followPlayhead }),
  };
});
