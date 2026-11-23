import { X, CheckCircle2, AlertTriangle, Info, Mic, FolderOpen, AudioLines, Loader2 } from 'lucide-react';
import { useEditor } from '../store/editor';
import { Logo } from './Logo';

export function DocTabs() {
  const docs = useEditor((s) => s.docs);
  const activeId = useEditor((s) => s.activeId);
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
            if (d.dirty && !confirm(`Close “${d.name}”? Unsaved changes will be lost (save it to your library first with Save).`)) return;
            st.closeDoc(d.id);
          }}>
            <X size={13} />
          </button>
        </div>
      ))}
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
        <button className="big-action primary" onClick={() => st.setDialog({ type: 'record' })} data-testid="empty-record">
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
    </div>
  );
}
