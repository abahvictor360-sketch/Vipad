import { useEffect, useRef, useState } from 'react';
import { Mic, Pause, Play, Square, Trash2 } from 'lucide-react';
import { useRecording } from '../store/recording';
import { Recorder } from '../audio/recorder';
import { player } from '../audio/player';
import { formatTime } from '../app/format';

const LIME = '#c6ff3d';
const REC = '#ff3b3b';

function fit(c: HTMLCanvasElement) {
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/** Draw peak blocks [from, to) of one channel into a lane, `pxPerBlock` wide each. */
function drawLane(ctx: CanvasRenderingContext2D, peaks: Float32Array, from: number, to: number, x0: number, pxPerBlock: number, top: number, laneH: number, color: string) {
  const mid = top + laneH / 2;
  const amp = (laneH / 2) * 0.9;
  ctx.fillStyle = color;
  if (pxPerBlock >= 1) {
    for (let b = from; b < to; b++) {
      const mn = peaks[b * 2], mx = peaks[b * 2 + 1];
      const y0 = mid - mx * amp;
      ctx.fillRect(x0 + (b - from) * pxPerBlock, y0, Math.max(1, pxPerBlock - (pxPerBlock > 2 ? 0.5 : 0)), Math.max(1, (mx - mn) * amp));
    }
  } else {
    const per = 1 / pxPerBlock; // blocks per pixel
    const px = Math.ceil((to - from) * pxPerBlock);
    for (let x = 0; x < px; x++) {
      let mn = 1, mx = -1;
      const b0 = from + Math.floor(x * per), b1 = Math.min(to, from + Math.floor((x + 1) * per));
      for (let b = b0; b < Math.max(b1, b0 + 1); b++) {
        if (peaks[b * 2] < mn) mn = peaks[b * 2];
        if (peaks[b * 2 + 1] > mx) mx = peaks[b * 2 + 1];
      }
      ctx.fillRect(x0 + x, mid - mx * amp, 1, Math.max(1, (mx - mn) * amp));
    }
  }
}

/** The take, drawn live in the editor while recording (overview + scrolling waveform). */
export function LiveRecording() {
  const { recorder, status, dest } = useRecording();
  const st = useRecording.getState();
  const overviewRef = useRef<HTMLCanvasElement>(null);
  const mainRef = useRef<HTMLCanvasElement>(null);
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    let raf = 0;
    let lastSec = -1;
    const loop = () => {
      const r = recorder;
      const ov = overviewRef.current, mn = mainRef.current;
      if (r && ov && mn) {
        const sec = r.seconds;
        if (Math.floor(sec * 10) !== lastSec) { lastSec = Math.floor(sec * 10); setSecs(sec); }
        const blocksPerSec = r.sampleRate / Recorder.PEAK_BLOCK;
        const n = r.peakCount;
        const chs = r.livePeaks.length;
        const paused = useRecording.getState().status === 'paused';
        const color = paused ? '#7d8f3c' : LIME;

        // ---- overview: whole take compressed to the width
        {
          const { ctx, w, h } = fit(ov);
          ctx.fillStyle = '#0c0c0c';
          ctx.fillRect(0, 0, w, h);
          const total = Math.max(n, blocksPerSec * 10);
          for (let ch = 0; ch < chs; ch++) drawLane(ctx, r.livePeaks[ch], 0, n, 0, w / total, (ch * h) / chs, h / chs, '#5e7a1c');
          const x = (n / total) * w;
          ctx.fillStyle = REC;
          ctx.fillRect(Math.min(w - 2, x), 0, 2, h);
        }

        // ---- main: last ~12 s scroll past a fixed record head at 85 % of the width
        {
          const { ctx, w, h } = fit(mn);
          const RULER = 24;
          ctx.fillStyle = '#0a0a0a';
          ctx.fillRect(0, 0, w, h);
          const pxPerBlock = Math.max(0.25, (w * 0.85) / (blocksPerSec * 12));
          const headX = Math.min(n * pxPerBlock, w * 0.85);
          const firstBlock = Math.max(0, Math.floor(n - headX / pxPerBlock));
          // ruler
          ctx.fillStyle = '#0c0c0c';
          ctx.fillRect(0, 0, w, RULER);
          ctx.font = '10px ui-monospace, Menlo, monospace';
          ctx.textBaseline = 'top';
          const secPerPx = 1 / (pxPerBlock * blocksPerSec);
          const startSec = firstBlock / blocksPerSec;
          const tick = [0.5, 1, 2, 5, 10, 30, 60].find((t) => t / secPerPx >= 80) ?? 120;
          for (let t = Math.ceil(startSec / tick) * tick; t < startSec + w * secPerPx; t += tick) {
            const x = Math.round((t - startSec) / secPerPx) + 0.5;
            ctx.fillStyle = '#3a3a3a';
            ctx.fillRect(x, RULER - 9, 1, 9);
            ctx.fillStyle = '#8d8f86';
            ctx.fillText(formatTime(t, tick < 1), x + 4, 5);
          }
          ctx.fillStyle = '#252525';
          ctx.fillRect(0, RULER - 1, w, 1);
          const laneH = (h - RULER) / chs;
          for (let ch = 0; ch < chs; ch++) {
            const top = RULER + ch * laneH;
            ctx.fillStyle = '#1b1b1b';
            ctx.fillRect(0, Math.round(top + laneH / 2), w, 1);
            if (ch) { ctx.fillStyle = '#262626'; ctx.fillRect(0, Math.round(top), w, 1); }
            drawLane(ctx, r.livePeaks[ch], firstBlock, n, 0, pxPerBlock, top, laneH, color);
          }
          // record head
          ctx.fillStyle = paused ? '#ffb020' : REC;
          ctx.shadowColor = ctx.fillStyle;
          ctx.shadowBlur = paused ? 0 : 12;
          ctx.fillRect(Math.round(headX) - 1, RULER, 2, h - RULER);
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.moveTo(headX - 7, RULER);
          ctx.lineTo(headX + 7, RULER);
          ctx.lineTo(headX, RULER + 9);
          ctx.fill();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [recorder]);

  const paused = status === 'paused';
  const label = recorder?.deviceLabel || 'Microphone';

  return (
    <div className="live-rec" data-testid="live-recording">
      <div className="live-bar">
        <span className={`live-state ${paused ? 'paused' : ''}`}>
          <span className="live-dot" aria-hidden /> {status === 'saving' ? 'Saving…' : paused ? 'Paused' : 'Recording…'}
        </span>
        <span className="live-time" data-testid="rec-time">{formatTime(secs)}</span>
        <span className="live-meta">
          <Mic size={14} aria-hidden /> {label} · {recorder ? `${(recorder.sampleRate / 1000).toLocaleString()} kHz` : ''} · {recorder?.numCh === 1 ? 'Mono' : 'Stereo'}
          {dest === 'track' ? ' · new multitrack track' : dest === 'overdub' ? ' · overdub' : dest === 'insert' ? ' · insert at cursor' : ''}
        </span>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => void st.cancel()} title="Discard this take">
          <Trash2 size={15} /> <span className="hide-sm">Discard</span>
        </button>
        <button className="btn btn-secondary btn-sm" onClick={st.togglePause} data-testid="rec-pause">
          {paused ? <Play size={15} /> : <Pause size={15} />} {paused ? 'Resume' : 'Pause'}
        </button>
        <button className="btn btn-rec btn-sm" onClick={() => void st.stop()} data-testid="rec-stop">
          <Square size={13} fill="currentColor" /> Stop
        </button>
      </div>
      <canvas ref={overviewRef} className="live-overview" aria-hidden />
      <canvas ref={mainRef} className="live-main" role="img" aria-label="Live recording waveform" />
      {player.playing && <p className="live-note">Playing the existing audio while you record — use headphones to avoid echo.</p>}
    </div>
  );
}

/**
 * Horizontal dB level meter with scale, peak hold and clip light (−45…0 dB).
 * Shows the microphone while recording and the output while playing.
 */
export function DbMeter() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const buf = new Float32Array(1024);
    const level = [0, 0];
    const hold = [0, 0];
    const holdT = [0, 0];
    let clipUntil = 0;
    const MIN = -45;
    const toX = (db: number, w: number) => Math.max(0, Math.min(1, (db - MIN) / -MIN)) * w;
    const draw = (t: number) => {
      const c = ref.current;
      if (!c) return;
      const { ctx, w: W, h } = fit(c);
      const w = W - 12; // room for clip light
      ctx.clearRect(0, 0, W, h);
      const rs = useRecording.getState();
      const rec = rs.recorder && (rs.status === 'recording' || rs.status === 'paused') ? rs.recorder : null;
      const inst = [0, 0];
      if (rec) {
        inst[0] = rec.levels[0] ?? 0;
        inst[1] = rec.levels[1] ?? rec.levels[0] ?? 0;
      } else if (player.playing) {
        [player.analyserL, player.analyserR].forEach((an, i) => {
          if (!an) return;
          an.getFloatTimeDomainData(buf);
          let pk = 0;
          for (const v of buf) pk = Math.max(pk, Math.abs(v));
          inst[i] = pk;
        });
      }
      const SCALE = 11;
      const barH = (h - SCALE - 3) / 2;
      // scale
      ctx.font = '9px ui-monospace, Menlo, monospace';
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      for (let db = MIN; db <= 0; db += 3) {
        const x = toX(db, w);
        ctx.fillStyle = '#4a4c45';
        ctx.fillRect(Math.round(x), SCALE - 2, 1, 2);
        if (db % 6 === 0 || db === MIN) {
          ctx.fillStyle = '#8d8f86';
          ctx.fillText(String(db), Math.min(w - 6, Math.max(8, x)), 0);
        }
      }
      for (let i = 0; i < 2; i++) {
        level[i] = Math.max(inst[i], level[i] * 0.86);
        if (level[i] >= hold[i] || t - holdT[i] > 1200) { hold[i] = level[i]; holdT[i] = t; }
        if (inst[i] >= 0.995) clipUntil = t + 1500;
        const y = SCALE + 1 + i * (barH + 1);
        ctx.fillStyle = '#161616';
        ctx.fillRect(0, y, w, barH);
        const db = level[i] > 1e-5 ? 20 * Math.log10(level[i]) : -120;
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, '#2f6b12');
        g.addColorStop(0.55, '#7ccf1c');
        g.addColorStop(0.8, '#d6e81c');
        g.addColorStop(0.93, '#ffb020');
        g.addColorStop(1, '#ff3b3b');
        ctx.fillStyle = g;
        ctx.fillRect(0, y, toX(db, w), barH);
        const hdb = hold[i] > 1e-5 ? 20 * Math.log10(hold[i]) : -120;
        if (hdb > MIN) {
          ctx.fillStyle = hdb > -1 ? '#ff3b3b' : '#f3f4ee';
          ctx.fillRect(Math.round(toX(hdb, w)) - 1, y, 2, barH);
        }
      }
      // clip light
      ctx.fillStyle = t < clipUntil ? '#ff3b3b' : rec ? '#2b8a3e' : '#2a2a2a';
      ctx.fillRect(W - 8, SCALE + 1, 8, h - SCALE - 1);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="db-meter" role="img" aria-label="Input and output level meter in decibels" data-testid="level-meter" />;
}
