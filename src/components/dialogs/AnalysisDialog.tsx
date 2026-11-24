import { useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { Modal } from './Modal';
import { useEditor } from '../../store/editor';
import { slice, length, toMono } from '../../audio/buffer';
import { fft, hann, stats } from '../../audio/analysis';
import { measureLoudness } from '../../audio/loudness';
import { formatDb, formatTime } from '../../app/format';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function noteName(f: number): string {
  if (!(f > 0)) return '—';
  const m = Math.round(12 * Math.log2(f / 440) + 69);
  const cents = Math.round(100 * (12 * Math.log2(f / 440) + 69 - m));
  return `${NOTES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}${cents ? ` ${cents > 0 ? '+' : ''}${cents}¢` : ''}`;
}

/** Welch-averaged magnitude spectrum in dB (first ≤ 60 s analysed). */
export function averageSpectrum(c: Float32Array, N = 8192): Float32Array {
  const win = hann(N);
  const re = new Float32Array(N), im = new Float32Array(N);
  const acc = new Float64Array(N / 2);
  let frames = 0;
  const hop = N / 2;
  const end = Math.max(1, c.length - N + 1);
  for (let s = 0; s < end; s += hop) {
    for (let i = 0; i < N; i++) { re[i] = (c[s + i] ?? 0) * win[i]; im[i] = 0; }
    fft(re, im);
    for (let b = 0; b < N / 2; b++) acc[b] += (re[b] * re[b] + im[b] * im[b]);
    frames++;
  }
  const out = new Float32Array(N / 2);
  for (let b = 0; b < N / 2; b++) out[b] = 10 * Math.log10(acc[b] / frames / ((N / 4) * (N / 4)) + 1e-20);
  return out;
}

export function AnalysisDialog() {
  const doc = useEditor((s) => s.active());
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ f: number; db: number } | null>(null);
  const close = () => useEditor.getState().setDialog(null);

  const data = useMemo(() => {
    if (!doc || !length(doc.audio)) return null;
    const sr = doc.audio.sampleRate;
    const range = doc.selection ?? { start: 0, end: length(doc.audio) };
    const clip = slice(doc.audio, { start: range.start, end: Math.min(range.end, range.start + sr * 60) });
    const mono = toMono(clip).channels[0];
    const N = 8192;
    const spec = averageSpectrum(mono, N);
    let pb = 1;
    for (let b = 2; b < spec.length; b++) if (spec[b] > spec[pb]) pb = b;
    // parabolic interpolation for a precise peak frequency
    const [l, m, r] = [spec[pb - 1], spec[pb], spec[pb + 1] ?? spec[pb]];
    const delta = (0.5 * (l - r)) / (l - 2 * m + r || 1);
    const peakF = ((pb + delta) * sr) / N;
    return { sr, N, spec, peakF, peakDb: m, loud: measureLoudness(clip), st: stats(clip), dur: length(clip) / sr, partial: range.end - range.start > sr * 60 };
  }, [doc]);

  useEffect(() => {
    const c = canvas.current;
    if (!c || !data) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr; c.height = h * dpr;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, w, h);
    const fMin = 20, fMax = data.sr / 2;
    const xOf = (f: number) => (Math.log(f / fMin) / Math.log(fMax / fMin)) * w;
    const yOf = (db: number) => ((-db) / 100) * h;
    ctx.font = '10px ui-monospace, Menlo, monospace';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
      if (f > fMax) continue;
      const x = xOf(f);
      ctx.fillStyle = '#1e1e1e'; ctx.fillRect(Math.round(x), 0, 1, h);
      ctx.fillStyle = '#6b6d66'; ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), x + 3, h - 4);
    }
    for (let db = -20; db > -100; db -= 20) {
      ctx.fillStyle = '#1e1e1e'; ctx.fillRect(0, Math.round(yOf(db)), w, 1);
      ctx.fillStyle = '#6b6d66'; ctx.fillText(`${db} dB`, 4, yOf(db) - 3);
    }
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, 'rgba(198,255,61,0.55)');
    grad.addColorStop(1, 'rgba(198,255,61,0.02)');
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x < w; x++) {
      const f0 = fMin * Math.pow(fMax / fMin, x / w), f1 = fMin * Math.pow(fMax / fMin, (x + 1) / w);
      const b0 = Math.max(1, Math.floor((f0 / data.sr) * data.N)), b1 = Math.max(b0 + 1, Math.floor((f1 / data.sr) * data.N));
      let mx = -200;
      for (let b = b0; b < b1 && b < data.spec.length; b++) mx = Math.max(mx, data.spec[b]);
      ctx.lineTo(x, Math.min(h, yOf(mx)));
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#c6ff3d';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (data.peakF > fMin) {
      const x = xOf(data.peakF);
      ctx.fillStyle = '#ffb020';
      ctx.fillRect(x - 1, 0, 2, h);
    }
  }, [data]);

  if (!doc || !data) return null;
  const L = data.loud;
  return (
    <Modal title="Frequency & loudness analysis" subtitle={`${doc.selection ? 'Selection' : 'Whole file'} · ${formatTime(data.dur)}${data.partial ? ' (first 60 s)' : ''}`} onClose={close} icon={<BarChart3 size={18} />} wide>
      <div className="analysis">
        <div className="an-chart">
          <canvas
            ref={canvas}
            className="an-canvas"
            data-testid="analysis-chart"
            onPointerMove={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const f = 20 * Math.pow(data.sr / 2 / 20, (e.clientX - r.left) / r.width);
              const b = Math.min(data.spec.length - 1, Math.round((f / data.sr) * data.N));
              setHover({ f, db: data.spec[b] });
            }}
            onPointerLeave={() => setHover(null)}
          />
          <div className="an-readout">{hover ? `${hover.f < 1000 ? hover.f.toFixed(0) : (hover.f / 1000).toFixed(2) + 'k'} Hz · ${hover.db.toFixed(1)} dB · ${noteName(hover.f)}` : 'Hover the graph to read frequencies'}</div>
        </div>
        <dl className="an-stats" data-testid="analysis-stats">
          <div><dt>Dominant frequency</dt><dd data-testid="peak-freq">{data.peakF.toFixed(1)} Hz</dd></div>
          <div><dt>Musical note</dt><dd>{noteName(data.peakF)}</dd></div>
          <div><dt>Integrated loudness</dt><dd data-testid="lufs">{Number.isFinite(L.integrated) ? `${L.integrated.toFixed(1)} LUFS` : '—'}</dd></div>
          <div><dt>Loudness range</dt><dd>{L.range.toFixed(1)} LU</dd></div>
          <div><dt>True peak</dt><dd>{Number.isFinite(L.truePeak) ? `${L.truePeak.toFixed(1)} dBTP` : '—'}</dd></div>
          <div><dt>Sample peak / RMS</dt><dd>{formatDb(data.st.peakDb)} / {formatDb(data.st.rmsDb)}</dd></div>
        </dl>
        <p className="muted an-hint">Streaming platforms aim for about −14 LUFS, podcasts −16, broadcast −23. Use <strong>Levels → Loudness</strong> to match a target.</p>
      </div>
    </Modal>
  );
}
