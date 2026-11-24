import { useEffect, useState } from 'react';
import { useEditor } from '../store/editor';
import { Header } from '../components/Header';
import { Transport, zoom } from '../components/Transport';
import { Sidebar } from '../components/Sidebar';
import { Waveform, Overview } from '../components/Waveform';
import { DocTabs, Toasts, EmptyState } from '../components/Chrome';
import { EffectDialog } from '../components/dialogs/EffectDialog';
import { GenerateDialog } from '../components/dialogs/GenerateDialog';
import { ExportDialog } from '../components/dialogs/ExportDialog';
import { RecordDialog } from '../components/dialogs/RecordDialog';
import { NewDialog, ShortcutsDialog, LibraryDialog, BatchDialog, AboutDialog } from '../components/dialogs/MiscDialogs';
import { length } from '../audio/buffer';
import { player } from '../audio/player';
import { Upload } from 'lucide-react';
import { MultiTrack } from '../components/MultiTrack';
import { SettingsDialog } from '../components/dialogs/SettingsDialog';
import { useSettings } from '../store/settings';
import { useMultitrack } from '../store/multitrack';
import { startAutosave, flushNow, hasPendingWrites } from './autosave';
import { isElectron } from './platform';
import { useRecording, isRecording } from '../store/recording';
import { LiveRecording } from '../components/LiveRecording';

let autosaveStarted = false;

function Dialogs() {
  const dialog = useEditor((s) => s.dialog);
  if (!dialog) return null;
  switch (dialog.type) {
    case 'effect': return <EffectDialog key={dialog.effectId} effectId={dialog.effectId} />;
    case 'generate': return <GenerateDialog key={dialog.kind} kind={dialog.kind} />;
    case 'export': return <ExportDialog />;
    case 'record': return <RecordDialog />;
    case 'new': return <NewDialog />;
    case 'shortcuts': return <ShortcutsDialog />;
    case 'library': return <LibraryDialog />;
    case 'batch': return <BatchDialog />;
    case 'about': return <AboutDialog />;
    case 'settings': return <SettingsDialog />;
  }
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = useEditor.getState();
      const t = e.target as HTMLElement;
      if (st.dialog || t.closest('input, select, textarea, [contenteditable]')) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      const run = (fn: () => void) => { e.preventDefault(); fn(); };
      if (mod && e.key === ',') return run(() => st.setDialog({ type: 'settings' }));
      // while recording: Space / R stop, P pauses, Esc discards
      if (isRecording()) {
        const rec = useRecording.getState();
        if (e.key === ' ' || k === 'r') return run(() => void rec.stop());
        if (k === 'p') return run(rec.togglePause);
        if (e.key === 'Escape') return run(() => void rec.cancel());
        if (!mod) return;
      }
      if (useSettings.getState().multitrack) {
        const mt = useMultitrack.getState();
        if (mod && k === 'z' && e.shiftKey) return run(mt.redo);
        if (mod && k === 'z') return run(mt.undo);
        if (mod && k === 'y') return run(mt.redo);
        if (mod && k === 'd') return run(mt.duplicateSelected);
        if (mod) return;
        if (e.key === ' ') return run(st.togglePlay);
        if (e.key === 'Delete' || e.key === 'Backspace') return run(() => mt.selectedClipId && mt.removeClip(mt.selectedClipId));
        if (k === 's') return run(() => void mt.splitSelected());
        if (k === 'r') return run(() => (isRecording() ? void useRecording.getState().stop() : void useRecording.getState().start('track')));
        if (e.key === 'Home') return run(() => { mt.setCursor(0); mt.setScroll(0); });
        if (e.key === '+' || e.key === '=') return run(() => mt.setZoom(mt.pxPerSec * 1.6));
        if (e.key === '-') return run(() => mt.setZoom(mt.pxPerSec / 1.6));
        if (e.key === '?') return run(() => st.setDialog({ type: 'shortcuts' }));
        return;
      }
      if (mod) {
        if (k === 's' && e.shiftKey) return run(() => { const n = prompt('Save as', st.active()?.name ?? 'Untitled'); if (n) void st.saveAs(n); });
        if (k === 'w') return run(() => { const d = st.active(); if (d && (!d.dirty || !useSettings.getState().confirmClose || confirm(`Close “${d.name}”?\n\nIt stays recoverable for 30 days in Library → Recently closed.`))) st.closeDoc(d.id); });
        if (k === 'z' && e.shiftKey) return run(st.redo);
        if (k === 'z') return run(st.undo);
        if (k === 'y') return run(st.redo);
        if (k === 'x') return run(st.cut);
        if (k === 'c') return run(st.copy);
        if (k === 'v') return run(() => st.paste(e.shiftKey));
        if (k === 'a') return run(st.selectAll);
        if (k === 't') return run(st.trim);
        if (k === 's') return run(() => void st.saveActiveToLibrary());
        if (k === 'e') return run(() => st.active() && st.setDialog({ type: 'export' }));
        if (k === 'o') return run(() => document.querySelector<HTMLInputElement>('[data-testid=file-input]')?.click());
        if (k === 'n') return run(() => st.setDialog({ type: 'new' }));
        return;
      }
      const d = st.active();
      switch (e.key) {
        case ' ': return run(st.togglePlay);
        case 'Delete':
        case 'Backspace': return run(st.deleteSel);
        case 'Escape': return run(() => st.setSelection(null));
        case 'Home': return run(() => { st.setCursor(0); st.updateView({ scroll: 0 }); });
        case 'End': return run(() => d && st.setCursor(length(d.audio)));
        case '+':
        case '=': return run(() => zoom(0.5));
        case '-': return run(() => zoom(2));
        case '0': return run(() => zoom('fit'));
        case '?': return run(() => st.setDialog({ type: 'shortcuts' }));
        case 'ArrowLeft': return run(() => d && st.setCursor(d.cursor - d.audio.sampleRate * useSettings.getState().skipSeconds * (e.shiftKey ? 5 : 1)));
        case 'ArrowRight': return run(() => d && st.setCursor(d.cursor + d.audio.sampleRate * useSettings.getState().skipSeconds * (e.shiftKey ? 5 : 1)));
        case ']': return run(() => st.jumpMarker(1));
        case '[': return run(() => st.jumpMarker(-1));
      }
      if (k === 'r') return run(() => void useRecording.getState().start('auto'));
      if (k === 'l') return run(() => st.setLoop(!st.loop));
      if (k === 'm') return run(st.addMarker);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const doc = useEditor((s) => s.active());
  const multitrack = useSettings((s) => s.multitrack);
  const sidebarPref = useSettings((s) => s.showSidePanel);
  const [sidebar, setSidebarState] = useState(() => sidebarPref && window.innerWidth > 1100);
  const setSidebar = (v: boolean | ((p: boolean) => boolean)) => {
    setSidebarState((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      useSettings.getState().set({ showSidePanel: next });
      return next;
    });
  };
  useEffect(() => { setSidebarState(sidebarPref && (window.innerWidth > 1100 || sidebar)); }, [sidebarPref]); // eslint-disable-line react-hooks/exhaustive-deps
  const recStatus = useRecording((s) => s.status);
  const recDocId = useRecording((s) => s.docId);
  const recDest = useRecording((s) => s.dest);
  const showLive = (recStatus === 'recording' || recStatus === 'paused' || recStatus === 'saving') && (recDest === 'track' ? multitrack : !multitrack && (recDocId === doc?.id || recDocId === null));
  useEffect(() => { player.setVolume(useSettings.getState().masterVolume); }, []);
  const [dragOver, setDragOver] = useState(false);
  useShortcuts();

  // restore the previous session and keep everything autosaved
  useEffect(() => {
    if (autosaveStarted) return;
    autosaveStarted = true;
    void startAutosave();
  }, []);

  // everything is autosaved; only hold the page if a write is still in flight
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      flushNow();
      if (!isElectron() && hasPendingWrites()) { e.preventDefault(); e.returnValue = ''; }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  // stop audio if the tab is hidden on mobile
  useEffect(() => {
    const h = () => { if (document.hidden && /Android|iPhone|iPad/i.test(navigator.userAgent)) player.stop(); };
    document.addEventListener('visibilitychange', h);
    return () => document.removeEventListener('visibilitychange', h);
  }, []);

  // open files passed by OS "Open with…" (PWA file handling)
  useEffect(() => {
    const lq = (window as unknown as { launchQueue?: { setConsumer: (fn: (p: { files: FileSystemFileHandle[] }) => void) => void } }).launchQueue;
    lq?.setConsumer(async (params) => {
      const files = await Promise.all(params.files.map((h) => h.getFile()));
      if (files.length) void useEditor.getState().openFiles(files);
    });
  }, []);

  const openPicker = () => document.querySelector<HTMLInputElement>('[data-testid=file-input]')?.click();

  return (
    <div
      className="app"
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        if (e.dataTransfer.files.length) void useEditor.getState().openFiles(e.dataTransfer.files);
      }}
    >
      <Header onToggleSidebar={() => setSidebar((v) => !v)} />
      {!multitrack && <DocTabs />}
      <div className="workspace">
        <main className="editor" aria-label="Editor">
          {showLive ? (
            <LiveRecording />
          ) : multitrack ? (
            <MultiTrack />
          ) : doc ? (
            length(doc.audio) > 0 ? (
              <>
                <Overview doc={doc} />
                <Waveform doc={doc} />
              </>
            ) : (
              <div className="empty empty-doc">
                <h2>“{doc.name}” is empty</h2>
                <p>Record from your microphone, paste audio, or generate a tone to get started.</p>
                <div className="empty-actions">
                  <button className="btn btn-rec" onClick={() => void useRecording.getState().start('insert')} data-testid="empty-doc-record">Record</button>
                  <button className="btn btn-secondary" onClick={() => useEditor.getState().setDialog({ type: 'generate', kind: 'tone' })}>Generate</button>
                  <button className="btn btn-secondary" disabled={!useEditor.getState().clipboard} onClick={() => useEditor.getState().paste()}>Paste</button>
                </div>
              </div>
            )
          ) : (
            <EmptyState onOpen={openPicker} />
          )}
        </main>
        {sidebar && !multitrack && <div className="sb-scrim" onClick={() => setSidebar(false)} aria-hidden />}
        <Sidebar open={sidebar && !multitrack} onClose={() => setSidebar(false)} />
      </div>
      <Transport />
      <Dialogs />
      <Toasts />
      {dragOver && (
        <div className="drop-overlay" aria-hidden>
          <Upload size={40} />
          <p>Drop audio files to open</p>
        </div>
      )}
    </div>
  );
}
