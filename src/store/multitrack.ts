import { create } from 'zustand';
import { AudioData, length } from '../audio/buffer';
import { Clip, Session, Track, conform, mixdown, sessionLength, splitClip, clipEnd } from '../audio/mixer';
import { player } from '../audio/player';
import { useSettings } from './settings';

const uid = () => Math.random().toString(36).slice(2, 10);

interface MultitrackState {
  session: Session;
  cursor: number; // samples
  selectedClipId: string | null;
  selectedTrackId: string | null;
  pxPerSec: number;
  scrollSec: number;
  version: number;
  undoStack: Session[];
  redoStack: Session[];

  commit: (label: string, fn: (s: Session) => Session) => void;
  undo: () => void;
  redo: () => void;
  addTrack: (name?: string, audio?: AudioData, at?: number) => string;
  removeTrack: (id: string) => void;
  updateTrack: (id: string, patch: Partial<Omit<Track, 'id' | 'clips'>>, record?: boolean) => void;
  addClip: (trackId: string, audio: AudioData, name: string, at?: number) => void;
  moveClip: (clipId: string, start: number, toTrackId?: string) => void;
  setClipGain: (clipId: string, gainDb: number) => void;
  removeClip: (clipId: string) => void;
  splitSelected: () => boolean;
  duplicateSelected: () => void;
  selectClip: (clipId: string | null, trackId?: string | null) => void;
  setCursor: (pos: number) => void;
  setZoom: (pxPerSec: number) => void;
  setScroll: (sec: number) => void;
  findClip: (clipId: string) => { track: Track; clip: Clip } | null;
  mix: () => AudioData;
  togglePlay: () => void;
  clear: () => void;
}

let mixCache: { version: number; audio: AudioData } | null = null;

const emptySession = (): Session => ({ sampleRate: useSettings.getState().newSampleRate, tracks: [] });

export const useMultitrack = create<MultitrackState>((set, get) => ({
  session: emptySession(),
  cursor: 0,
  selectedClipId: null,
  selectedTrackId: null,
  pxPerSec: 60,
  scrollSec: 0,
  version: 0,
  undoStack: [],
  redoStack: [],

  commit: (_label, fn) => {
    player.stop();
    set((s) => ({
      undoStack: [...s.undoStack.slice(-80), s.session],
      redoStack: [],
      session: fn(s.session),
      version: s.version + 1,
    }));
  },
  undo: () => {
    const { undoStack, session } = get();
    const prev = undoStack[undoStack.length - 1];
    if (!prev) return;
    player.stop();
    set((s) => ({ session: prev, undoStack: undoStack.slice(0, -1), redoStack: [...s.redoStack, session], version: s.version + 1 }));
  },
  redo: () => {
    const { redoStack, session } = get();
    const next = redoStack[redoStack.length - 1];
    if (!next) return;
    player.stop();
    set((s) => ({ session: next, redoStack: redoStack.slice(0, -1), undoStack: [...s.undoStack, session], version: s.version + 1 }));
  },

  addTrack: (name, audio, at) => {
    const id = uid();
    get().commit('Add track', (s) => {
      const n = s.tracks.length + 1;
      const track: Track = { id, name: name ?? `Track ${n}`, clips: [], volumeDb: 0, pan: 0, mute: false, solo: false };
      if (audio && length(audio)) {
        track.clips.push({ id: uid(), name: name ?? `Clip ${n}`, audio: conform(audio, s.sampleRate), start: Math.max(0, at ?? 0), gainDb: 0 });
      }
      return { ...s, tracks: [...s.tracks, track] };
    });
    set({ selectedTrackId: id });
    return id;
  },
  removeTrack: (id) => {
    get().commit('Remove track', (s) => ({ ...s, tracks: s.tracks.filter((t) => t.id !== id) }));
    set((st) => ({ selectedTrackId: st.selectedTrackId === id ? null : st.selectedTrackId }));
  },
  updateTrack: (id, patch, record = false) => {
    const fn = (s: Session) => ({ ...s, tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    if (record) get().commit('Track change', fn);
    else set((st) => ({ session: fn(st.session), version: st.version + 1 }));
  },
  addClip: (trackId, audio, name, at) => {
    get().commit('Add clip', (s) => ({
      ...s,
      tracks: s.tracks.map((t) =>
        t.id === trackId ? { ...t, clips: [...t.clips, { id: uid(), name, audio: conform(audio, s.sampleRate), start: Math.max(0, at ?? get().cursor), gainDb: 0 }] } : t,
      ),
    }));
  },
  moveClip: (clipId, start, toTrackId) => {
    const found = get().findClip(clipId);
    if (!found) return;
    const clip = { ...found.clip, start: Math.max(0, Math.round(start)) };
    const dest = toTrackId ?? found.track.id;
    get().commit('Move clip', (s) => ({
      ...s,
      tracks: s.tracks.map((t) => {
        let clips = t.clips.filter((c) => c.id !== clipId);
        if (t.id === dest) clips = [...clips, clip];
        return { ...t, clips };
      }),
    }));
    set({ selectedTrackId: dest });
  },
  setClipGain: (clipId, gainDb) =>
    set((st) => ({
      session: { ...st.session, tracks: st.session.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, gainDb } : c)) })) },
      version: st.version + 1,
    })),
  removeClip: (clipId) => {
    get().commit('Delete clip', (s) => ({ ...s, tracks: s.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clipId) })) }));
    set({ selectedClipId: null });
  },
  splitSelected: () => {
    const { selectedClipId, cursor } = get();
    const found = selectedClipId ? get().findClip(selectedClipId) : null;
    // fall back to any clip under the cursor
    const target =
      found ??
      (() => {
        for (const t of get().session.tracks) for (const c of t.clips) if (cursor > c.start && cursor < clipEnd(c)) return { track: t, clip: c };
        return null;
      })();
    if (!target) return false;
    const parts = splitClip(target.clip, cursor, uid);
    if (!parts) return false;
    get().commit('Split clip', (s) => ({
      ...s,
      tracks: s.tracks.map((t) => (t.id === target.track.id ? { ...t, clips: t.clips.flatMap((c) => (c.id === target.clip.id ? parts : [c])) } : t)),
    }));
    set({ selectedClipId: parts[1].id });
    return true;
  },
  duplicateSelected: () => {
    const id = get().selectedClipId;
    const found = id ? get().findClip(id) : null;
    if (!found) return;
    const copy: Clip = { ...found.clip, id: uid(), name: `${found.clip.name} copy`, start: clipEnd(found.clip) };
    get().commit('Duplicate clip', (s) => ({ ...s, tracks: s.tracks.map((t) => (t.id === found.track.id ? { ...t, clips: [...t.clips, copy] } : t)) }));
    set({ selectedClipId: copy.id });
  },
  selectClip: (clipId, trackId) => set((st) => ({ selectedClipId: clipId, selectedTrackId: trackId === undefined ? st.selectedTrackId : trackId })),
  setCursor: (pos) => set({ cursor: Math.max(0, Math.round(pos)) }),
  setZoom: (pxPerSec) => set({ pxPerSec: Math.max(2, Math.min(4000, pxPerSec)) }),
  setScroll: (sec) => set({ scrollSec: Math.max(0, sec) }),
  findClip: (clipId) => {
    for (const t of get().session.tracks) for (const c of t.clips) if (c.id === clipId) return { track: t, clip: c };
    return null;
  },
  mix: () => {
    const v = get().version;
    if (mixCache?.version !== v) mixCache = { version: v, audio: mixdown(get().session) };
    return mixCache.audio;
  },
  togglePlay: () => {
    if (player.playing) {
      const p = player.pause();
      get().setCursor(p * get().session.sampleRate);
      return;
    }
    const s = get().session;
    const n = sessionLength(s);
    if (!n) return;
    const from = get().cursor >= n ? 0 : get().cursor;
    player.invalidate();
    player.play(get().mix(), from / s.sampleRate);
  },
  clear: () => {
    player.stop();
    set({ session: emptySession(), cursor: 0, selectedClipId: null, selectedTrackId: null, undoStack: [], redoStack: [], version: get().version + 1 });
  },
}));
