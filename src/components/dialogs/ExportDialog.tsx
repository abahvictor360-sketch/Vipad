import { useState } from 'react';
import { Download, AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { useEditor } from '../../store/editor';
import { length, slice } from '../../audio/buffer';
import { WavBitDepth } from '../../audio/wav';
import { formatBytes, formatTime } from '../../app/format';
import { saveFile } from '../../app/platform';
import { useSettings } from '../../store/settings';
import {
  ExportOptions, renderExport, estimateSize, effectiveRate, effectiveChannels, isValidRate,
  MIN_RATE, MAX_RATE, MP3_MAX_RATE, RATE_PRESETS,
} from '../../audio/exporter';

export type { ExportFormat, ExportOptions } from '../../audio/exporter';
export { renderExport, estimateSize } from '../../audio/exporter';

const khz = (hz: number) => `${(hz / 1000).toLocaleString(undefined, { maximumFractionDigits: 3 })} kHz`;

/** Sample-rate picker: original, presets 11.025–225 kHz, or any custom value 10–225 kHz. */
export function RateField({ value, onChange, original, format }: { value: number | 'keep'; onChange: (v: number | 'keep') => void; original: number; format: ExportOptions['format'] }) {
  const isPreset = value === 'keep' || RATE_PRESETS.includes(value);
  const [custom, setCustom] = useState(!isPreset);
  const [text, setText] = useState(value === 'keep' ? String(original) : String(value));
  const num = Number(text);
  const invalid = custom && !isValidRate(num);
  return (
    <div className="field">
      <label className="field-label" htmlFor="rate-select">Sample rate</label>
      <select
        id="rate-select"
        data-testid="export-rate"
        value={custom ? 'custom' : String(value)}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'custom') { setCustom(true); setText(String(value === 'keep' ? original : value)); onChange(value === 'keep' ? original : value); return; }
          setCustom(false);
          onChange(v === 'keep' ? 'keep' : Number(v));
        }}
      >
        <option value="keep">Original ({khz(original)})</option>
        {RATE_PRESETS.map((r) => (
          <option key={r} value={r}>
            {khz(r)}{r === 44100 ? ' — CD' : r === 48000 ? ' — video' : r === 96000 ? ' — hi-res' : r === 192000 ? ' — studio' : r === 225000 ? ' — maximum' : ''}
            {format === 'mp3' && r > MP3_MAX_RATE ? ' (WAV only)' : ''}
          </option>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {custom && (
        <div className="rate-custom">
          <input
            className="text-input"
            type="number"
            inputMode="numeric"
            min={MIN_RATE}
            max={MAX_RATE}
            step={1}
            value={text}
            aria-label="Custom sample rate in hertz"
            aria-invalid={invalid}
            data-testid="export-rate-custom"
            onChange={(e) => {
              setText(e.target.value);
              const n = Number(e.target.value);
              if (isValidRate(n)) onChange(Math.round(n));
            }}
          />
          <em>Hz</em>
        </div>
      )}
      {invalid && <p className="field-error" role="alert">Enter a rate from {MIN_RATE.toLocaleString()} to {MAX_RATE.toLocaleString()} Hz (10–225 kHz).</p>}
    </div>
  );
}

export function ChannelsField({ value, onChange, original }: { value: ExportOptions['channels']; onChange: (v: ExportOptions['channels']) => void; original: number }) {
  const current = value === 'keep' ? (original === 1 ? 'mono' : 'stereo') : value;
  return (
    <div className="field">
      <span className="field-label" id="ch-label">Channels</span>
      <div className="segmented" role="radiogroup" aria-labelledby="ch-label">
        {(['mono', 'stereo'] as const).map((c) => (
          <button key={c} role="radio" aria-checked={current === c} className={current === c ? 'on' : ''} onClick={() => onChange(c)} data-testid={`ch-${c}`}>
            {c === 'mono' ? 'Mono' : 'Stereo'}
          </button>
        ))}
      </div>
      <small className="field-hint">
        {current === 'mono' ? (original === 1 ? 'Original is mono.' : 'Left and right are mixed into one channel — half the size.') : original === 1 ? 'The mono signal is copied to both left and right.' : 'Keeps the original left/right image.'}
      </small>
    </div>
  );
}
export function ExportDialog() {
  const doc = useEditor((s) => s.active());
  const [name, setName] = useState(doc?.name ?? 'vipad-audio');
  const [onlySel, setOnlySel] = useState(false);
  const [o, setO] = useState<ExportOptions>(() => {
    const s = useSettings.getState();
    return { format: s.exportFormat, bitDepth: s.wavBitDepth, bitrate: s.mp3Bitrate, sampleRate: s.exportSampleRate, channels: s.exportChannels };
  });
  const close = () => useEditor.getState().setDialog(null);
  if (!doc) return null;
  const src = onlySel && doc.selection ? slice(doc.audio, doc.selection) : doc.audio;
  const outRate = effectiveRate(src.sampleRate, o);
  const outCh = effectiveChannels(src, o);
  const wantedRate = o.sampleRate === 'keep' ? src.sampleRate : o.sampleRate;
  const mp3Capped = o.format === 'mp3' && wantedRate !== outRate;

  const doExport = async () => {
    const st = useEditor.getState();
    close();
    useEditor.setState({ busy: `Encoding ${outCh === 1 ? 'mono' : 'stereo'} ${o.format.toUpperCase()} at ${khz(outRate)}…` });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const { blob, ext } = renderExport(src, o);
      const file = `${(name || 'vipad-audio').replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
      const how = await saveFile(blob, file);
      st.toast(`${how === 'downloaded' ? 'Exported' : 'Saved'} ${file} · ${outCh === 1 ? 'mono' : 'stereo'} · ${khz(outRate)}`, 'success');
    } catch (e) {
      st.toast(`Export failed: ${(e as Error).message}`, 'error');
    } finally {
      useEditor.setState({ busy: null });
    }
  };

  return (
    <Modal
      title="Export audio"
      subtitle={`${formatTime(length(src) / src.sampleRate)} · ${outCh === 1 ? 'Mono' : 'Stereo'} · ${khz(outRate)} · est. ${formatBytes(estimateSize(src, o))}`}
      onClose={close}
      icon={<Download size={18} />}
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={close}>Cancel</button>
          <button className="btn btn-primary" onClick={doExport} data-testid="export-confirm" disabled={!length(src)}>
            <Download size={16} /> Export
          </button>
        </>
      }
    >
      <div className="params">
        <label className="field">
          <span className="field-label">File name</span>
          <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} data-testid="export-name" />
        </label>
        <div className="grid-2">
          <div className="field">
            <span className="field-label">Format</span>
            <div className="segmented" role="radiogroup" aria-label="Format">
              {(['mp3', 'wav'] as const).map((f) => (
                <button key={f} role="radio" aria-checked={o.format === f} className={o.format === f ? 'on' : ''} onClick={() => setO({ ...o, format: f })} data-testid={`fmt-${f}`}>
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <ChannelsField value={o.channels} onChange={(channels) => setO({ ...o, channels })} original={src.channels.length} />
        </div>
        <div className="grid-2">
          <RateField value={o.sampleRate} onChange={(sampleRate) => setO({ ...o, sampleRate })} original={src.sampleRate} format={o.format} />
          {o.format === 'wav' ? (
            <label className="field">
              <span className="field-label">Bit depth</span>
              <select value={o.bitDepth} onChange={(e) => setO({ ...o, bitDepth: Number(e.target.value) as WavBitDepth })}>
                <option value={16}>16-bit PCM (CD quality)</option>
                <option value={24}>24-bit PCM (studio)</option>
                <option value={32}>32-bit float (lossless edit)</option>
                <option value={8}>8-bit PCM</option>
              </select>
            </label>
          ) : (
            <label className="field">
              <span className="field-label">Bitrate</span>
              <select value={o.bitrate} onChange={(e) => setO({ ...o, bitrate: Number(e.target.value) })}>
                {[64, 96, 128, 160, 192, 256, 320].map((b) => (
                  <option key={b} value={b}>{b} kbps{b === 192 ? ' (recommended)' : b === 320 ? ' (best)' : ''}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {mp3Capped && (
          <div className="note" role="status" data-testid="mp3-rate-note">
            <AlertTriangle size={16} />
            <span>MP3 supports at most 48 kHz, so this file will be saved at {khz(outRate)}. Choose <button className="link-btn" onClick={() => setO({ ...o, format: 'wav' })}>WAV</button> to export at {khz(wantedRate)}.</span>
          </div>
        )}
        {doc.selection && (
          <label className="check">
            <input type="checkbox" checked={onlySel} onChange={(e) => setOnlySel(e.target.checked)} /> Export selection only
          </label>
        )}
      </div>
    </Modal>
  );
}
