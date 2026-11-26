import { X, CheckCircle2, AlertTriangle, Info, Mic, FolderOpen, AudioLines, Loader2 } from 'lucide-react';
import { useEditor } from '../store/editor';
import { Logo } from './Logo';
import { useSettings } from '../store/settings';
import { useRecording, newRecordingTab } from '../store/recording';
import { Plus } from 'lucide-react';
import { useAutosave } from '../app/autosave';
import { Cloud, CloudOff, RefreshCw } from 'lucide-react';

export function AutosaveBadge() {
  const { status } = useAutosave();
  const label = status === 'saving' ? 'Saving…' : status === 'error' ? 'Autosave failed' : 'All changes saved on this device';
  return (
    <span className={`autosave autosave-${status}`} title={label} aria-live="polite" data-testid="autosave" data-status={status}>
      {status === 'saving' ? <RefreshCw size={14} className="spin" /> : status === 'error' ? <CloudOff size={14} /> : <Cloud size={14} />}
      <span className="hide-sm">{status === 'saving' ? 'Saving…' : status === 'error' ? 'Not saved' : 'Saved'}</span>
    </span>
  );
}

export function DocTabs() {
  const docs = useEditor((s) => s.docs);
  const activeId = useEditor((s) => s.activeId);
  useRecording((s) => s.status);
  const st = useEditor.getState();
  if (!docs.length) return null;
  return (
    <div className="doc-tabs" role="tablist" aria-label="Open files">
      {docs.map((d) => (
        <div key={d.id} className={`doc-tab ${d.id === activeId ? 'on' : ''}`} role="tab" aria-selected={d.id === activeId}>
          <button className="doc-tab-name" onClick={() => st.setActive(d.id)} onDoubleClick={() => {
            const n = prompt('Rename file', d.name);
            if (n) st.renameDoc(d.id, n);
          }} title={`${d.name} (double-click to rename)`}>
            {d.dirty && <span className="dirty-dot" aria-label="unsaved changes" />}
            {d.name}
          </button>
          <button className="doc-tab-x" aria-label={`Close ${d.name}`} onClick={() => {
            if (d.dirty && useSettings.getState().confirmClose && !confirm(`Close “${d.name}”?\n\nIt stays recoverable for 30 days in Library → Recently closed.`)) return;
            st.closeDoc(d.id);
          }}>
            <X size={13} />
          </button>
        </div>
      ))}
      <button
        className="doc-tab-add"
        aria-label="New tab for a new recording"
        title="New tab — ready for a new recording"
        data-testid="new-tab"
        disabled={useRecording.getState().status !== 'idle'}
        onClick={() => newRecordingTab()}
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const busy = useEditor((s) => s.busy);
  return (
    <div className="toasts" aria-live="polite" role="status">
      {busy && (
        <div className="toast toast-busy" data-testid="busy">
          <Loader2 size={16} className="spin" /> {busy}
        </div>
      )}
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => useEditor.getState().dismissToast(t.id)}>
          {t.kind === 'success' ? <CheckCircle2 size={16} /> : t.kind === 'error' ? <AlertTriangle size={16} /> : <Info size={16} />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ onOpen }: { onOpen: () => void }) {
  const st = useEditor.getState();
  return (
    <div className="empty">
      <div className="empty-glow" aria-hidden />
      <Logo size={56} />
      <h1>Record, edit &amp; perfect your audio.</h1>
      <p>Drop audio files anywhere, or start a new recording. Everything stays on your device.</p>
      <div className="empty-actions">
        <button className="big-action primary" onClick={() => void useRecording.getState().start('new')} data-testid="empty-record">
          <Mic size={26} />
          <strong>Record</strong>
          <span>Capture from your microphone</span>
        </button>
        <button className="big-action" onClick={onOpen} data-testid="empty-open">
          <FolderOpen size={26} />
          <strong>Open files</strong>
          <span>WAV, MP3, OGG, FLAC, M4A…</span>
        </button>
        <button className="big-action" onClick={() => st.setDialog({ type: 'generate', kind: 'tone' })} data-testid="empty-generate">
          <AudioLines size={26} />
          <strong>Generate</strong>
          <span>Tones, noise &amp; DTMF</span>
        </button>
      </div>
      <button className="link-btn" onClick={() => st.setDialog({ type: 'library' })}>Open from library</button>
      <p className="empty-credit" data-testid="empty-credit">Developed by <strong>Victor Abah</strong></p>
    </div>
  );
}
