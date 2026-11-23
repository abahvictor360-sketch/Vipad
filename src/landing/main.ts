import { wireCommon, currentOS, OS_NAMES, reduced } from './shared';
import './download.css';

wireCommon();

// hero + teaser buttons go to the download page with the visitor's platform pre-selected
const os = currentOS();
const heroBtn = document.getElementById('hero-download') as HTMLAnchorElement;
heroBtn.textContent = os === 'web' ? 'Download Vipad' : `Download for ${OS_NAMES[os]}`;
heroBtn.href = `./download.html#${os}`;

// ---- canvas helpers
function fit(c: HTMLCanvasElement) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = c.clientWidth, h = c.clientHeight;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

function animate(c: HTMLCanvasElement, draw: (ctx: CanvasRenderingContext2D, w: number, h: number, t: number) => void) {
  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(c);
  const loop = (t: number) => {
    if (visible) { const { ctx, w, h } = fit(c); draw(ctx, w, h, t / 1000); }
    if (!reduced) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// Hero: flowing ribbon of sound waves (lime → green) like a voice spectrogram
const waves = document.getElementById('waves') as HTMLCanvasElement;
animate(waves, (ctx, w, h, t) => {
  ctx.clearRect(0, 0, w, h);
  const lines = 46;
  const mid = h / 2;
  for (let i = 0; i < lines; i++) {
    const k = i / (lines - 1);
    const hue = 75 + k * 60; // lime → green/teal
    ctx.strokeStyle = `hsla(${hue}, 100%, ${55 + 10 * Math.sin(k * 3)}%, ${0.08 + 0.32 * Math.sin(Math.PI * k)})`;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 6) {
      const u = x / w;
      const env = Math.pow(Math.sin(Math.PI * u), 1.6) * (0.55 + 0.45 * Math.exp(-Math.pow((u - 0.5) * 3.2, 2)));
      const y =
        mid +
        env * h * 0.36 * (Math.sin(u * 9 + t * 1.3 + k * 2.2) * 0.55 + Math.sin(u * 23 - t * 1.9 + k * 4) * 0.25 + Math.sin(u * 4 + t * 0.6 + k * 6) * 0.35) *
          (k - 0.5) * 2;
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
});

// Feature card mini waveform bars
document.querySelectorAll<HTMLCanvasElement>('[data-miniwave]').forEach((c) => {
  animate(c, (ctx, w, h, t) => {
    ctx.clearRect(0, 0, w, h);
    const n = Math.floor(w / 6);
    const s0 = Math.floor(n * 0.35), s1 = Math.floor(n * 0.62);
    ctx.fillStyle = 'rgba(198,255,61,.12)';
    ctx.fillRect(s0 * 6, 0, (s1 - s0) * 6, h);
    for (let i = 0; i < n; i++) {
      const v = 0.15 + 0.85 * Math.abs(Math.sin(i * 0.45 + t * 2) * Math.sin(i * 0.13 + t * 0.7));
      const bh = v * h * 0.85;
      ctx.fillStyle = i >= s0 && i < s1 ? '#c6ff3d' : '#4f5a2c';
      ctx.fillRect(i * 6, (h - bh) / 2, 3.5, bh);
    }
  });
});

// How-it-works: particle field converging to play button
const how = document.getElementById('how-canvas') as HTMLCanvasElement;
const pts = Array.from({ length: 140 }, (_, i) => ({ a: (i / 140) * Math.PI * 2 * 7, r: Math.random(), s: 0.2 + Math.random() * 0.8 }));
animate(how, (ctx, w, h, t) => {
  ctx.clearRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  for (const p of pts) {
    const rr = ((p.r + t * 0.05 * p.s) % 1);
    const R = (1 - rr) * Math.max(w, h) * 0.55;
    const x = cx + Math.cos(p.a + t * 0.1) * R;
    const y = cy + Math.sin(p.a + t * 0.1) * R * 0.55;
    ctx.fillStyle = `rgba(198,255,61,${0.15 + rr * 0.7})`;
    ctx.beginPath();
    ctx.arc(x, y, 1 + rr * 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
});
