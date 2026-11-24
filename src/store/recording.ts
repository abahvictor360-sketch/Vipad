/**
 * Live, in-editor recording (WavePad-style): the take draws in the main view while it records,
 * the transport shows the record state and a moving input meter. Used by every Record entry point.
 */
import { useLink } from '../link/store';
import { create } from 'zustand';
import { Recorder } from '../audio/recorder';
import { AudioData, insert, length, matchChannels, mixInto, resample, createSilence } from '../audio/buffer';
import { player } from '../audio/player';
import { saveToLibrary } from '../audio/library';
import { RecordingGuard } from '../app/autosave';
import { useEditor } from './editor';
import { useSettings } from './settings';
import { useMultitrack } from './multitrack';
import { formatTime } from '../app/format';

export type RecordDest = 'auto' | 'new' | 'insert' | 'overdub' | 'track';

interface RecordingState {
  status: 'idle' | 'starting' | 'countdown' | 'recording' | 'paused' | 'saving';
  countdown: number;
  dest: Exclude<RecordDest, 'auto'>;
  docId: string | null;
  at: number; // insert position (samples, doc rate) or multitrack cursor
  startedAt: number;
  error: string | null;
  recorder: Recorder | null;
  start: (dest?: RecordDest, opts?: { playAlong?: boolean }) => Promise<boolean>;
  togglePause: () => void;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
}

let guard: RecordingGuard | null = null;
let seq = 1;

const nameFor = () => {
  const d = new Date();
  return `Recording ${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
};

export function describeMicError(e: unknown): string {
  const err = e as DOMException;
  if (err?.name === 'NotAllowedError') return 'Microphone permission was denied. Allow microphone access in your browser or system settings, then try again.';
  if (err?.name === 'NotFoundError' || err?.name === 'OverconstrainedError') return 'The selected microphone was not found. Pick another one in Settings → Recording, or connect a microphone.';
  return err?.message || 'Could not start recording.';
}

export const useRecording = create<RecordingState>((set, get) => ({
  status: 'idle',
  countdown: 0,
  dest: 'new',
  docId: null,
  at: 0,
  startedAt: 0,
  error: null,
  recorder: null,

  start: async (want = 'auto', opts = {}) => {
    if (get().status !== 'idle') return false;
    const s = useSettings.getState();
    const ed = useEditor.getState();
    player.stop();
    let dest: Exclude<RecordDest, 'auto'>;
    if (want === 'auto') {
      if (s.multitrack) dest = 'track';
      else {
        const d = ed.active();
        dest = d && length(d.audio) === 0 ? 'insert' : 'new';
      }
    } else dest = want;
    set({ status: 'starting', error: null });

    const r = new Recorder();
    try {
      await r.start({
        deviceId: s.micDeviceId || undefined,
        channels: s.recordChannels,
        echoCancellation: s.recordVoiceProcessing,
        noiseSuppression: s.recordVoiceProcessing,
        autoGainControl: s.recordVoiceProcessing,
        stream: linkInput() ?? undefined,
      });
    } catch (e) {
      // a remembered device may have been unplugged: fall back to the system default once
      if (s.micDeviceId && ((e as DOMException)?.name === 'OverconstrainedError' || (e as DOMException)?.name === 'NotFoundError')) {
        try {
          await r.start({ channels: s.recordChannels, echoCancellation: s.recordVoiceProcessing, noiseSuppression: s.recordVoiceProcessing, autoGainControl: s.recordVoiceProcessing });
          ed.toast('Selected microphone not found — using the system default', 'info');
        } catch (e2) {
          set({ status: 'idle', error: describeMicError(e2) });
          ed.toast(describeMicError(e2), 'error');
          return false;
        }
      } else {
        set({ status: 'idle', error: describeMicError(e) });
        ed.toast(describeMicError(e), 'error');
        return false;
      }
    }
    if (r.deviceLabel && r.deviceLabel !== s.micLabel && !s.micDeviceId) useSettings.getState().set({ micLabel: r.deviceLabel });

    // target document
    let docId: string | null = null;
    let at = 0;
    if (dest === 'track') {
      const mt = useMultitrack.getState();
      at = mt.cursor;
      if ((opts.playAlong ?? s.recordPlayAlong) && mt.session.tracks.some((t) => t.clips.length)) player.play(mt.mix(), mt.cursor / mt.session.sampleRate);
    } else if (dest === 'new') {
      docId = ed.newDoc(`Recording ${seq++}`, createSilence(r.sampleRate, s.recordChannels, 0));
    } else {
      const d = ed.active();
      if (!d) docId = ed.newDoc(`Recording ${seq++}`, createSilence(r.sampleRate, s.recordChannels, 0));
      else {
        docId = d.id;
        at = d.selection?.start ?? d.cursor;
      }
      if (dest === 'overdub' && d && length(d.audio)) player.play(d.audio, at / d.audio.sampleRate);
    }

    if (s.soundActivated) r.gateDb = s.soundThresholdDb;
    guard = new RecordingGuard(() => r.drain());
    void guard.start(nameFor(), r.sampleRate, s.recordChannels);
    const secs = Math.max(0, Math.round(s.recordCountdown));
    if (secs > 0) {
      // count in: the mic is open (so the meter moves) but nothing is kept until zero
      r.pause();
      set({ status: 'countdown', countdown: secs, recorder: r, dest, docId, at, startedAt: Date.now() });
      for (let k = secs; k > 0; k--) {
        set({ countdown: k });
        await new Promise((res) => setTimeout(res, 1000));
        if (get().status !== 'countdown') return false; // cancelled during the count-in
      }
      r.resume();
    }
    set({ status: 'recording', countdown: 0, recorder: r, dest, docId, at, startedAt: Date.now() });
    return true;
  },

  togglePause: () => {
    const { status, recorder } = get();
    if (status === 'recording') { recorder?.pause(); set({ status: 'paused' }); }
    else if (status === 'paused') { recorder?.resume(); set({ status: 'recording' }); }
  },

  stop: async () => {
    const { recorder: r, dest, docId, at, status } = get();
    if (!r || (status !== 'recording' && status !== 'paused' && status !== 'countdown')) return;
    set({ status: 'saving' });
    guard?.flush();
    const audio = await r.stop();
    player.stop();
    const st = useEditor.getState();
    const name = nameFor();
    try {
      if (!length(audio)) {
        st.toast('Recording was empty', 'error');
        if (docId && dest !== 'insert' && dest !== 'overdub') {
          const d = st.docs.find((x) => x.id === docId);
          if (d && !length(d.audio)) st.closeDoc(docId);
        }
        return;
      }
      if (dest === 'track') {
        const mt = useMultitrack.getState();
        mt.addTrack(`Recording ${mt.session.tracks.length + 1}`, audio, at);
      } else if (docId) {
        if (st.activeId !== docId) st.setActive(docId);
        const d = st.docs.find((x) => x.id === docId)!;
        if (!length(d.audio)) {
          // fresh document: the take becomes the file (keeps the recording's own sample rate)
          useEditor.setState((s) => ({ docs: s.docs.map((x) => (x.id === docId ? { ...x, audio, name: x.name.startsWith('Recording') ? name : x.name, dirty: true, version: x.version + 1, cursor: 0 } : x)) }));
          player.invalidate();
        } else {
          const clip = resample(matchChannels(audio, d.audio.channels.length), d.audio.sampleRate);
          st.edit(dest === 'overdub' ? 'Overdub recording' : 'Record', (a) => ({
            audio: dest === 'overdub' ? mixInto(a, at, clip) : insert(a, at, clip),
            selection: { start: at, end: at + length(clip) },
          }));
        }
      }
      if (useSettings.getState().autoSaveRecordings) saveToLibrary(Math.random().toString(36).slice(2, 10), name, audio).catch(() => undefined);
      st.toast(`Recorded ${formatTime(length(audio) / audio.sampleRate)}`, 'success');
    } finally {
      void guard?.done();
      guard = null;
      set({ status: 'idle', recorder: null, docId: null });
    }
  },

  cancel: async () => {
    const { recorder: r, docId, dest } = get();
    if (!r) return;
    if (r.seconds > 3 && !confirm('Discard this recording? It cannot be recovered.')) return;
    await r.cancel();
    player.stop();
    void guard?.done();
    guard = null;
    const st = useEditor.getState();
    if (docId && dest === 'new') {
      const d = st.docs.find((x) => x.id === docId);
      if (d && !length(d.audio)) st.closeDoc(docId);
    }
    set({ status: 'idle', recorder: null, docId: null });
  },
}));

export const isRecording = () => {
  const s = useRecording.getState().status;
  return s === 'recording' || s === 'paused' || s === 'starting' || s === 'countdown';
};

export type { AudioData };

/** When Vipad Link is receiving and "Record guests" is on, recordings capture the guests' mix. */
function linkInput(): MediaStream | null {
  const l = useLink.getState();
  return l.role === 'host' && l.recordLink ? l.mixStream() : null;
}
