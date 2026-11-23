import { useEffect, useRef } from 'react';
import { player } from '../audio/player';

/** Live stereo peak meters fed by the playback analysers. */
export function LevelMeters() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    const buf = new Float32Array(1024);
    const hold = [0, 0];
    const level = [0, 0];
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const ans = [player.analyserL, player.analyserR];
      const bh = (h - 3) / 2;
      ans.forEach((an, i) => {
        let pk = 0;
        if (an && player.playing) {
          an.getFloatTimeDomainData(buf);
          for (const v of buf) pk = Math.max(pk, Math.abs(v));
        }
        level[i] = Math.max(pk, level[i] * 0.88);
        hold[i] = Math.max(level[i], hold[i] * 0.995);
        const db = level[i] > 0 ? 20 * Math.log10(level[i]) : -60;
        const frac = Math.max(0, Math.min(1, (db + 60) / 60));
        const y = i * (bh + 3);
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, y, w, bh);
        const g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, '#5e7d10');
        g.addColorStop(0.75, '#c6ff3d');
        g.addColorStop(0.9, '#ffd23d');
        g.addColorStop(1, '#ff4d4d');
        ctx.fillStyle = g;
        ctx.fillRect(0, y, w * frac, bh);
        const hdb = hold[i] > 0 ? 20 * Math.log10(hold[i]) : -60;
        const hx = Math.max(0, Math.min(1, (hdb + 60) / 60)) * w;
        ctx.fillStyle = hdb > -0.5 ? '#ff4d4d' : '#f3f4ee';
        ctx.fillRect(hx - 1, y, 2, bh);
      });
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="meters" aria-label="Output level meters" role="img" />;
}

/** Real-time FFT spectrum analyser. */
export function Spectrum() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let raf = 0;
    let data = new Float32Array(2048);
    const smooth = new Float32Array(96).fill(-100);
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth, h = c.clientHeight;
      if (c.width !== Math.round(w * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const an = player.analyser;
      const bands = smooth.length;
      if (an && player.playing) {
        if (data.length !== an.frequencyBinCount) data = new Float32Array(an.frequencyBinCount);
        an.getFloatFrequencyData(data);
        const sr = player.ctx?.sampleRate ?? 48000;
        for (let b = 0; b < bands; b++) {
          const f0 = 30 * Math.pow(18000 / 30, b / bands);
          const f1 = 30 * Math.pow(18000 / 30, (b + 1) / bands);
          const i0 = Math.floor((f0 / (sr / 2)) * data.length);
          const i1 = Math.max(i0 + 1, Math.floor((f1 / (sr / 2)) * data.length));
          let m = -140;
          for (let i = i0; i < i1 && i < data.length; i++) m = Math.max(m, data[i]);
          smooth[b] = Math.max(m, smooth[b] - 1.5);
        }
      } else {
        for (let b = 0; b < bands; b++) smooth[b] = Math.max(-100, smooth[b] - 2);
      }
      ctx.strokeStyle = '#1c1c1c';
      for (let k = 1; k < 4; k++) {
        ctx.beginPath();
        ctx.moveTo(0, (h * k) / 4 + 0.5);
        ctx.lineTo(w, (h * k) / 4 + 0.5);
        ctx.stroke();
      }
      const bw = w / bands;
      for (let b = 0; b < bands; b++) {
        const v = Math.max(0, Math.min(1, (smooth[b] + 100) / 80));
        const bh = v * h;
        ctx.fillStyle = `rgba(198,255,61,${0.35 + v * 0.65})`;
        ctx.fillRect(b * bw + 0.5, h - bh, Math.max(1, bw - 1.5), bh);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="spectrum" aria-label="Frequency spectrum" role="img" />;
}
