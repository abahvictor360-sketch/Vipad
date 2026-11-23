import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Doc, useEditor } from '../store/editor';
import { computePeaks } from '../audio/analysis';
import { length } from '../audio/buffer';
import { player } from '../audio/player';
import { formatTime } from '../app/format';

const LIME = '#c6ff3d';
const MIN_SPP = 0.02;
const RULER_H = 26;

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function setupCanvas(c: HTMLCanvasElement, w: number, h: number) {
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

function niceTick(secPerPx: number): number {
  const steps = [0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
  for (const s of steps) if (s / secPerPx >= 90) return s;
  return 7200;
}

/** View math shared by the waveform, ruler and keyboard zoom commands. */
export function viewFor(doc: Doc, width: number) {
  const n = length(doc.audio);
  const fit = Math.max(MIN_SPP, n / Math.max(1, width));
  const spp = Math.min(fit, Math.max(MIN_SPP, doc.zoom ?? fit));
  const maxScroll = Math.max(0, n - spp * width);
  const scroll = Math.min(maxScroll, Math.max(0, doc.scroll));
  return { n, spp, fit, scroll, maxScroll };
}

export function Waveform({ doc }: { doc: Doc }) {
  const [wrapRef, size] = useSize<HTMLDivElement>();
  const waveRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const rulerRef = useRef<HTMLCanvasElement>(null);
  const peaksCache = useRef<{ key: string; peaks: Float32Array[] } | null>(null);
  const { setSelection, setCursor, updateView } = useEditor.getState();
  const followPlayhead = useEditor((s) => s.followPlayhead);

  const width = size.w;
  const height = Math.max(80, size.h - RULER_H);
  const { n, spp, scroll, fit } = viewFor(doc, width);
  const sr = doc.audio.sampleRate;

  const xToSample = useCallback((x: number) => Math.max(0, Math.min(n, Math.round(scroll + x * spp))), [scroll, spp, n]);
  const sampleToX = useCallback((s: number) => (s - scroll) / spp, [scroll, spp]);

  // ---------- draw ruler
  useEffect(() => {
    const c = rulerRef.current;
    if (!c || !width) return;
    const ctx = setupCanvas(c, width, RULER_H);
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, width, RULER_H);
    const secPerPx = spp / sr;
    const tick = niceTick(secPerPx);
    const startSec = scroll / sr;
    const first = Math.floor(startSec / tick) * tick;
    ctx.font = '10px ui-monospace, Menlo, monospace';
    ctx.textBaseline = 'top';
    for (let t = first; t <= startSec + width * secPerPx + tick; t += tick) {
      const x = Math.round((t - startSec) / secPerPx) + 0.5;
      if (x < -50) continue;
      ctx.strokeStyle = '#3a3a3a';
      ctx.beginPath();
      ctx.moveTo(x, RULER_H - 10);
      ctx.lineTo(x, RULER_H);
      ctx.stroke();
      for (let k = 1; k < 5; k++) {
        const xx = Math.round(x + (k * tick) / 5 / secPerPx) + 0.5;
        ctx.strokeStyle = '#262626';
        ctx.beginPath();
        ctx.moveTo(xx, RULER_H - 4);
        ctx.lineTo(xx, RULER_H);
        ctx.stroke();
      }
      ctx.fillStyle = '#8d8f86';
      const label = tick < 1 ? formatTime(t) : formatTime(t, false);
      ctx.fillText(label, x + 4, 5);
    }
    ctx.fillStyle = '#252525';
    ctx.fillRect(0, RULER_H - 1, width, 1);
  }, [width, spp, scroll, sr]);

  // ---------- draw waveform
  useEffect(() => {
    const c = waveRef.current;
    if (!c || !width) return;
    const ctx = setupCanvas(c, width, height);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, width, height);
    const chs = doc.audio.channels;
    const laneH = height / chs.length;

    // selection background
    if (doc.selection) {
      const x0 = Math.max(0, sampleToX(doc.selection.start));
      const x1 = Math.min(width, sampleToX(doc.selection.end));
      if (x1 > 0 && x0 < width) {
        ctx.fillStyle = 'rgba(198,255,61,0.13)';
        ctx.fillRect(x0, 0, Math.max(1, x1 - x0), height);
      }
    }

    // grid
    for (let ch = 0; ch < chs.length; ch++) {
      const top = ch * laneH;
      const mid = top + laneH / 2;
      ctx.fillStyle = '#1d1d1d';
      ctx.fillRect(0, Math.round(mid), width, 1);
      ctx.fillStyle = '#141414';
      ctx.fillRect(0, Math.round(mid - laneH * 0.25), width, 1);
      ctx.fillRect(0, Math.round(mid + laneH * 0.25), width, 1);
      if (ch > 0) {
        ctx.fillStyle = '#262626';
        ctx.fillRect(0, Math.round(top), width, 1);
      }
    }

    if (n > 0) {
      const amp = (laneH / 2) * 0.92;
      if (spp >= 1) {
        const key = `${doc.id}:${doc.version}:${spp}:${scroll}:${width}`;
        if (peaksCache.current?.key !== key) {
          peaksCache.current = { key, peaks: chs.map((c) => computePeaks(c, scroll, spp, Math.ceil(width))) };
        }
        const peaks = peaksCache.current.peaks;
        const selX0 = doc.selection ? sampleToX(doc.selection.start) : Infinity;
        const selX1 = doc.selection ? sampleToX(doc.selection.end) : -Infinity;
        for (let ch = 0; ch < chs.length; ch++) {
          const top = ch * laneH;
          const mid = top + laneH / 2;
          const p = peaks[ch];
          const grad = ctx.createLinearGradient(0, top, 0, top + laneH);
          grad.addColorStop(0, '#8fb82a');
          grad.addColorStop(0.5, LIME);
          grad.addColorStop(1, '#8fb82a');
          const selGrad = ctx.createLinearGradient(0, top, 0, top + laneH);
          selGrad.addColorStop(0, '#ffffff');
          selGrad.addColorStop(0.5, '#efffc4');
          selGrad.addColorStop(1, '#ffffff');
          for (let pass = 0; pass < 2; pass++) {
            ctx.fillStyle = pass === 0 ? grad : selGrad;
            for (let x = 0; x < width; x++) {
              const inSel = x >= selX0 && x < selX1;
              if ((pass === 1) !== inSel) continue;
              const mn = p[x * 2];
              const mx = p[x * 2 + 1];
              const y0 = mid - mx * amp;
              const y1 = mid - mn * amp;
              ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
            }
          }
        }
      } else {
        // sample-level view
        for (let ch = 0; ch < chs.length; ch++) {
          const mid = ch * laneH + laneH / 2;
          const c = chs[ch];
          const s0 = Math.max(0, Math.floor(scroll) - 1);
          const s1 = Math.min(n, Math.ceil(scroll + width * spp) + 1);
          ctx.strokeStyle = LIME;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let i = s0; i < s1; i++) {
            const x = sampleToX(i);
            const y = mid - c[i] * amp;
            if (i === s0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
          if (spp < 0.15) {
            ctx.fillStyle = '#eaffb0';
            for (let i = s0; i < s1; i++) {
              ctx.beginPath();
              ctx.arc(sampleToX(i), mid - c[i] * amp, 2.5, 0, Math.PI * 2);
              ctx.fill();
            }
          }
        }
      }
    }

    // selection edges
    if (doc.selection) {
      ctx.fillStyle = LIME;
      for (const s of [doc.selection.start, doc.selection.end]) {
        const x = Math.round(sampleToX(s));
        if (x >= -1 && x <= width + 1) ctx.fillRect(x - 0.5, 0, 1.5, height);
      }
    }
    // markers
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    for (const m of doc.markers) {
      const x = Math.round(sampleToX(m.pos)) + 0.5;
      if (x < -60 || x > width) continue;
      ctx.strokeStyle = '#ffb020';
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      ctx.setLineDash([]);
      const tw = ctx.measureText(m.label).width + 10;
      ctx.fillStyle = '#ffb020';
      ctx.fillRect(x, 0, tw, 16);
      ctx.fillStyle = '#111';
      ctx.fillText(m.label, x + 5, 11);
    }
  }, [doc.audio, doc.version, doc.selection, doc.markers, doc.id, width, height, spp, scroll, n, sampleToX]);

  // ---------- overlay: cursor + live playhead
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const c = overlayRef.current;
      if (!c || !width) return;
      const ctx = setupCanvas(c, width, height);
      ctx.clearRect(0, 0, width, height);
      const cx = Math.round(sampleToX(doc.cursor)) + 0.5;
      if (cx >= 0 && cx <= width) {
        ctx.strokeStyle = 'rgba(255,255,255,0.75)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, 0);
        ctx.lineTo(cx, height);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (player.playing) {
        const pos = player.position() * sr;
        const px = sampleToX(pos);
        if (px >= 0 && px <= width) {
          ctx.shadowColor = LIME;
          ctx.shadowBlur = 10;
          ctx.fillStyle = LIME;
          ctx.fillRect(Math.round(px) - 1, 0, 2, height);
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.moveTo(px - 6, 0);
          ctx.lineTo(px + 6, 0);
          ctx.lineTo(px, 8);
          ctx.fill();
        }
        const st = useEditor.getState();
        if (st.followPlayhead && doc.zoom !== null && (px > width * 0.92 || px < 0)) {
          st.updateView({ scroll: Math.max(0, pos - width * spp * 0.1) });
        }
        raf = requestAnimationFrame(draw);
      }
    };
    draw();
    const unsub = player.subscribe(() => {
      cancelAnimationFrame(raf);
      draw();
    });
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, [doc.cursor, doc.zoom, width, height, sampleToX, sr, spp, followPlayhead]);

  // ---------- zoom helpers
  const zoomAt = useCallback(
    (factor: number, anchorX: number) => {
      const anchorSample = scroll + anchorX * spp;
      const newSpp = Math.min(fit, Math.max(MIN_SPP, spp * factor));
      const newScroll = anchorSample - anchorX * newSpp;
      updateView({ zoom: newSpp >= fit ? null : newSpp, scroll: Math.max(0, newScroll) });
    },
    [scroll, spp, fit, updateView],
  );

  // ---------- pointer interaction
  const drag = useRef<{ mode: 'select' | 'edgeStart' | 'edgeEnd'; anchor: number; startX: number; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; spp: number; midX: number } | null>(null);

  const localX = (e: { clientX: number }) => e.clientX - (waveRef.current?.getBoundingClientRect().left ?? 0);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.abs(a.x - b.x) || 1, spp, midX: (a.x + b.x) / 2 - (waveRef.current?.getBoundingClientRect().left ?? 0) };
      drag.current = null;
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const x = localX(e);
    const s = xToSample(x);
    const sel = doc.selection;
    const edgeTol = e.pointerType === 'touch' ? 14 : 6;
    if (sel && Math.abs(sampleToX(sel.start) - x) < edgeTol) {
      drag.current = { mode: 'edgeStart', anchor: sel.end, startX: x, moved: false };
    } else if (sel && Math.abs(sampleToX(sel.end) - x) < edgeTol) {
      drag.current = { mode: 'edgeEnd', anchor: sel.start, startX: x, moved: false };
    } else if (e.shiftKey) {
      const anchor = sel ? (Math.abs(s - sel.start) < Math.abs(s - sel.end) ? sel.end : sel.start) : doc.cursor;
      drag.current = { mode: 'select', anchor, startX: x, moved: true };
      setSelection({ start: Math.min(anchor, s), end: Math.max(anchor, s) });
    } else {
      drag.current = { mode: 'select', anchor: s, startX: x, moved: false };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const el = waveRef.current;
    if (el) {
      const x = localX(e);
      const sel = doc.selection;
      const near = sel && (Math.abs(sampleToX(sel.start) - x) < 6 || Math.abs(sampleToX(sel.end) - x) < 6);
      el.style.cursor = near ? 'ew-resize' : 'text';
    }
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.abs(a.x - b.x) || 1;
      const target = pinch.current.spp * (pinch.current.dist / dist);
      zoomAt(target / spp, pinch.current.midX);
      return;
    }
    const d = drag.current;
    if (!d) return;
    const x = localX(e);
    if (Math.abs(x - d.startX) > 3) d.moved = true;
    if (!d.moved) return;
    const s = xToSample(x);
    setSelection({ start: Math.min(d.anchor, s), end: Math.max(d.anchor, s) });
    // auto-scroll when dragging past the edges
    if (doc.zoom !== null && (x < 0 || x > width)) {
      updateView({ scroll: Math.max(0, scroll + (x < 0 ? -1 : 1) * spp * 20) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      const s = xToSample(localX(e));
      setSelection(null);
      setCursor(s);
      if (player.playing) {
        player.play(doc.audio, s / sr, undefined, useEditor.getState().loop);
      }
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      zoomAt(Math.exp(e.deltaY * 0.01), localX(e));
      return;
    }
    if (doc.zoom === null) return;
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    updateView({ scroll: Math.max(0, scroll + delta * spp) });
  };

  // prevent page zoom on ctrl+wheel
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, [wrapRef]);

  const channelLabels = doc.audio.channels.length === 2 ? ['L', 'R'] : doc.audio.channels.length === 1 ? ['M'] : doc.audio.channels.map((_, i) => String(i + 1));

  return (
    <div className="wave-wrap" ref={wrapRef}>
      <canvas ref={rulerRef} className="wave-ruler" aria-hidden onPointerDown={(e) => {
        const s = xToSample(localX(e));
        setCursor(s);
        if (player.playing) player.play(doc.audio, s / sr, undefined, useEditor.getState().loop);
      }} />
      <div className="wave-stage" style={{ height }}>
        <canvas
          ref={waveRef}
          className="wave-canvas"
          role="application"
          aria-label={`Waveform of ${doc.name}. Drag to select audio.`}
          data-testid="waveform"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          onDoubleClick={() => n && setSelection({ start: 0, end: n })}
        />
        <canvas ref={overlayRef} className="wave-overlay" aria-hidden />
        <div className="wave-ch-labels" aria-hidden>
          {channelLabels.map((l) => (
            <span key={l} style={{ height: `${100 / channelLabels.length}%` }}>{l}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Whole-file overview / navigator with draggable viewport. */
export function Overview({ doc }: { doc: Doc }) {
  const [ref, size] = useSize<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { updateView } = useEditor.getState();
  const n = length(doc.audio);
  const H = 40;
  const viewWidth = size.w;
  const v = viewFor(doc, viewWidth);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !size.w) return;
    const ctx = setupCanvas(c, size.w, H);
    ctx.fillStyle = '#0c0c0c';
    ctx.fillRect(0, 0, size.w, H);
    if (!n) return;
    const mono = doc.audio.channels[0];
    const peaks = computePeaks(mono, 0, n / size.w, size.w);
    ctx.fillStyle = '#4d5f1c';
    for (let x = 0; x < size.w; x++) {
      const y0 = H / 2 - peaks[x * 2 + 1] * (H / 2 - 2);
      const y1 = H / 2 - peaks[x * 2] * (H / 2 - 2);
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    if (doc.selection) {
      ctx.fillStyle = 'rgba(198,255,61,0.25)';
      ctx.fillRect((doc.selection.start / n) * size.w, 0, Math.max(1, ((doc.selection.end - doc.selection.start) / n) * size.w), H);
    }
  }, [doc.version, doc.audio, doc.selection, size.w, n]);

  const vx = n ? (v.scroll / n) * size.w : 0;
  const vw = n ? Math.max(6, ((v.spp * viewWidth) / n) * size.w) : size.w;
  const dragging = useRef<number | null>(null);

  const moveTo = (clientX: number, grabOffset: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const x = clientX - rect.left - grabOffset;
    updateView({ scroll: Math.max(0, (x / size.w) * n) });
  };

  return (
    <div
      className="overview"
      ref={ref}
      style={{ height: H }}
      aria-label="Overview navigator"
      onPointerDown={(e) => {
        if (doc.zoom === null) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const rect = ref.current!.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const grab = x >= vx && x <= vx + vw ? x - vx : vw / 2;
        dragging.current = grab;
        moveTo(e.clientX, grab);
      }}
      onPointerMove={(e) => dragging.current !== null && moveTo(e.clientX, dragging.current)}
      onPointerUp={() => (dragging.current = null)}
    >
      <canvas ref={canvasRef} />
      {doc.zoom !== null && <div className="overview-view" style={{ left: vx, width: vw }} />}
    </div>
  );
}
