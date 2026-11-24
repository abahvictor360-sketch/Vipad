import { useEffect, useRef, useState } from 'react';
import { Mic, RefreshCw } from 'lucide-react';
import { Recorder } from '../../audio/recorder';
import { useSettings } from '../../store/settings';
import { describeMicError } from '../../store/recording';

/** Microphone chooser with device names, permission prompt and a live test meter. */
export function MicPicker() {
  const micDeviceId = useSettings((s) => s.micDeviceId);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const ctx = useRef<AudioContext | null>(null);

  const refresh = () => Recorder.devices().then(setDevices).catch(() => setDevices([]));
  useEffect(() => {
    void refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', refresh);
    return () => {
      navigator.mediaDevices?.removeEventListener?.('devicechange', refresh);
      stopTest();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const labelsHidden = devices.length > 0 && devices.every((d) => !d.label);

  function stopTest() {
    stream.current?.getTracks().forEach((t) => t.stop());
    void ctx.current?.close().catch(() => undefined);
    stream.current = null;
    ctx.current = null;
    setTesting(false);
    setLevel(0);
  }

  async function startTest(deviceId = micDeviceId) {
    stopTest();
    setErr(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      stream.current = s;
      await refresh(); // names become visible once permission is granted
      const ac = new AudioContext();
      ctx.current = ac;
      const an = ac.createAnalyser();
      an.fftSize = 1024;
      ac.createMediaStreamSource(s).connect(an);
      const buf = new Float32Array(an.fftSize);
      setTesting(true);
      const loop = () => {
        if (ctx.current !== ac) return;
        an.getFloatTimeDomainData(buf);
        let pk = 0;
        for (const v of buf) pk = Math.max(pk, Math.abs(v));
        setLevel((l) => Math.max(pk, l * 0.85));
        requestAnimationFrame(loop);
      };
      loop();
    } catch (e) {
      setErr(describeMicError(e));
      setTesting(false);
    }
  }

  const db = level > 1e-5 ? 20 * Math.log10(level) : -90;
  return (
    <div className="field mic-picker">
      <label className="field-label" htmlFor="mic-select">Microphone</label>
      <div className="mic-row">
        <select
          id="mic-select"
          data-testid="mic-select"
          value={micDeviceId}
          onChange={(e) => {
            const d = devices.find((x) => x.deviceId === e.target.value);
            useSettings.getState().set({ micDeviceId: e.target.value, micLabel: d?.label ?? '' });
            if (testing) void startTest(e.target.value);
          }}
        >
          <option value="">System default</option>
          {devices.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Microphone ${i + 1}`}</option>
          ))}
        </select>
        <button className="icon-btn" title="Refresh device list" aria-label="Refresh microphones" onClick={() => void refresh()}><RefreshCw size={16} /></button>
      </div>
      {labelsHidden && <small className="field-hint">Device names appear after you allow microphone access — press <strong>Test microphone</strong>.</small>}
      <div className="mic-test">
        <button className={`btn btn-sm ${testing ? 'btn-secondary' : 'btn-ghost'}`} onClick={() => (testing ? stopTest() : void startTest())} data-testid="mic-test">
          <Mic size={14} /> {testing ? 'Stop test' : 'Test microphone'}
        </button>
        <div className="meter-h mic-meter" role="meter" aria-label="Microphone level" aria-valuemin={-60} aria-valuemax={0} aria-valuenow={Math.round(db)} data-testid="mic-test-meter">
          <div className="meter-h-fill" style={{ width: `${Math.max(0, Math.min(100, ((db + 60) / 60) * 100))}%` }} />
          <span>{testing ? (db <= -89 ? '-∞' : `${db.toFixed(0)} dB`) : 'idle'}</span>
        </div>
      </div>
      {err && <div className="alert" role="alert">{err}</div>}
    </div>
  );
}
