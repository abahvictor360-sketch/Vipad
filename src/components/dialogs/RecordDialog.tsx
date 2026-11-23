import { useEffect, useRef, useState } from 'react';
import { Mic, Pause, Play, Square, Circle } from 'lucide-react';
import { Modal } from './Modal';
import { Recorder } from '../../audio/recorder';
import { useEditor } from '../../store/editor';
import { insert, mixInto, resample, matchChannels, length } from '../../audio/buffer';
import { saveToLibrary } from '../../audio/library';
import { formatTime } from '../../app/format';
import { player } from '../../audio/player';

type Dest = 'new' | 'insert' | 'overdub';
type Phase = 'idle' | 'recording' | 'paused' | 'saving';

export function RecordDialog() {
  const doc = useEditor((s) => s.active());
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [channels, setChannels] = useState<1 | 2>(1);
  const [voice, setVoice] = useState(false);
  const [dest, setDest] = useState<Dest>(doc ? 'insert' : 'new');
  const [phase, setPhase] = useState<Phase>('idle');
  const [secs, setSecs] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recorder | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const history = useRef<number[]>([]);

  useEffect(() => {
    Recorder.devices().then(setDevices).catch(() => setDevices([]));
  }, []);

  // animation loop for meter + rolling waveform
  useEffect(() => {
    if (phase !== 'recording' && phase !== 'paused') return;
    let raf = 0;
    const buf = new Float32Array(2048);
    const tick = () => {
      const r = rec.current;
      if (!r) return;
      setSecs(r.seconds);
      setLevel(r.peak);
      if (r.analyser) {
        r.analyser.getFloatTimeDomainData(buf);
        let pk = 0;
        for (const v of buf) pk = Math.max(pk, Math.abs(v));
        if (phase === 'recording') {
          history.current.push(pk);
          if (history.current.length > 400) history.current.shift();
        }
      }
      const c = canvas.current;
      if (c) {
        const dpr = window.devicePixelRatio || 1;
        const w = c.clientWidth, h = c.clientHeight;
        if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
        const ctx = c.getContext('2d')!;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#1b1b1b';
        ctx.fillRect(0, h / 2, w, 1);
        const hist = history.current;
        const bw = 3;
        const count = Math.floor(w / bw);
        ctx.fillStyle = phase === 'paused' ? '#5c6b2c' : '#c6ff3d';
        for (let i = 0; i < count; i++) {
          const v = hist[hist.length - count + i] ?? 0;
          const bh = Math.max(1, Math.min(1, v) * h * 0.95);
          ctx.fillRect(i * bw, (h - bh) / 2, bw - 1, bh);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const start = async () => {
    setError(null);
    player.stop();
    const r = new Recorder();
    try {
      await r.start({ deviceId: deviceId || undefined, channels, echoCancellation: voice, noiseSuppression: voice, autoGainControl: voice });
      rec.current = r;
      history.current = [];
      setPhase('recording');
      // labels become available after permission is granted
      Recorder.devices().then(setDevices).catch(() => undefined);
    } catch (e) {
      const err = e as DOMException;
      setError(
        err.name === 'NotAllowedError'
          ? 'Microphone permission was denied. Allow microphone access in your browser or system settings, then try again.'
          : err.name === 'NotFoundError'
            ? 'No microphone was found. Connect a microphone and try again.'
            : err.message || 'Could not start recording.',
      );
    }
  };

  const finish = async () => {
    const r = rec.current;
    if (!r) return;
    setPhase('saving');
    const audio = await r.stop();
    rec.current = null;
    const st = useEditor.getState();
    st.setDialog(null);
    if (!length(audio)) return st.toast('Recording was empty', 'error');
    const stamp = new Date();
    const name = `Recording ${stamp.toLocaleDateString()} ${stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    if (dest === 'new' || !doc) {
      const id = st.newDoc(name, audio);
      saveToLibrary(id, name, audio).catch(() => undefined);
    } else {
      const at = doc.selection?.start ?? doc.cursor;
      const clip = resample(matchChannels(audio, doc.audio.channels.length), doc.audio.sampleRate);
      st.edit(dest === 'overdub' ? 'Overdub recording' : 'Record', (a) => ({
        audio: dest === 'overdub' ? mixInto(a, at, clip) : insert(a, at, clip),
        selection: { start: at, end: at + length(clip) },
      }));
    }
    st.toast(`Recorded ${formatTime(length(audio) / audio.sampleRate)}`, 'success');
  };

  const cancel = async () => {
    if (rec.current) await rec.current.cancel();
    rec.current = null;
    useEditor.getState().setDialog(null);
  };

  const active = phase === 'recording' || phase === 'paused';
  const levelDb = level > 0 ? 20 * Math.log10(level) : -90;

  return (
    <Modal
      title={active ? (phase === 'paused' ? 'Paused' : 'Recording…') : 'New recording'}
      subtitle={active ? 'Press Stop to finish. Your take is saved to your library automatically.' : 'Choose your microphone and press record.'}
      onClose={cancel}
      icon={<Mic size={18} />}
      footer={
        active ? (
          <>
            <button className="btn btn-ghost" onClick={cancel}>Discard</button>
            <span className="spacer" />
            <button
              className="btn btn-secondary"
              data-testid="rec-pause"
              onClick={() => {
                if (phase === 'recording') { rec.current?.pause(); setPhase('paused'); }
                else { rec.current?.resume(); setPhase('recording'); }
              }}
            >
              {phase === 'paused' ? <Play size={16} /> : <Pause size={16} />} {phase === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button className="btn btn-primary" onClick={finish} data-testid="rec-stop">
              <Square size={16} /> Stop
            </button>
          </>
        ) : (
          <>
            <span className="spacer" />
            <button className="btn btn-ghost" onClick={cancel}>Cancel</button>
            <button className="btn btn-rec" onClick={start} disabled={phase === 'saving'} data-testid="rec-start">
              <Circle size={14} fill="currentColor" /> Record
            </button>
          </>
        )
      }
    >
      {active ? (
        <div className="rec-live">
          <div className={`rec-time ${phase === 'recording' ? 'is-live' : ''}`} data-testid="rec-time">
            <span className="rec-dot" aria-hidden /> {formatTime(secs)}
          </div>
          <canvas ref={canvas} className="rec-canvas" aria-hidden />
          <div className="meter-h" role="meter" aria-label="Input level" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.round(levelDb)}>
            <div className="meter-h-fill" style={{ width: `${Math.max(0, Math.min(100, ((levelDb + 60) / 60) * 100))}%` }} />
            <span>{levelDb <= -89 ? '-∞' : levelDb.toFixed(1)} dB</span>
          </div>
          {level >= 0.99 && <p className="warn-text">Clipping! Move further from the mic or lower input gain.</p>}
        </div>
      ) : (
        <div className="params">
          {error && <div className="alert" role="alert">{error}</div>}
          <label className="field">
            <span className="field-label">Microphone</span>
            <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="">System default</option>
              {devices.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
              ))}
            </select>
          </label>
          <div className="grid-2">
            <div className="field">
              <span className="field-label">Channels</span>
              <div className="segmented">
                <button className={channels === 1 ? 'on' : ''} onClick={() => setChannels(1)}>Mono</button>
                <button className={channels === 2 ? 'on' : ''} onClick={() => setChannels(2)}>Stereo</button>
              </div>
            </div>
            <div className="field">
              <span className="field-label">Record into</span>
              <select value={dest} onChange={(e) => setDest(e.target.value as Dest)}>
                <option value="new">New file</option>
                <option value="insert" disabled={!doc}>Current file at cursor</option>
                <option value="overdub" disabled={!doc}>Overdub (mix on top)</option>
              </select>
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={voice} onChange={(e) => setVoice(e.target.checked)} />
            Voice processing (echo cancel, noise suppression, auto gain) — best for calls, off for music
          </label>
        </div>
      )}
    </Modal>
  );
}
