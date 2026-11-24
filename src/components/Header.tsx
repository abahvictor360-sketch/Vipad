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
import { MainMenu } from './MainMenu';
import { AutosaveBadge } from './Chrome';
import { useRecording } from '../store/recording';
import { pickAndInsertFile } from '../app/pickFile';
import { RecBadge } from './RecBadge';
import { MenuBar } from './MenuBar';
import { useSettings } from '../store/settings';

type Tab = 'home' | 'levels' | 'effects' | 'restore' | 'generate' | 'view' | 'tools';

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
  const follow = useSettings((s) => s.followPlayhead);
  const multitrack = useSettings((s) => s.multitrack);
  const showMenuBar = useSettings((s) => s.showMenuBar);
  const showRibbon = useSettings((s) => s.showRibbon);
  const noiseProfile = useEditor((s) => s.noiseProfile);
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
    levels: [
      {
        title: 'Levels',
        items: [
          { label: 'Amplify', icon: <Volume2 size={18} />, onClick: fx('amplify'), disabled: !hasAudio },
          { label: 'Normalize', icon: <BarChart3 size={18} />, onClick: fx('normalize'), disabled: !hasAudio },
          { label: 'Loudness', icon: <BarChart3 size={18} />, onClick: fx('loudnorm'), disabled: !hasAudio, title: 'Loudness Normalize (LUFS)', testId: 'fx-loudnorm' },
          { label: 'Ramp', icon: <TrendingUp size={18} />, onClick: fx('envelope'), disabled: !hasAudio, title: 'Volume ramp' },
          { label: 'Fade In', icon: <TrendingUp size={18} />, onClick: fx('fadeIn'), disabled: !hasAudio },
          { label: 'Fade Out', icon: <TrendingDown size={18} />, onClick: fx('fadeOut'), disabled: !hasAudio },
        ],
      },
      {
        title: 'Dynamics',
        items: [
          { label: 'Compressor', icon: <Activity size={18} />, onClick: fx('compressor'), disabled: !hasAudio },
          { label: 'Limiter', icon: <Activity size={18} />, onClick: fx('limiter'), disabled: !hasAudio },
          { label: 'Noise Gate', icon: <Split size={18} />, onClick: fx('gate'), disabled: !hasAudio },
        ],
      },
    ],
    restore: [
      {
        title: 'Noise reduction',
        items: [
          { label: 'Grab Noise', icon: <ScanSearch size={18} />, onClick: st.grabNoiseSample, disabled: !hasSel, title: 'Grab Noise Sample — select a noise-only section first', testId: 'rb-grab-noise' },
          { label: 'From Sample', icon: <Sparkles size={18} />, onClick: fx('denoiseSample'), disabled: !hasAudio || !noiseProfile, title: 'Apply Subtraction from Noise Sample', testId: 'rb-apply-noise' },
          { label: 'Auto Spectral', icon: <Sparkles size={18} />, onClick: fx('denoise'), disabled: !hasAudio, title: 'Auto Spectral Subtraction' },
          { label: 'Multi-band Gate', icon: <Split size={18} />, onClick: fx('mbgate'), disabled: !hasAudio },
        ],
      },
      {
        title: 'Repair',
        items: [
          { label: 'Click/Pop Auto', icon: <Eraser size={18} />, onClick: fx('declick'), disabled: !hasAudio },
          { label: 'Click/Pop Manual', icon: <Eraser size={18} />, onClick: fx('interpolate'), disabled: !hasSel, title: 'Select a tiny region around the click first' },
          { label: 'Hum', icon: <Eraser size={18} />, onClick: fx('notch'), disabled: !hasAudio },
          { label: 'DC Offset', icon: <AudioLines size={18} />, onClick: fx('dc'), disabled: !hasAudio },
          { label: 'De-clip', icon: <Activity size={18} />, onClick: fx('declip'), disabled: !hasAudio },
          { label: 'De-ess', icon: <Wind size={18} />, onClick: fx('deess'), disabled: !hasAudio },
          { label: 'Shorten Pauses', icon: <Scissors size={18} />, onClick: fx('removeSilence'), disabled: !hasAudio, title: 'Remove silence / shorten long pauses' },
        ],
      },
      {
        title: 'Filters',
        items: [
          { label: 'High Pass', icon: <Wind size={18} />, onClick: fx('highpass'), disabled: !hasAudio },
          { label: 'Low Pass', icon: <Wind size={18} />, onClick: fx('lowpass'), disabled: !hasAudio },
          { label: 'Trim Silence', icon: <Crop size={18} />, onClick: fx('trimSilence'), disabled: !hasAudio },
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
          { label: 'Flanger', icon: <Waves size={18} />, onClick: fx('flanger'), disabled: !hasAudio },
          { label: 'Phaser', icon: <Waves size={18} />, onClick: fx('phaser'), disabled: !hasAudio },
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
        items: [
          { label: 'Record', icon: <Circle size={18} />, onClick: () => void useRecording.getState().start('auto') },
          { label: 'Options', icon: <SlidersHorizontal size={18} />, onClick: () => st.setDialog({ type: 'record' }), title: 'Record options: microphone, channels, destination' },
        ],
      },
    ],
    view: [
      {
        title: 'Zoom',
        items: [
          { label: doc?.view === 'spectral' ? 'Waveform' : 'Spectrogram', icon: doc?.view === 'spectral' ? <AudioLines size={18} /> : <BarChart3 size={18} />, onClick: () => st.setView(doc?.view === 'spectral' ? 'wave' : 'spectral'), disabled: !hasAudio, title: 'Switch between waveform and spectrogram (frequency) view', testId: 'rb-spectrogram' },
          { label: 'Amp +', icon: <ZoomIn size={18} />, onClick: () => st.setAmpZoom(st.ampZoom * 2), disabled: !hasAudio, title: 'Vertical (amplitude) zoom in — Alt+wheel' },
          { label: 'Amp −', icon: <ZoomOut size={18} />, onClick: () => st.setAmpZoom(st.ampZoom / 2), disabled: !hasAudio, title: 'Vertical zoom out' },
          { label: 'Zoom In', icon: <ZoomIn size={18} />, onClick: () => zoom(0.5), disabled: !hasAudio },
          { label: 'Zoom Out', icon: <ZoomOut size={18} />, onClick: () => zoom(2), disabled: !hasAudio },
          { label: 'Fit', icon: <Maximize2 size={18} />, onClick: () => zoom('fit'), disabled: !hasAudio },
          { label: 'Selection', icon: <ScanSearch size={18} />, onClick: () => zoom('selection'), disabled: !hasSel },
          { label: follow ? 'Follow: On' : 'Follow: Off', icon: <Activity size={18} />, onClick: () => useSettings.getState().set({ followPlayhead: !follow }), title: 'Auto-scroll with the playhead' },
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
        title: 'Split & join',
        items: [
          { label: 'Split Here', icon: <Split size={18} />, onClick: st.splitAtCursor, disabled: !hasAudio, title: 'Split the file at the cursor into two files', testId: 'rb-split-cursor' },
          { label: 'At Markers', icon: <Flag size={18} />, onClick: st.splitAtMarkers, disabled: !doc?.markers.length, title: 'Split into one file per marked region' },
          { label: 'By Silence', icon: <Scissors size={18} />, onClick: () => st.splitBySilence(), disabled: !hasAudio, title: 'Split wherever there is a pause', testId: 'rb-split-silence' },
          { label: 'Join All', icon: <Merge size={18} />, onClick: st.joinAll, disabled: useEditor.getState().docs.length < 2, title: 'Join all open files into one', testId: 'rb-join' },
          { label: 'Insert File', icon: <FilePlus2 size={18} />, onClick: pickAndInsertFile, disabled: !doc, title: 'Insert another audio file at the cursor' },
        ],
      },
      {
        title: 'Tools',
        items: [
          { label: 'Settings', icon: <SlidersHorizontal size={18} />, onClick: () => st.setDialog({ type: 'settings' }), testId: 'rb-settings' },
          { label: 'Analysis', icon: <BarChart3 size={18} />, onClick: () => st.setDialog({ type: 'analysis' }), disabled: !hasAudio, title: 'Frequency & loudness analysis', testId: 'rb-analysis' },
          { label: 'Batch', icon: <Layers size={18} />, onClick: () => st.setDialog({ type: 'batch' }) },
          { label: 'Library', icon: <Library size={18} />, onClick: () => st.setDialog({ type: 'library' }) },
          { label: 'Shortcuts', icon: <Keyboard size={18} />, onClick: () => st.setDialog({ type: 'shortcuts' }) },
          { label: 'About', icon: <Info size={18} />, onClick: () => st.setDialog({ type: 'about' }) },
        ],
      },
    ],
  };

  const TABS: [Tab, string][] = [['home', 'Home'], ['levels', 'Levels'], ['effects', 'Effects'], ['restore', 'Restore'], ['generate', 'Generate'], ['view', 'View'], ['tools', 'Tools']];

  return (
    <header className="app-header">
      {showMenuBar && <MenuBar />}
      <div className="topbar">
        <MainMenu />
        <a className="brand" href="./" title="Vipad home">
          <Logo size={28} />
          <span>Vipad</span>
        </a>
        {multitrack ? <div className="tabs mt-title">Multitrack</div> : <nav className="tabs" role="tablist" aria-label="Toolbar sections">
          {TABS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => setTab(id)} data-testid={`tab-${id}`}>
              {label}
            </button>
          ))}
        </nav>}
        <div className="topbar-actions">
          <AutosaveBadge />
          <label className="mt-switch" title="Turn multitrack mode on or off">
            <span className="hide-sm">Multitrack</span>
            <input type="checkbox" role="switch" aria-label="Multitrack mode" checked={multitrack} onChange={(e) => useSettings.getState().set({ multitrack: e.target.checked })} data-testid="multitrack-toggle" />
          </label>
          <RecBadge />
          <button className="btn btn-primary btn-sm" disabled={!hasAudio} onClick={() => st.setDialog({ type: 'export' })}>
            <Download size={15} /> <span className="hide-sm">Export</span>
          </button>
          <button className="icon-btn" aria-label="Show or hide the Effects, Info and Markers panel" title="Show / hide side panel" onClick={onToggleSidebar} data-testid="toggle-panel">
            <PanelRight size={18} />
          </button>
        </div>
      </div>
      {!multitrack && showRibbon && (
        <div className="ribbon" role="toolbar" aria-label={`${tab} tools`}>
          {groups[tab].map((g) => <Group key={g.title} {...g} />)}
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/*,.wav,.mp3,.ogg,.oga,.flac,.m4a,.aac,.webm,.opus,.aif,.aiff,.aifc,.au,.snd,.caf,.mp4,.wma"
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
