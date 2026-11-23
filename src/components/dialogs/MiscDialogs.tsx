import { useEffect, useState } from 'react';
import { FilePlus2, Keyboard, Library, Trash2, FolderOpen, Layers, Info, Upload } from 'lucide-react';
import { Modal } from './Modal';
import { useEditor, decodeFile } from '../../store/editor';
import { createSilence } from '../../audio/buffer';
import { listLibrary, loadFromLibrary, deleteFromLibrary, LibraryItem } from '../../audio/library';
import { formatTime, modKey } from '../../app/format';
import { EFFECTS, EFFECTS_BY_ID, defaultParams } from '../../audio/effects';
import { renderExport, ExportOptions } from './ExportDialog';
import { saveFile } from '../../app/platform';

const close = () => useEditor.getState().setDialog(null);

export function NewDialog() {
  const [rate, setRate] = useState(48000);
  const [ch, setCh] = useState(2);
  const [name, setName] = useState('Untitled');
  return (
    <Modal
      title="New file"
      onClose={close}
      icon={<FilePlus2 size={18} />}
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={close}>Cancel</button>
          <button className="btn btn-primary" data-testid="new-create" onClick={() => { useEditor.getState().newDoc(name || 'Untitled', createSilence(rate, ch, 0)); close(); }}>
            Create
          </button>
        </>
      }
    >
      <div className="params">
        <label className="field">
          <span className="field-label">Name</span>
          <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Sample rate</span>
            <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
              {[8000, 16000, 22050, 44100, 48000, 96000].map((r) => <option key={r} value={r}>{r} Hz</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Channels</span>
            <select value={ch} onChange={(e) => setCh(Number(e.target.value))}>
              <option value={1}>Mono</option>
              <option value={2}>Stereo</option>
            </select>
          </label>
        </div>
      </div>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['Space', 'Play / pause'],
  ['R', 'Record'],
  ['Home / End', 'Go to start / end'],
  ['L', 'Toggle loop'],
  [`${modKey}+Z`, 'Undo'],
  [`${modKey}+Shift+Z / ${modKey}+Y`, 'Redo'],
  [`${modKey}+X / C / V`, 'Cut / copy / paste'],
  [`${modKey}+Shift+V`, 'Mix paste (overlay)'],
  ['Delete / Backspace', 'Delete selection'],
  [`${modKey}+T`, 'Trim to selection'],
  [`${modKey}+A`, 'Select all'],
  ['Esc', 'Clear selection'],
  [`${modKey}+O`, 'Open files'],
  [`${modKey}+N`, 'New file'],
  [`${modKey}+S`, 'Save to library'],
  [`${modKey}+E`, 'Export'],
  ['+ / −', 'Zoom in / out'],
  ['0', 'Zoom to fit'],
  ['M', 'Add marker'],
  ['?', 'Show shortcuts'],
];

export function ShortcutsDialog() {
  return (
    <Modal title="Keyboard shortcuts" onClose={close} icon={<Keyboard size={18} />} wide>
      <dl className="shortcuts">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k}>
            <dt>{k.split(' / ').map((p, i) => <span key={i}>{i > 0 && ' / '}<kbd>{p}</kbd></span>)}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

export function LibraryDialog() {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => listLibrary().then(setItems).catch((e) => setErr(String(e?.message ?? e)));
  useEffect(() => { refresh(); }, []);
  return (
    <Modal title="Library" subtitle="Recordings and projects saved on this device." onClose={close} icon={<Library size={18} />} wide>
      {err && <div className="alert">{err}</div>}
      {items === null ? (
        <p className="muted">Loading…</p>
      ) : items.length === 0 ? (
        <div className="empty-mini">
          <Library size={28} />
          <p>Your library is empty. Recordings are saved here automatically, and you can save any file with {modKey}+S.</p>
        </div>
      ) : (
        <ul className="lib-list">
          {items.map((it) => (
            <li key={it.id}>
              <div className="lib-meta">
                <strong>{it.name}</strong>
                <span>{formatTime(it.duration, false)} · {it.sampleRate / 1000} kHz · {it.numChannels === 1 ? 'mono' : 'stereo'} · {new Date(it.updatedAt).toLocaleString()}</span>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={async () => {
                const a = await loadFromLibrary(it.id);
                if (a) {
                  const st = useEditor.getState();
                  const existing = st.docs.find((d) => d.id === it.id);
                  if (existing) st.setActive(it.id);
                  else {
                    const id = st.newDoc(it.name, a);
                    // keep library identity so re-saves overwrite
                    useEditor.setState((s) => ({ docs: s.docs.map((d) => (d.id === id ? { ...d, id: it.id } : d)), activeId: it.id }));
                  }
                  close();
                }
              }}>
                <FolderOpen size={14} /> Open
              </button>
              <button className="icon-btn" aria-label={`Delete ${it.name}`} onClick={async () => {
                if (!confirm(`Delete “${it.name}” from your library? This cannot be undone.`)) return;
                await deleteFromLibrary(it.id);
                refresh();
              }}>
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function BatchDialog() {
  const [files, setFiles] = useState<File[]>([]);
  const [effect, setEffect] = useState('normalize');
  const [fmt, setFmt] = useState<ExportOptions['format']>('mp3');
  const [progress, setProgress] = useState<string | null>(null);
  const run = async () => {
    const st = useEditor.getState();
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setProgress(`Processing ${i + 1} of ${files.length}: ${f.name}`);
      try {
        let a = await decodeFile(f);
        if (effect !== 'none') a = EFFECTS_BY_ID[effect].apply(a, defaultParams(EFFECTS_BY_ID[effect]));
        const { blob, ext } = renderExport(a, { format: fmt, bitDepth: 16, bitrate: 192, sampleRate: 'keep', channels: 'keep' });
        await saveFile(blob, `${f.name.replace(/\.[^.]+$/, '')}-vipad.${ext}`);
        ok++;
      } catch (e) {
        st.toast(`${f.name}: ${(e as Error).message}`, 'error');
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    setProgress(null);
    st.toast(`Batch finished: ${ok}/${files.length} files`, 'success');
    close();
  };
  return (
    <Modal
      title="Batch processor"
      subtitle="Apply one effect and convert many files at once."
      onClose={close}
      icon={<Layers size={18} />}
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={close}>Cancel</button>
          <button className="btn btn-primary" disabled={!files.length || !!progress} onClick={run}>Process {files.length || ''} files</button>
        </>
      }
    >
      <div className="params">
        <label className="dropzone">
          <Upload size={20} />
          <span>{files.length ? `${files.length} file(s) selected` : 'Choose audio files'}</span>
          <input type="file" accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm,.opus" multiple className="sr-only" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        </label>
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Effect (default settings)</span>
            <select value={effect} onChange={(e) => setEffect(e.target.value)}>
              <option value="none">None — convert only</option>
              {EFFECTS.filter((e) => !e.stereoOnly).map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Output format</span>
            <select value={fmt} onChange={(e) => setFmt(e.target.value as ExportOptions['format'])}>
              <option value="mp3">MP3 192 kbps</option>
              <option value="wav">WAV 16-bit</option>
            </select>
          </label>
        </div>
        {progress && <p className="muted" role="status">{progress}</p>}
      </div>
    </Modal>
  );
}

export function AboutDialog() {
  return (
    <Modal title="About Vipad" onClose={close} icon={<Info size={18} />}>
      <p>Vipad {__APP_VERSION__} — a fast, private audio recorder and editor. Everything runs on your device; your audio never leaves it.</p>
      <p className="muted">Formats: open WAV, MP3, OGG, FLAC, M4A/AAC, WebM, Opus (anything your system can decode). Export WAV (8/16/24/32-bit) and MP3 (64–320 kbps).</p>
      <p><a className="link" href="./" target="_blank" rel="noreferrer">Download Vipad for desktop &amp; mobile →</a></p>
    </Modal>
  );
}
