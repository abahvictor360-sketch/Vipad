import { useEffect, useState } from 'react';
import { Play, Pause, Square, SkipBack, SkipForward, Repeat, Circle, ZoomIn, ZoomOut, Maximize2, Volume2, Gauge } from 'lucide-react';
import { useEditor, Doc } from '../store/editor';
import { player } from '../audio/player';
import { length } from '../audio/buffer';
import { formatTime, parseTime } from '../app/format';
import { LevelMeters } from './Meters';

function usePlayhead(doc: Doc | null) {
  const [pos, setPos] = useState(0);
  const [playing, setPlaying] = useState(player.playing);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setPos(player.position());
      if (player.playing) raf = requestAnimationFrame(loop);
    };
    const unsub = player.subscribe(() => {
      setPlaying(player.playing);
      cancelAnimationFrame(raf);
      loop();
    });
    return () => { unsub(); cancelAnimationFrame(raf); };
  }, []);
  const sr = doc?.audio.sampleRate ?? 1;
  return { playing, seconds: playing ? pos : (doc?.cursor ?? 0) / sr };
}

function TimeField({ label, value, onCommit, testId }: { label: string; value: number; onCommit: (s: number) => void; testId?: string }) {
  const [text, setText] = useState(formatTime(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setText(formatTime(value)); }, [value, editing]);
  return (
    <label className="time-field">
      <span>{label}</span>
      <input
        value={text}
        data-testid={testId}
        inputMode="decimal"
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          const s = parseTime(text);
          if (s !== null) onCommit(s);
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </label>
  );
}

export function zoom(factor: number | 'fit' | 'selection') {
  const st = useEditor.getState();
  const d = st.active();
  if (!d) return;
  const width = document.querySelector<HTMLElement>('.wave-wrap')?.clientWidth ?? 1000;
  const n = length(d.audio);
  const fit = n / width;
  if (factor === 'fit') return st.updateView({ zoom: null, scroll: 0 });
  if (factor === 'selection') {
    if (!d.selection) return;
    const len = d.selection.end - d.selection.start;
    return st.updateView({ zoom: Math.max(0.02, (len * 1.05) / width), scroll: Math.max(0, d.selection.start - len * 0.025) });
  }
  const cur = d.zoom ?? fit;
  const next = Math.max(0.02, cur * factor);
  const center = d.selection ? (d.selection.start + d.selection.end) / 2 : player.playing ? player.position() * d.audio.sampleRate : d.cursor;
  if (next >= fit) return st.updateView({ zoom: null, scroll: 0 });
  st.updateView({ zoom: next, scroll: Math.max(0, center - (next * width) / 2) });
}

export function Transport() {
  const doc = useEditor((s) => s.active());
  const loop = useEditor((s) => s.loop);
  const { playing, seconds } = usePlayhead(doc);
  const [vol, setVol] = useState(1);
  const [rate, setRate] = useState(1);
  const st = useEditor.getState();
  const sr = doc?.audio.sampleRate ?? 48000;
  const n = doc ? length(doc.audio) : 0;
  const sel = doc?.selection;
  const disabled = !doc || !n;

  return (
    <footer className="transport" aria-label="Transport">
      <div className="tp-group tp-buttons">
        <button className="icon-btn" title="Go to start (Home)" aria-label="Go to start" disabled={disabled} onClick={() => { st.setCursor(0); st.updateView({ scroll: 0 }); if (player.playing) st.togglePlay(); }}>
          <SkipBack size={18} />
        </button>
        <button className="play-btn" title="Play / Pause (Space)" aria-label={playing ? 'Pause' : 'Play'} disabled={disabled} onClick={st.togglePlay} data-testid="play">
          {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
        </button>
        <button className="icon-btn" title="Stop" aria-label="Stop" disabled={disabled} onClick={st.stop}>
          <Square size={16} fill="currentColor" />
        </button>
        <button className="icon-btn" title="Go to end (End)" aria-label="Go to end" disabled={disabled} onClick={() => st.setCursor(n)}>
          <SkipForward size={18} />
        </button>
        <button className="rec-btn" title="Record (R)" aria-label="Record" onClick={() => st.setDialog({ type: 'record' })} data-testid="record">
          <Circle size={14} fill="currentColor" />
        </button>
        <button className={`icon-btn toggle ${loop ? 'on' : ''}`} title="Loop (L)" aria-label="Loop playback" aria-pressed={loop} onClick={() => st.setLoop(!loop)}>
          <Repeat size={17} />
        </button>
      </div>

      <div className="tp-group tp-clock">
        <output className="clock" data-testid="clock" aria-live="off">{formatTime(seconds)}</output>
        <span className="clock-sub">/ {formatTime(n / sr)}</span>
      </div>

      <div className="tp-group tp-sel">
        <TimeField label="Start" testId="sel-start" value={sel ? sel.start / sr : (doc?.cursor ?? 0) / sr} onCommit={(s) => {
          const v = Math.round(s * sr);
          if (sel) st.setSelection({ start: v, end: Math.max(v, sel.end) });
          else st.setCursor(v);
        }} />
        <TimeField label="End" testId="sel-end" value={sel ? sel.end / sr : (doc?.cursor ?? 0) / sr} onCommit={(s) => {
          const v = Math.round(s * sr);
          const start = sel ? sel.start : doc?.cursor ?? 0;
          st.setSelection({ start: Math.min(start, v), end: Math.max(start, v) });
        }} />
        <TimeField label="Length" value={sel ? (sel.end - sel.start) / sr : 0} onCommit={(s) => {
          const start = sel ? sel.start : doc?.cursor ?? 0;
          st.setSelection({ start, end: start + Math.round(s * sr) });
        }} />
      </div>

      <div className="tp-group tp-zoom">
        <button className="icon-btn" aria-label="Zoom out" title="Zoom out (−)" disabled={disabled} onClick={() => zoom(2)}><ZoomOut size={17} /></button>
        <button className="icon-btn" aria-label="Zoom in" title="Zoom in (+)" disabled={disabled} onClick={() => zoom(0.5)}><ZoomIn size={17} /></button>
        <button className="icon-btn" aria-label="Zoom to fit" title="Fit (0)" disabled={disabled} onClick={() => zoom('fit')}><Maximize2 size={16} /></button>
      </div>

      <div className="tp-group tp-mix">
        <label className="mini-slider" title="Playback volume">
          <Volume2 size={16} aria-hidden />
          <input type="range" min={0} max={1.5} step={0.01} value={vol} aria-label="Playback volume" onChange={(e) => { const v = Number(e.target.value); setVol(v); player.setVolume(v); }} />
        </label>
        <label className="mini-select" title="Playback speed">
          <Gauge size={16} aria-hidden />
          <select aria-label="Playback speed" value={rate} onChange={(e) => { const r = Number(e.target.value); setRate(r); player.setRate(r); }}>
            {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
        </label>
        <LevelMeters />
      </div>
    </footer>
  );
}
