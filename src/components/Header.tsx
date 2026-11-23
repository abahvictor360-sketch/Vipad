import { useRef, useState } from 'react';
import {
  FilePlus2, FolderOpen, Save, Download, Undo2, Redo2, Scissors, Copy, ClipboardPaste, Trash2, Crop, VolumeX, TextSelect,
  Layers, Circle, Volume2, BarChart3, Sparkles, TrendingUp, TrendingDown, Waves, Repeat2, Wind, SlidersHorizontal, Gauge, Music2,
  AudioLines, Radio, Activity, Hash, PanelRight, Keyboard, Library, Info, ZoomIn, ZoomOut, Maximize2, ScanSearch, Flag, Merge,
  Split, Eraser, MoreHorizontal,
} from 'lucide-react';
import { useEditor } from '../store/editor';
import { Logo } from './Logo';
import { zoom } from './Transport';
import { convertChannels } from '../audio/effects';
import { modKey } from '../app/format';

type Tab = 'home' | 'effects' | 'generate' | 'view' | 'tools';

interface Btn { label: string; icon: React.ReactNode; onClick: () => void; title?: string; disabled?: boolean; testId?: string }

function Group({ title, items }: { title: string; items: Btn[] }) {
  return (
    <div className="rb-group" role="group" aria-label={title}>
      <div className="rb-items">
        {items.map((b) => (
          <button key={b.label} className="rb-btn" onClick={b.onClick} title={b.title ?? b.label} disabled={b.disabled} data-testid={b.testId}>
            {b.icon}
            <span>{b.label}</span>
          </button>
        ))}
      </div>
      <div className="rb-title">{title}</div>
    </div>
  );
}

export function Header({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const [tab, setTab] = useState<Tab>('home');
  const fileRef = useRef<HTMLInputElement>(null);
  const doc = useEditor((s) => s.active());
  const clipboard = useEditor((s) => s.clipboard);
  const follow = useEditor((s) => s.followPlayhead);
  useEditor((s) => s.docs); // re-render when history changes
  const st = useEditor.getState();
  const hasSel = !!doc?.selection;
  const hasAudio = !!doc && doc.audio.channels[0].length > 0;
  const fx = (id: string) => () => st.setDialog({ type: 'effect', effectId: id });

  const groups: Record<Tab, { title: string; items: Btn[] }[]> = {
    home: [
      {
        title: 'File',
        items: [
          { label: 'New', icon: <FilePlus2 size={18} />, onClick: () => st.setDialog({ type: 'new' }), title: `New (${modKey}+N)` },
          { label: 'Open', icon: <FolderOpen size={18} />, onClick: () => fileRef.current?.click(), title: `Open (${modKey}+O)`, testId: 'open' },
          { label: 'Save', icon: <Save size={18} />, onClick: () => void st.saveActiveToLibrary(), disabled: !doc, title: `Save to library (${modKey}+S)` },
          { label: 'Export', icon: <Download size={18} />, onClick: () => st.setDialog({ type: 'export' }), disabled: !hasAudio, title: `Export (${modKey}+E)`, testId: 'export' },
        ],
      },
      {
        title: 'History',
        items: [
          { label: 'Undo', icon: <Undo2 size={18} />, onClick: st.undo, disabled: !doc?.history.canUndo, title: `Undo ${doc?.history.undoLabel ?? ''} (${modKey}+Z)`, testId: 'undo' },
          { label: 'Redo', icon: <Redo2 size={18} />, onClick: st.redo, disabled: !doc?.history.canRedo, title: `Redo ${doc?.history.redoLabel ?? ''} (${modKey}+Shift+Z)`, testId: 'redo' },
        ],
      },
      {
        title: 'Edit',
        items: [
          { label: 'Cut', icon: <Scissors size={18} />, onClick: st.cut, disabled: !hasSel, testId: 'cut' },
          { label: 'Copy', icon: <Copy size={18} />, onClick: st.copy, disabled: !hasSel, testId: 'copy' },
          { label: 'Paste', icon: <ClipboardPaste size={18} />, onClick: () => st.paste(), disabled: !clipboard || !doc, testId: 'paste' },
          { label: 'Mix Paste', icon: <Merge size={18} />, onClick: () => st.paste(true), disabled: !clipboard || !doc, title: 'Overlay clipboard onto audio' },
          { label: 'Delete', icon: <Trash2 size={18} />, onClick: st.deleteSel, disabled: !hasSel, testId: 'delete' },
          { label: 'Trim', icon: <Crop size={18} />, onClick: st.trim, disabled: !hasSel, title: 'Keep only the selection', testId: 'trim' },
          { label: 'Silence', icon: <VolumeX size={18} />, onClick: st.silence, disabled: !hasSel, testId: 'silence' },
          { label: 'Select All', icon: <TextSelect size={18} />, onClick: st.selectAll, disabled: !hasAudio, testId: 'select-all' },
        ],
      },
      {
        title: 'Quick effects',
        items: [
          { label: 'Amplify', icon: <Volume2 size={18} />, onClick: fx('amplify'), disabled: !hasAudio, testId: 'fx-amplify' },
          { label: 'Normalize', icon: <BarChart3 size={18} />, onClick: fx('normalize'), disabled: !hasAudio, testId: 'fx-normalize' },
          { label: 'Fade In', icon: <TrendingUp size={18} />, onClick: fx('fadeIn'), disabled: !hasAudio },
          { label: 'Fade Out', icon: <TrendingDown size={18} />, onClick: fx('fadeOut'), disabled: !hasAudio },
          { label: 'Clean Up', icon: <Sparkles size={18} />, onClick: fx('denoise'), disabled: !hasAudio, title: 'Noise reduction' },
        ],
      },
    ],
    effects: [
      {
        title: 'Volume & dynamics',
        items: [
          { label: 'Amplify', icon: <Volume2 size={18} />, onClick: fx('amplify'), disabled: !hasAudio },
          { label: 'Normalize', icon: <BarChart3 size={18} />, onClick: fx('normalize'), disabled: !hasAudio },
          { label: 'Compressor', icon: <Activity size={18} />, onClick: fx('compressor'), disabled: !hasAudio },
          { label: 'Limiter', icon: <Activity size={18} />, onClick: fx('limiter'), disabled: !hasAudio },
          { label: 'Noise Gate', icon: <Split size={18} />, onClick: fx('gate'), disabled: !hasAudio },
        ],
      },
      {
        title: 'EQ & filters',
        items: [
          { label: 'Equalizer', icon: <SlidersHorizontal size={18} />, onClick: fx('eq'), disabled: !hasAudio, testId: 'fx-eq' },
          { label: 'Bass', icon: <Waves size={18} />, onClick: fx('bass'), disabled: !hasAudio },
          { label: 'Treble', icon: <AudioLines size={18} />, onClick: fx('treble'), disabled: !hasAudio },
          { label: 'High-Pass', icon: <Wind size={18} />, onClick: fx('highpass'), disabled: !hasAudio },
        ],
      },
      {
        title: 'Time & pitch',
        items: [
          { label: 'Speed', icon: <Gauge size={18} />, onClick: fx('speed'), disabled: !hasAudio },
          { label: 'Tempo', icon: <Gauge size={18} />, onClick: fx('tempo'), disabled: !hasAudio },
          { label: 'Pitch', icon: <Music2 size={18} />, onClick: fx('pitch'), disabled: !hasAudio },
          { label: 'Reverse', icon: <Repeat2 size={18} />, onClick: fx('reverse'), disabled: !hasAudio, testId: 'fx-reverse' },
        ],
      },
      {
        title: 'Space & colour',
        items: [
          { label: 'Echo', icon: <Radio size={18} />, onClick: fx('echo'), disabled: !hasAudio },
          { label: 'Reverb', icon: <Waves size={18} />, onClick: fx('reverb'), disabled: !hasAudio },
          { label: 'Chorus', icon: <AudioLines size={18} />, onClick: fx('chorus'), disabled: !hasAudio },
          { label: 'Distortion', icon: <Activity size={18} />, onClick: fx('distortion'), disabled: !hasAudio },
        ],
      },
      {
        title: 'Restore',
        items: [
          { label: 'Noise Reduce', icon: <Sparkles size={18} />, onClick: fx('denoise'), disabled: !hasAudio },
          { label: 'Hum', icon: <Eraser size={18} />, onClick: fx('notch'), disabled: !hasAudio },
          { label: 'De-click', icon: <Eraser size={18} />, onClick: fx('declick'), disabled: !hasAudio },
          { label: 'More…', icon: <MoreHorizontal size={18} />, onClick: onToggleSidebar },
        ],
      },
    ],
    generate: [
      {
        title: 'Generate',
        items: [
          { label: 'Tone', icon: <AudioLines size={18} />, onClick: () => st.setDialog({ type: 'generate', kind: 'tone' }), testId: 'gen-tone' },
          { label: 'Noise', icon: <Wind size={18} />, onClick: () => st.setDialog({ type: 'generate', kind: 'noise' }) },
          { label: 'Silence', icon: <VolumeX size={18} />, onClick: () => st.setDialog({ type: 'generate', kind: 'silence' }), disabled: !doc },
          { label: 'DTMF', icon: <Hash size={18} />, onClick: () => st.setDialog({ type: 'generate', kind: 'dtmf' }) },
        ],
      },
      {
        title: 'Record',
        items: [{ label: 'Record', icon: <Circle size={18} />, onClick: () => st.setDialog({ type: 'record' }) }],
      },
    ],
    view: [
      {
        title: 'Zoom',
        items: [
          { label: 'Zoom In', icon: <ZoomIn size={18} />, onClick: () => zoom(0.5), disabled: !hasAudio },
          { label: 'Zoom Out', icon: <ZoomOut size={18} />, onClick: () => zoom(2), disabled: !hasAudio },
          { label: 'Fit', icon: <Maximize2 size={18} />, onClick: () => zoom('fit'), disabled: !hasAudio },
          { label: 'Selection', icon: <ScanSearch size={18} />, onClick: () => zoom('selection'), disabled: !hasSel },
          { label: follow ? 'Follow: On' : 'Follow: Off', icon: <Activity size={18} />, onClick: () => st.setFollow(!follow), title: 'Auto-scroll with the playhead' },
        ],
      },
      {
        title: 'Markers',
        items: [{ label: 'Add Marker', icon: <Flag size={18} />, onClick: st.addMarker, disabled: !doc, title: 'Add marker at cursor (M)' }],
      },
      {
        title: 'Channels',
        items: [
          { label: 'To Mono', icon: <AudioLines size={18} />, onClick: () => st.convertDoc('Convert to mono', (a) => convertChannels(a, 1)), disabled: !doc || doc.audio.channels.length === 1 },
          { label: 'To Stereo', icon: <Waves size={18} />, onClick: () => st.convertDoc('Convert to stereo', (a) => convertChannels(a, 2)), disabled: !doc || doc.audio.channels.length === 2 },
          { label: 'Panels', icon: <PanelRight size={18} />, onClick: onToggleSidebar },
        ],
      },
    ],
    tools: [
      {
        title: 'Tools',
        items: [
          { label: 'Batch', icon: <Layers size={18} />, onClick: () => st.setDialog({ type: 'batch' }) },
          { label: 'Library', icon: <Library size={18} />, onClick: () => st.setDialog({ type: 'library' }) },
          { label: 'Shortcuts', icon: <Keyboard size={18} />, onClick: () => st.setDialog({ type: 'shortcuts' }) },
          { label: 'About', icon: <Info size={18} />, onClick: () => st.setDialog({ type: 'about' }) },
        ],
      },
    ],
  };

  const TABS: [Tab, string][] = [['home', 'Home'], ['effects', 'Effects'], ['generate', 'Generate'], ['view', 'View'], ['tools', 'Tools']];

  return (
    <header className="app-header">
      <div className="topbar">
        <a className="brand" href="./" title="Vipad home">
          <Logo size={28} />
          <span>Vipad</span>
        </a>
        <nav className="tabs" role="tablist" aria-label="Toolbar sections">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} data-testid={`tab-${id}`}>
              {label}
            </button>
          ))}
        </nav>
        <div className="topbar-actions">
          <button className="btn btn-rec btn-sm" onClick={() => st.setDialog({ type: 'record' })}>
            <Circle size={12} fill="currentColor" /> <span className="hide-sm">Record</span>
          </button>
          <button className="btn btn-primary btn-sm" disabled={!hasAudio} onClick={() => st.setDialog({ type: 'export' })}>
            <Download size={15} /> <span className="hide-sm">Export</span>
          </button>
          <button className="icon-btn" aria-label="Toggle side panel" onClick={onToggleSidebar}>
            <PanelRight size={18} />
          </button>
        </div>
      </div>
      <div className="ribbon" role="toolbar" aria-label={`${tab} tools`}>
        {groups[tab].map((g) => <Group key={g.title} {...g} />)}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/*,.wav,.mp3,.ogg,.oga,.flac,.m4a,.aac,.webm,.opus,.aif,.aiff,.caf,.mp4"
        multiple
        className="sr-only"
        data-testid="file-input"
        onChange={(e) => {
          if (e.target.files?.length) void st.openFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </header>
  );
}
