import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Plus, FileAudio, Upload, Circle, Scissors, Copy, Trash2, Pencil, Layers, Download, ZoomIn, ZoomOut, Undo2, Redo2, X, Volume2,
} from 'lucide-react';
import { useMultitrack } from '../store/multitrack';
import { useEditor, decodeFile } from '../store/editor';
import { useSettings } from '../store/settings';
import { useRecording } from '../store/recording';
import { Track, Clip, sessionLength, clipEnd } from '../audio/mixer';
import { computePeaks } from '../audio/analysis';
import { length } from '../audio/buffer';
import { player } from '../audio/player';
import { formatTime } from '../app/format';

const LIME = '#c6ff3d';
const TRACK_H = 92;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function fitCanvas(c: HTMLCanvasElement, w: number, h: number) {
  const dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function Ruler({ width }: { width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { pxPerSec, scrollSec } = useMultitrack();
  const st = useMultitrack.getState();
  useEffect(() => {
    const c = ref.current;
    if (!c || !width) return;
    const ctx = fitCanvas(c, width, 26);
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, width, 26);
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const tick = steps.find((s) => s * pxPerSec >= 80) ?? 1200;
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'top';
    for (let t = Math.floor(scrollSec / tick) * tick; t < scrollSec + width / pxPerSec + tick; t += tick) {
      const x = Math.round((t - scrollSec) * pxPerSec) + 0.5;
      ctx.fillStyle = '#3a3a3a';
      ctx.fillRect(x, 14, 1, 12);
      ctx.fillStyle = '#8d8f86';
      ctx.fillText(formatTime(t, tick < 1), x + 4, 4);
    }
  }, [width, pxPerSec, scrollSec]);
  return (
    <canvas
      ref={ref}
      className="mt-ruler"
      onPointerDown={(e) => {
        const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
        const sr = st.session.sampleRate;
        const pos = (scrollSec + x / pxPerSec) * sr;
        st.setCursor(pos);
        if (player.playing) player.play(st.mix(), pos / sr);
      }}
    />
  );
}

function TrackHeader({ t, index }: { t: Track; index: number }) {
  const st = useMultitrack.getState();
  const selected = useMultitrack((s) => s.selectedTrackId === t.id);
  return (
    <div className={`mt-head ${selected ? 'on' : ''}`} onPointerDown={() => st.selectClip(null, t.id)}>
      <div className="mt-head-row">
        <span className="mt-num">{index + 1}</span>
        <input className="mt-name" value={t.name} aria-label="Track name" onChange={(e) => st.updateTrack(t.id, { name: e.target.value })} />
        <button className="icon-btn mt-x" aria-label={`Delete ${t.name}`} title="Delete track" onClick={() => {
          if (t.clips.length && !confirm(`Delete “${t.name}” and its ${t.clips.length} clip(s)?`)) return;
          st.removeTrack(t.id);
        }}>
          <X size={14} />
        </button>
      </div>
      <div className="mt-head-row">
        <button className={`mt-ms ${t.mute ? 'mute-on' : ''}`} aria-pressed={t.mute} title="Mute" onClick={() => st.updateTrack(t.id, { mute: !t.mute }, true)} data-testid={`mute-${index}`}>M</button>
        <button className={`mt-ms ${t.solo ? 'solo-on' : ''}`} aria-pressed={t.solo} title="Solo" onClick={() => st.updateTrack(t.id, { solo: !t.solo }, true)} data-testid={`solo-${index}`}>S</button>
        <label className="mt-vol" title={`Volume ${t.volumeDb.toFixed(1)} dB`}>
          <Volume2 size={13} aria-hidden />
          <input type="range" min={-40} max={6} step={0.5} value={t.volumeDb} aria-label={`${t.name} volume`} onChange={(e) => st.updateTrack(t.id, { volumeDb: Number(e.target.value) })} />
        </label>
      </div>
      <label className="mt-pan" title={`Pan ${Math.round(t.pan * 100)}`}>
        <span>L</span>
        <input type="range" min={-1} max={1} step={0.05} value={t.pan} aria-label={`${t.name} pan`} onChange={(e) => st.updateTrack(t.id, { pan: Number(e.target.value) })} onDoubleClick={() => st.updateTrack(t.id, { pan: 0 })} />
        <span>R</span>
      </label>
    </div>
  );
}

function Lane({ t, width }: { t: Track; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { pxPerSec, scrollSec, selectedClipId, session } = useMultitrack();
  const st = useMultitrack.getState();
  const sr = session.sampleRate;
  const [drag, setDrag] = useState<{ clipId: string; dx: number; grabSec: number; originX: number; originY: number; moved: boolean } | null>(null);
  const anySolo = session.tracks.some((x) => x.solo);
  const dim = t.mute || (anySolo && !t.solo);

  const clipX = (c: Clip) => (c.start / sr - scrollSec) * pxPerSec;

  useEffect(() => {
    const c = ref.current;
    if (!c || !width) return;
    const ctx = fitCanvas(c, width, TRACK_H);
    ctx.clearRect(0, 0, width, TRACK_H);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, TRACK_H);
    for (const clip of t.clips) {
      const dx = drag?.clipId === clip.id ? drag.dx : 0;
      const x0 = clipX(clip) + dx;
      const w = (length(clip.audio) / sr) * pxPerSec;
      if (x0 > width || x0 + w < 0) continue;
      const sel = clip.id === selectedClipId;
      ctx.globalAlpha = dim ? 0.35 : 1;
      ctx.fillStyle = sel ? 'rgba(198,255,61,0.2)' : 'rgba(198,255,61,0.09)';
      ctx.strokeStyle = sel ? LIME : 'rgba(198,255,61,0.35)';
      ctx.lineWidth = sel ? 2 : 1;
      ctx.beginPath();
      ctx.roundRect(x0 + 0.5, 4.5, Math.max(2, w - 1), TRACK_H - 9, 8);
      ctx.fill();
      ctx.stroke();
      // waveform for visible part
      const visX0 = Math.max(0, x0);
      const visX1 = Math.min(width, x0 + w);
      const pixels = Math.ceil(visX1 - visX0);
      if (pixels > 0) {
        const spp = sr / pxPerSec;
        const startSample = (visX0 - x0) * spp;
        const peaks = computePeaks(clip.audio.channels[0], startSample, spp, pixels);
        const mid = TRACK_H / 2 + 6;
        const amp = (TRACK_H - 30) / 2;
        ctx.fillStyle = sel ? '#e6ff9e' : LIME;
        for (let i = 0; i < pixels; i++) {
          const y0 = mid - peaks[i * 2 + 1] * amp;
          const y1 = mid - peaks[i * 2] * amp;
          ctx.fillRect(visX0 + i, y0, 1, Math.max(1, y1 - y0));
        }
      }
      ctx.font = '600 11px Inter, system-ui, sans-serif';
      ctx.fillStyle = sel ? '#fff' : '#c9cbc2';
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, w, TRACK_H);
      ctx.clip();
      ctx.fillText(clip.name, Math.max(x0, 0) + 8, 18);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }, [t, width, pxPerSec, scrollSec, selectedClipId, drag, sr, dim]);

  const hit = (x: number) => [...t.clips].reverse().find((c) => x >= clipX(c) && x <= clipX(c) + (length(c.audio) / sr) * pxPerSec);

  return (
    <canvas
      ref={ref}
      className="mt-lane"
      data-track-id={t.id}
      data-testid={`lane-${t.id}`}
      onPointerDown={(e) => {
        const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
        const c = hit(x);
        if (c) {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          st.selectClip(c.id, t.id);
          setDrag({ clipId: c.id, dx: 0, grabSec: c.start / sr, originX: e.clientX, originY: e.clientY, moved: false });
        } else {
          st.selectClip(null, t.id);
          const pos = (scrollSec + x / pxPerSec) * sr;
          st.setCursor(pos);
          if (player.playing) player.play(st.mix(), pos / sr);
        }
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        const dx = e.clientX - drag.originX;
        setDrag({ ...drag, dx, moved: drag.moved || Math.abs(dx) > 3 || Math.abs(e.clientY - drag.originY) > 12 });
      }}
      onPointerUp={(e) => {
        if (!drag) return;
        const d = drag;
        setDrag(null);
        const els = document.elementsFromPoint(e.clientX, e.clientY);
        const destId = (els.find((el) => (el as HTMLElement).dataset?.trackId) as HTMLElement | undefined)?.dataset.trackId;
        if (!d.moved) {
          const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
          st.setCursor((scrollSec + x / pxPerSec) * sr);
          return;
        }
        const newStart = Math.max(0, (d.grabSec + d.dx / pxPerSec) * sr);
        st.moveClip(d.clipId, newStart, destId ?? t.id);
      }}
      onDoubleClick={(e) => {
        const c = hit(e.clientX - e.currentTarget.getBoundingClientRect().left);
        if (c) editClip(c);
      }}
    />
  );
}

function editClip(c: Clip) {
  useEditor.getState().newDoc(c.name, c.audio);
  useSettings.getState().set({ multitrack: false });
  useEditor.getState().toast('Clip opened in the editor. Use “Add file as track” to bring the edited version back.');
}

function Playhead({ headW }: { headW: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { cursor, pxPerSec, scrollSec, session } = useMultitrack();
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const el = ref.current;
      if (!el) return;
      const sec = player.playing ? player.position() : cursor / session.sampleRate;
      const x = (sec - scrollSec) * pxPerSec;
      el.style.transform = `translateX(${headW + x}px)`;
      el.style.display = x < 0 ? 'none' : 'block';
      el.classList.toggle('playing', player.playing);
      if (player.playing) {
        const st = useMultitrack.getState();
        const lane = (el.parentElement?.clientWidth ?? 800) - headW;
        if (useSettings.getState().followPlayhead && x > lane * 0.92) st.setScroll(sec - (lane * 0.1) / pxPerSec);
        raf = requestAnimationFrame(draw);
      }
    };
    draw();
    const un = player.subscribe(() => { cancelAnimationFrame(raf); draw(); });
    return () => { cancelAnimationFrame(raf); un(); };
  }, [cursor, pxPerSec, scrollSec, session.sampleRate, headW]);
  return <div className="mt-playhead" ref={ref} aria-hidden />;
}

export function MultiTrack() {
  const mt = useMultitrack();
  const doc = useEditor((s) => s.active());
  const [wrapRef, wrapW] = useWidth<HTMLDivElement>();
  const fileRef = useRef<HTMLInputElement>(null);
  const headW = wrapW < 640 ? 132 : 210;
  const laneW = Math.max(0, wrapW - headW);
  const { session } = mt;
  const total = sessionLength(session) / session.sampleRate;
  const sel = mt.selectedClipId ? mt.findClip(mt.selectedClipId) : null;
  const ed = useEditor.getState();

  const actions: { label: string; icon: React.ReactNode; onClick: () => void; disabled?: boolean; testId?: string; title?: string }[] = [
    { label: 'Add Track', icon: <Plus size={17} />, onClick: () => mt.addTrack(), testId: 'mt-add-track' },
    { label: 'Add File as Track', icon: <FileAudio size={17} />, onClick: () => doc && mt.addTrack(doc.name, doc.audio, mt.cursor), disabled: !doc || !length(doc.audio), title: 'Add the file open in the editor as a new track at the cursor', testId: 'mt-add-doc' },
    { label: 'Import', icon: <Upload size={17} />, onClick: () => fileRef.current?.click(), testId: 'mt-import' },
    { label: 'Record Track', icon: <Circle size={17} />, onClick: () => void useRecording.getState().start('track'), testId: 'mt-record' },
    { label: 'Undo', icon: <Undo2 size={17} />, onClick: mt.undo, disabled: !mt.undoStack.length },
    { label: 'Redo', icon: <Redo2 size={17} />, onClick: mt.redo, disabled: !mt.redoStack.length },
    { label: 'Split', icon: <Scissors size={17} />, onClick: () => { if (!mt.splitSelected()) ed.toast('Place the cursor inside a clip to split it'); }, title: 'Split clip at cursor (S)', testId: 'mt-split' },
    { label: 'Duplicate', icon: <Copy size={17} />, onClick: mt.duplicateSelected, disabled: !sel, title: 'Duplicate clip (Ctrl+D)' },
    { label: 'Delete Clip', icon: <Trash2 size={17} />, onClick: () => sel && mt.removeClip(sel.clip.id), disabled: !sel, testId: 'mt-delete-clip' },
    { label: 'Edit Clip', icon: <Pencil size={17} />, onClick: () => sel && editClip(sel.clip), disabled: !sel, title: 'Open clip in the waveform editor' },
    {
      label: 'Mixdown', icon: <Layers size={17} />, disabled: !total, testId: 'mt-mixdown', title: 'Render all tracks to a new stereo file',
      onClick: () => { ed.newDoc('Mixdown', mt.mix()); useSettings.getState().set({ multitrack: false }); ed.toast('Mixdown created as a new file', 'success'); },
    },
    {
      label: 'Export Mix', icon: <Download size={17} />, disabled: !total,
      onClick: () => { ed.newDoc('Mixdown', mt.mix()); useSettings.getState().set({ multitrack: false }); ed.setDialog({ type: 'export' }); },
    },
    { label: 'Zoom Out', icon: <ZoomOut size={17} />, onClick: () => mt.setZoom(mt.pxPerSec / 1.6) },
    { label: 'Zoom In', icon: <ZoomIn size={17} />, onClick: () => mt.setZoom(mt.pxPerSec * 1.6) },
  ];

  return (
    <div className="mt" data-testid="multitrack">
      <div className="ribbon mt-toolbar" role="toolbar" aria-label="Multitrack tools">
        <div className="rb-items">
          {actions.map((a) => (
            <button key={a.label} className="rb-btn" onClick={a.onClick} disabled={a.disabled} title={a.title ?? a.label} data-testid={a.testId}>
              {a.icon}
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
      {sel ? (
        <div className="mt-clipbar">
          <strong>{sel.clip.name}</strong>
          <span>{formatTime(sel.clip.start / session.sampleRate)} → {formatTime(clipEnd(sel.clip) / session.sampleRate)}</span>
          <label className="mini-slider">
            Clip gain
            <input type="range" min={-30} max={12} step={0.5} value={sel.clip.gainDb} aria-label="Clip gain" onChange={(e) => mt.setClipGain(sel.clip.id, Number(e.target.value))} />
            <em>{sel.clip.gainDb > 0 ? '+' : ''}{sel.clip.gainDb} dB</em>
          </label>
        </div>
      ) : (
        <div className="mt-clipbar mt-hint">Click a clip to select it · drag to move it in time or to another track · double-click to edit · S splits at the cursor</div>
      )}
      <div
        className="mt-body"
        ref={wrapRef}
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            mt.setZoom(mt.pxPerSec * Math.exp(-e.deltaY * 0.01));
          } else if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) {
            mt.setScroll(mt.scrollSec + (e.shiftKey ? e.deltaY : e.deltaX) / mt.pxPerSec);
          }
        }}
      >
        <div className="mt-row mt-ruler-row" style={{ gridTemplateColumns: `${headW}px 1fr` }}>
          <div className="mt-corner">{session.tracks.length} tracks · {formatTime(total, false)}</div>
          <Ruler width={laneW} />
        </div>
        {session.tracks.map((t, i) => (
          <div key={t.id} className="mt-row" style={{ gridTemplateColumns: `${headW}px 1fr`, height: TRACK_H }}>
            <TrackHeader t={t} index={i} />
            <Lane t={t} width={laneW} />
          </div>
        ))}
        {!session.tracks.length && (
          <div className="empty mt-empty">
            <Layers size={34} color={LIME} />
            <h2>Multitrack mode</h2>
            <p>Layer voice, music and effects on separate tracks. Mute, solo, pan and balance each track, drag clips in time, then mix down to one file.</p>
            <div className="empty-actions">
              <button className="btn btn-primary" onClick={() => mt.addTrack()}>Add empty track</button>
              <button className="btn btn-secondary" disabled={!doc || !length(doc.audio)} onClick={() => doc && mt.addTrack(doc.name, doc.audio, 0)}>Add current file</button>
              <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>Import audio</button>
            </div>
          </div>
        )}
        {session.tracks.length > 0 && <Playhead headW={headW} />}
      </div>
      {total > 0 && (
        <input
          className="mt-scroll"
          type="range"
          min={0}
          max={Math.max(0, total - laneW / mt.pxPerSec * 0.5)}
          step={0.01}
          value={mt.scrollSec}
          aria-label="Scroll timeline"
          onChange={(e) => mt.setScroll(Number(e.target.value))}
        />
      )}
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="audio/*,.wav,.mp3,.ogg,.flac,.m4a,.aac,.webm,.opus"
        className="sr-only"
        data-testid="mt-file-input"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          for (const f of files) {
            try {
              mt.addTrack(f.name.replace(/\.[^.]+$/, ''), await decodeFile(f), useMultitrack.getState().cursor);
            } catch {
              ed.toast(`Could not open ${f.name}`, 'error');
            }
          }
        }}
      />
    </div>
  );
}
