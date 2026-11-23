import { useEffect, useRef, useState } from 'react';
import { Menu, ChevronRight, ChevronLeft } from 'lucide-react';
import { useEditor } from '../store/editor';
import { useSettings } from '../store/settings';
import { useMultitrack } from '../store/multitrack';
import { listLibrary, loadFromLibrary, LibraryItem } from '../audio/library';
import { EFFECTS, EFFECT_CATEGORIES } from '../audio/effects';
import { length } from '../audio/buffer';
import { modKey } from '../app/format';
import { zoom } from './Transport';
import { saveFile } from '../app/platform';
import { serializeProject, parseProject } from '../app/project';
import { convertChannels } from '../audio/effects';

type Item = { label: string; shortcut?: string; onClick?: () => void; disabled?: boolean; sub?: Item[]; testId?: string } | 'sep';

const uid = () => Math.random().toString(36).slice(2, 10);

async function openProject(file: File) {
  const ed = useEditor.getState();
  try {
    const p = parseProject(await file.text(), uid);
    for (const d of p.docs) ed.newDoc(d.name, d.audio);
    useMultitrack.getState().clear();
    useMultitrack.setState((s) => ({ session: p.session, version: s.version + 1 }));
    if (p.session.tracks.length) useSettings.getState().set({ multitrack: true });
    ed.toast(`Opened project ${file.name}`, 'success');
  } catch (e) {
    ed.toast(`Could not open project: ${(e as Error).message}`, 'error');
  }
}

async function saveProject() {
  const ed = useEditor.getState();
  const json = serializeProject(ed.docs.map((d) => ({ name: d.name, audio: d.audio })), useMultitrack.getState().session);
  const name = (ed.active()?.name ?? 'Vipad project').replace(/[\\/:*?"<>|]/g, '_');
  await saveFile(new Blob([json], { type: 'application/json' }), `${name}.vipad`);
  ed.toast('Project saved', 'success');
}

export function MainMenu() {
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState<string | null>('File');
  const [recent, setRecent] = useState<LibraryItem[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const projRef = useRef<HTMLInputElement>(null);
  const doc = useEditor((s) => s.active());
  const docs = useEditor((s) => s.docs);
  const clipboard = useEditor((s) => s.clipboard);
  const loop = useEditor((s) => s.loop);
  const noiseProfile = useEditor((s) => s.noiseProfile);
  const multitrack = useSettings((s) => s.multitrack);
  const ed = useEditor.getState();
  const hasAudio = !!doc && length(doc.audio) > 0;
  const hasSel = !!doc?.selection;
  const fx = (id: string) => () => ed.setDialog({ type: 'effect', effectId: id });

  useEffect(() => {
    if (!open) return;
    listLibrary().then((l) => setRecent(l.slice(0, 8))).catch(() => setRecent([]));
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const menus: Record<string, Item[]> = {
    File: [
      { label: 'New File…', shortcut: `${modKey}+N`, onClick: () => ed.setDialog({ type: 'new' }) },
      { label: 'Open File…', shortcut: `${modKey}+O`, onClick: () => document.querySelector<HTMLInputElement>('[data-testid=file-input]')?.click() },
      {
        label: 'Open Recent',
        sub: recent.length
          ? recent.map((r) => ({
              label: r.name,
              onClick: async () => {
                const a = await loadFromLibrary(r.id);
                if (a) ed.newDoc(r.name, a);
              },
            }))
          : [{ label: 'No recent files', disabled: true }],
      },
      'sep',
      { label: 'Save File', shortcut: `${modKey}+S`, onClick: () => void ed.saveActiveToLibrary(), disabled: !doc },
      { label: 'Save File As…', shortcut: `${modKey}+Shift+S`, onClick: () => { const n = prompt('Save as', doc?.name ?? 'Untitled'); if (n) void ed.saveAs(n); }, disabled: !doc },
      { label: 'Save All Files', onClick: () => void ed.saveAll(), disabled: !docs.length },
      { label: 'Close File', shortcut: `${modKey}+W`, onClick: () => doc && ed.closeDoc(doc.id), disabled: !doc },
      { label: 'Close All', onClick: () => ed.closeAll(), disabled: !docs.length },
      { label: 'Recently Closed (recover)…', onClick: () => ed.setDialog({ type: 'library' }) },
      'sep',
      { label: 'Open Project…', onClick: () => projRef.current?.click(), testId: 'menu-open-project' },
      { label: 'Save Project…', onClick: () => void saveProject(), disabled: !docs.length && !useMultitrack.getState().session.tracks.length },
      'sep',
      { label: 'Export Audio…', shortcut: `${modKey}+E`, onClick: () => ed.setDialog({ type: 'export' }), disabled: !hasAudio },
      { label: 'Batch Processor…', onClick: () => ed.setDialog({ type: 'batch' }) },
      { label: 'Library…', onClick: () => ed.setDialog({ type: 'library' }) },
    ],
    Edit: [
      { label: `Undo ${doc?.history.undoLabel ?? ''}`, shortcut: `${modKey}+Z`, onClick: ed.undo, disabled: !doc?.history.canUndo },
      { label: `Redo ${doc?.history.redoLabel ?? ''}`, shortcut: `${modKey}+Y`, onClick: ed.redo, disabled: !doc?.history.canRedo },
      'sep',
      { label: 'Cut', shortcut: `${modKey}+X`, onClick: ed.cut, disabled: !hasSel },
      { label: 'Copy', shortcut: `${modKey}+C`, onClick: ed.copy, disabled: !hasSel },
      { label: 'Paste', shortcut: `${modKey}+V`, onClick: () => ed.paste(), disabled: !clipboard || !doc },
      { label: 'Mix Paste', shortcut: `${modKey}+Shift+V`, onClick: () => ed.paste(true), disabled: !clipboard || !doc },
      { label: 'Delete', shortcut: 'Del', onClick: ed.deleteSel, disabled: !hasSel },
      { label: 'Trim to Selection', shortcut: `${modKey}+T`, onClick: ed.trim, disabled: !hasSel },
      { label: 'Silence Selection', onClick: ed.silence, disabled: !hasSel },
      { label: 'Insert Silence…', onClick: () => ed.setDialog({ type: 'generate', kind: 'silence' }), disabled: !doc },
      'sep',
      { label: 'Select All', shortcut: `${modKey}+A`, onClick: ed.selectAll, disabled: !hasAudio },
      { label: 'Select None', shortcut: 'Esc', onClick: () => ed.setSelection(null), disabled: !hasSel },
      'sep',
      { label: 'Convert to Mono', onClick: () => ed.convertDoc('Convert to mono', (a) => convertChannels(a, 1)), disabled: !doc || doc.audio.channels.length === 1 },
      { label: 'Convert to Stereo', onClick: () => ed.convertDoc('Convert to stereo', (a) => convertChannels(a, 2)), disabled: !doc || doc.audio.channels.length === 2 },
    ],
    Levels: [
      { label: 'Amplify…', onClick: fx('amplify'), disabled: !hasAudio },
      { label: 'Normalize…', onClick: fx('normalize'), disabled: !hasAudio },
      { label: 'Volume Ramp…', onClick: fx('envelope'), disabled: !hasAudio },
      { label: 'Fade In…', onClick: fx('fadeIn'), disabled: !hasAudio },
      { label: 'Fade Out…', onClick: fx('fadeOut'), disabled: !hasAudio },
      { label: 'Compressor…', onClick: fx('compressor'), disabled: !hasAudio },
      { label: 'Limiter…', onClick: fx('limiter'), disabled: !hasAudio },
    ],
    Effects: EFFECT_CATEGORIES.map((c) => ({
      label: c,
      sub: EFFECTS.filter((e) => e.category === c).map((e) => ({
        label: `${e.name}…`,
        onClick: fx(e.id),
        disabled: !hasAudio || (e.stereoOnly && doc!.audio.channels.length < 2) || (e.needsProfile && !noiseProfile),
      })),
    })),
    Restore: [
      { label: 'High Pass…', onClick: fx('highpass'), disabled: !hasAudio },
      { label: 'Low Pass…', onClick: fx('lowpass'), disabled: !hasAudio },
      { label: 'DC Offset Correction', onClick: fx('dc'), disabled: !hasAudio },
      { label: 'Multi-band Noise Gating…', onClick: fx('mbgate'), disabled: !hasAudio, testId: 'menu-mbgate' },
      { label: 'Auto Spectral Subtraction…', onClick: fx('denoise'), disabled: !hasAudio },
      { label: 'Grab Noise Sample', onClick: ed.grabNoiseSample, disabled: !hasSel, testId: 'menu-grab-noise' },
      { label: 'Apply Subtraction from Noise Sample…', onClick: fx('denoiseSample'), disabled: !hasAudio || !noiseProfile, testId: 'menu-apply-noise' },
      { label: 'Click/Pop Removal Auto…', onClick: fx('declick'), disabled: !hasAudio },
      { label: 'Click/Pop Removal Manual…', onClick: fx('interpolate'), disabled: !hasSel },
      { label: 'Hum Removal…', onClick: fx('notch'), disabled: !hasAudio },
      { label: 'Auto-Trim Silence…', onClick: fx('trimSilence'), disabled: !hasAudio },
    ],
    Control: [
      { label: 'Play / Pause', shortcut: 'Space', onClick: ed.togglePlay },
      { label: 'Stop', onClick: ed.stop },
      { label: 'Record…', shortcut: 'R', onClick: () => ed.setDialog({ type: 'record' }) },
      { label: loop ? '✓ Loop Playback' : 'Loop Playback', shortcut: 'L', onClick: () => ed.setLoop(!loop) },
      'sep',
      { label: 'Go to Start', shortcut: 'Home', onClick: () => ed.setCursor(0), disabled: !doc },
      { label: 'Go to End', shortcut: 'End', onClick: () => doc && ed.setCursor(length(doc.audio)), disabled: !doc },
    ],
    Generate: [
      { label: 'Tone…', onClick: () => ed.setDialog({ type: 'generate', kind: 'tone' }) },
      { label: 'Noise…', onClick: () => ed.setDialog({ type: 'generate', kind: 'noise' }) },
      { label: 'Silence…', onClick: () => ed.setDialog({ type: 'generate', kind: 'silence' }), disabled: !doc },
      { label: 'DTMF Tones…', onClick: () => ed.setDialog({ type: 'generate', kind: 'dtmf' }) },
    ],
    Bookmark: [
      { label: 'Add Bookmark at Cursor', shortcut: 'M', onClick: ed.addMarker, disabled: !doc },
      { label: 'Next Bookmark', shortcut: ']', onClick: () => ed.jumpMarker(1), disabled: !doc?.markers.length },
      { label: 'Previous Bookmark', shortcut: '[', onClick: () => ed.jumpMarker(-1), disabled: !doc?.markers.length },
      { label: 'Clear All Bookmarks', onClick: () => doc?.markers.forEach((m) => ed.removeMarker(m.id)), disabled: !doc?.markers.length },
    ],
    Region: [
      { label: 'Select Region Between Bookmarks', onClick: ed.selectBetweenMarkers, disabled: !doc },
      { label: 'Zoom to Selection', onClick: () => zoom('selection'), disabled: !hasSel },
      { label: 'Trim to Region', onClick: ed.trim, disabled: !hasSel },
    ],
    View: [
      { label: multitrack ? '✓ Multitrack Mode' : 'Multitrack Mode', onClick: () => useSettings.getState().set({ multitrack: !multitrack }), testId: 'menu-multitrack' },
      'sep',
      { label: 'Zoom In', shortcut: '+', onClick: () => zoom(0.5), disabled: !hasAudio },
      { label: 'Zoom Out', shortcut: '−', onClick: () => zoom(2), disabled: !hasAudio },
      { label: 'Zoom to Fit', shortcut: '0', onClick: () => zoom('fit'), disabled: !hasAudio },
    ],
    Tools: [
      { label: 'Settings…', shortcut: `${modKey}+,`, onClick: () => ed.setDialog({ type: 'settings' }), testId: 'menu-settings' },
      { label: 'Batch Processor…', onClick: () => ed.setDialog({ type: 'batch' }) },
      { label: 'Library…', onClick: () => ed.setDialog({ type: 'library' }) },
    ],
    Window: docs.length ? docs.map((d) => ({ label: `${d.id === doc?.id ? '✓ ' : ''}${d.name}`, onClick: () => { useSettings.getState().set({ multitrack: false }); ed.setActive(d.id); } })) : [{ label: 'No open files', disabled: true }],
    Help: [
      { label: 'Keyboard Shortcuts', shortcut: '?', onClick: () => ed.setDialog({ type: 'shortcuts' }) },
      { label: 'Download Desktop & Mobile Apps', onClick: () => window.open('./#download', '_blank') },
      { label: 'Report a Problem', onClick: () => window.open('https://github.com/abahvictor360-sketch/Vipad/issues', '_blank') },
      { label: 'About Vipad', onClick: () => ed.setDialog({ type: 'about' }) },
    ],
  };

  const run = (it: Exclude<Item, 'sep'>) => {
    if (it.disabled || !it.onClick) return;
    setOpen(false);
    it.onClick();
  };

  const [subOpen, setSubOpen] = useState<string | null>(null);
  const items = cat ? menus[cat] : [];

  return (
    <div className="mm" ref={ref}>
      <button className={`mm-btn ${open ? 'on' : ''}`} aria-label="Main menu" aria-expanded={open} aria-haspopup="menu" onClick={() => { setOpen((v) => !v); setCat(window.matchMedia('(max-width: 760px)').matches ? null : 'File'); setSubOpen(null); }} data-testid="main-menu">
        <Menu size={20} />
      </button>
      {open && (
        <div className={`mm-panel ${cat ? 'has-cat' : ''}`} role="menu">
          <ul className="mm-cats">
            {Object.keys(menus).map((k) => (
              <li key={k}>
                <button className={cat === k ? 'on' : ''} onMouseEnter={() => window.matchMedia('(hover: hover)').matches && (setCat(k), setSubOpen(null))} onClick={() => { setCat(k); setSubOpen(null); }} data-testid={`mm-${k}`}>
                  {k}
                  <ChevronRight size={15} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
          {cat && (
            <ul className="mm-items" aria-label={cat}>
              <li className="mm-back">
                <button onClick={() => setCat(null)}><ChevronLeft size={15} /> {cat}</button>
              </li>
              {items.map((it, i) =>
                it === 'sep' ? (
                  <li key={i} className="mm-sep" role="separator" />
                ) : it.sub ? (
                  <li key={it.label} className="mm-subwrap">
                    <button className={subOpen === it.label ? 'on' : ''} onClick={() => setSubOpen(subOpen === it.label ? null : it.label)} aria-expanded={subOpen === it.label}>
                      <span>{it.label}</span>
                      <ChevronRight size={14} className={subOpen === it.label ? 'rot' : ''} aria-hidden />
                    </button>
                    {subOpen === it.label && (
                      <ul className="mm-sub">
                        {it.sub.map((s) => s !== 'sep' && (
                          <li key={s.label}>
                            <button disabled={s.disabled} onClick={() => run(s)}><span>{s.label}</span></button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ) : (
                  <li key={it.label}>
                    <button role="menuitem" disabled={it.disabled} onClick={() => run(it)} data-testid={it.testId}>
                      <span>{it.label}</span>
                      {it.shortcut && <kbd>{it.shortcut}</kbd>}
                    </button>
                  </li>
                ),
              )}
            </ul>
          )}
        </div>
      )}
      <input ref={projRef} type="file" accept=".vipad,application/json" className="sr-only" data-testid="project-input" onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) void openProject(f);
      }} />
    </div>
  );
}
