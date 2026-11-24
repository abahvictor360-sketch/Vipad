import { useEffect, useState } from 'react';
import { Circle, Mic, Square } from 'lucide-react';
import { useRecording } from '../store/recording';
import { formatTime } from '../app/format';

/** Top-bar Record button that turns into a pulsing REC indicator with a live mic level while recording. */
export function RecBadge() {
  const { status, start, stop } = useRecording();
  const active = status === 'recording' || status === 'paused' || status === 'saving' || status === 'countdown';
  const [t, setT] = useState(0);
  const [lvl, setLvl] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      const r = useRecording.getState().recorder;
      if (r) { setT(r.seconds); setLvl(Math.max(...r.levels, 0)); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  if (!active) {
    return (
      <button className="btn btn-rec btn-sm" onClick={() => void start('auto')} disabled={status === 'starting'} data-testid="topbar-record">
        <Circle size={12} fill="currentColor" /> <span className="hide-sm">{status === 'starting' ? 'Starting…' : 'Record'}</span>
      </button>
    );
  }
  const db = lvl > 1e-5 ? 20 * Math.log10(lvl) : -60;
  const bars = 5;
  const lit = Math.round(Math.max(0, Math.min(1, (db + 50) / 50)) * bars);
  return (
    <button className={`rec-badge ${status === 'paused' ? 'paused' : ''}`} onClick={() => void stop()} title="Stop recording" data-testid="rec-badge">
      <span className="rec-badge-dot" aria-hidden />
      <Mic size={14} aria-hidden />
      <span className="mic-bars" aria-hidden>
        {Array.from({ length: bars }, (_, i) => <i key={i} className={i < lit ? 'on' : ''} style={{ height: `${35 + i * 13}%` }} />)}
      </span>
      <span className="rec-badge-time">{status === 'paused' ? 'PAUSED' : 'REC'} {formatTime(t, false)}</span>
      <Square size={11} fill="currentColor" aria-hidden />
    </button>
  );
}
