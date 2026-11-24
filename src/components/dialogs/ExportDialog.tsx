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
  ExportOptions, ExportFormat, renderExport, estimateSize, effectiveRate, effectiveChannels, effectiveDepth, effectiveBitrate, isValidRate,
  MIN_RATE, MAX_RATE, RATE_PRESETS, FORMATS, FORMAT_ORDER, availableFormats,
} from '../../audio/exporter';
import { Tags } from '../../audio/codecs/tags';
import { useEffect } from 'react';

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
            {FORMATS[format].rates && !FORMATS[format].rates!.includes(r) ? ` (not for ${FORMATS[format].label})` : ''}
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
/** Formats this device can write, detected once (platform encoders vary by OS/browser). */
export function useFormats(): ExportFormat[] {
  const [list, setList] = useState<ExportFormat[]>(FORMAT_ORDER.filter((f) => !FORMATS[f].platform));
  useEffect(() => { void availableFormats().then(setList); }, []);
  return list;
}

export function FormatSelect({ value, onChange, formats }: { value: ExportFormat; onChange: (f: ExportFormat) => void; formats: ExportFormat[] }) {
  const groups = [...new Set(FORMAT_ORDER.map((f) => FORMATS[f].group))];
  return (
    <label className="field">
      <span className="field-label">Format</span>
      <select value={value} onChange={(e) => onChange(e.target.value as ExportFormat)} data-testid="export-format">
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {FORMAT_ORDER.filter((f) => FORMATS[f].group === g && formats.includes(f)).map((f) => (
              <option key={f} value={f}>{FORMATS[f].label} (.{FORMATS[f].ext})</option>
            ))}
          </optgroup>
        ))}
      </select>
      <small className="field-hint">{FORMATS[value].description}</small>
    </label>
  );
}

const DEPTH_LABEL: Record<number, string> = { 8: '8-bit', 16: '16-bit (CD quality)', 24: '24-bit (studio)', 32: '32-bit float' };

function QualityField({ o, setO }: { o: ExportOptions; setO: (o: ExportOptions) => void }) {
  const f = FORMATS[o.format];
  if (f.bitrates) {
    const b = effectiveBitrate(o);
    return (
      <label className="field">
        <span className="field-label">Bitrate</span>
        <select value={b} onChange={(e) => setO({ ...o, bitrate: Number(e.target.value) })} data-testid="export-bitrate">
          {f.bitrates.map((x) => <option key={x} value={x}>{x} kbps{x === 192 && o.format === 'mp3' ? ' (recommended)' : x === 96 && o.format !== 'mp3' && o.format !== 'm4a' ? ' (great for voice)' : ''}</option>)}
        </select>
      </label>
    );
  }
  const { bits, encoding } = effectiveDepth(o);
  const value = encoding === 'pcm' ? String(bits) : encoding;
  return (
    <label className="field">
      <span className="field-label">{o.format === 'raw' ? 'Sample format' : 'Bit depth'}</span>
      <select
        value={value}
        data-testid="export-depth"
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'ulaw' || v === 'alaw') setO({ ...o, encoding: v });
          else setO({ ...o, encoding: 'pcm', bitDepth: Number(v) as WavBitDepth });
        }}
      >
        {f.bitDepths!.map((d) => <option key={d} value={d}>{o.format === 'raw' ? (d === 16 ? '16-bit signed, little-endian' : '32-bit float, little-endian') : DEPTH_LABEL[d]}</option>)}
        {f.encodings?.includes('ulaw') && <option value="ulaw">8-bit µ-law (telephony)</option>}
        {f.encodings?.includes('alaw') && <option value="alaw">8-bit A-law (telephony)</option>}
      </select>
    </label>
  );
}

function TagFields({ tags, onChange }: { tags: Tags; onChange: (t: Tags) => void }) {
  const field = (k: keyof Tags, label: string, ph = '') => (
    <label className="field" key={k}>
      <span className="field-label">{label}</span>
      <input className="text-input" value={tags[k] ?? ''} placeholder={ph} onChange={(e) => onChange({ ...tags, [k]: e.target.value })} data-testid={`tag-${k}`} />
    </label>
  );
  return (
    <details className="tags-box">
      <summary>Metadata — title, artist, album…</summary>
      <div className="grid-2">
        {field('title', 'Title')}
        {field('artist', 'Artist')}
        {field('album', 'Album')}
        {field('year', 'Year', '2026')}
        {field('genre', 'Genre', 'Podcast')}
        {field('comment', 'Comment')}
      </div>
    </details>
  );
}

export function ExportDialog() {
  const doc = useEditor((s) => s.active());
  const formats = useFormats();
  const [name, setName] = useState(doc?.name ?? 'vipad-audio');
  const [onlySel, setOnlySel] = useState(false);
  const [o, setO] = useState<ExportOptions>(() => {
    const s = useSettings.getState();
    return { format: s.exportFormat as ExportFormat, bitDepth: s.wavBitDepth, bitrate: s.mp3Bitrate, sampleRate: s.exportSampleRate, channels: s.exportChannels, encoding: 'pcm', tags: { title: doc?.name ?? '' } };
  });
  const close = () => useEditor.getState().setDialog(null);
  useEffect(() => {
    if (!formats.includes(o.format) && formats.length && !FORMATS[o.format].platform) return;
    if (!formats.includes(o.format) && formats.length) setO((x) => ({ ...x, format: 'mp3' }));
  }, [formats, o.format]);
  if (!doc) return null;
  const src = onlySel && doc.selection ? slice(doc.audio, doc.selection) : doc.audio;
  const f = FORMATS[o.format];
  const outRate = effectiveRate(src.sampleRate, o);
  const outCh = effectiveChannels(src, o);
  const wantedRate = o.sampleRate === 'keep' ? src.sampleRate : o.sampleRate;
  const rateLimited = !!f.rates && wantedRate !== outRate;

  const doExport = async () => {
    const st = useEditor.getState();
    close();
    useEditor.setState({ busy: `Encoding ${f.label} · ${outCh === 1 ? 'mono' : 'stereo'} · ${khz(outRate)}…` });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const { blob, ext } = await renderExport(src, o, (p) => useEditor.setState({ busy: `Encoding ${f.label}… ${Math.round(p * 100)}%` }));
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
      subtitle={`${formatTime(length(src) / src.sampleRate)} · ${f.label} · ${outCh === 1 ? 'Mono' : 'Stereo'} · ${khz(outRate)} · est. ${formatBytes(estimateSize(src, o))}`}
      onClose={close}
      icon={<Download size={18} />}
      wide
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={close}>Cancel</button>
          <button className="btn btn-primary" onClick={doExport} data-testid="export-confirm" disabled={!length(src)}>
            <Download size={16} /> Export {f.label}
          </button>
        </>
      }
    >
      <div className="params">
        <div className="grid-2">
          <label className="field">
            <span className="field-label">File name</span>
            <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} data-testid="export-name" />
          </label>
          <FormatSelect value={o.format} onChange={(format) => setO({ ...o, format })} formats={formats} />
        </div>
        <div className="quick-formats" role="radiogroup" aria-label="Quick format">
          {(['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aiff'] as ExportFormat[]).filter((x) => formats.includes(x)).map((x) => (
            <button key={x} role="radio" aria-checked={o.format === x} className={o.format === x ? 'on' : ''} onClick={() => setO({ ...o, format: x })} data-testid={`fmt-${x}`}>{FORMATS[x].label.split(' ')[0]}</button>
          ))}
        </div>
        <div className="grid-3">
          <ChannelsField value={o.channels} onChange={(channels) => setO({ ...o, channels })} original={src.channels.length} />
          <RateField value={o.sampleRate} onChange={(sampleRate) => setO({ ...o, sampleRate })} original={src.sampleRate} format={o.format} />
          <QualityField o={o} setO={setO} />
        </div>
        {rateLimited && (
          <div className="note" role="status" data-testid="mp3-rate-note">
            <AlertTriangle size={16} />
            <span>
              {f.label} {f.rates!.length === 1 ? `always uses ${khz(f.rates![0])}` : `supports at most ${khz(f.rates![f.rates!.length - 1])}`}, so this file will be saved at {khz(outRate)}. Choose <button className="link-btn" onClick={() => setO({ ...o, format: 'wav' })}>WAV</button> or <button className="link-btn" onClick={() => setO({ ...o, format: 'flac' })}>FLAC</button> to export at {khz(wantedRate)}.
            </span>
          </div>
        )}
        {f.tags ? <TagFields tags={o.tags ?? {}} onChange={(tags) => setO({ ...o, tags })} /> : <small className="field-hint">{f.label} files are saved without metadata tags.</small>}
        {doc.selection && (
          <label className="check">
            <input type="checkbox" checked={onlySel} onChange={(e) => setOnlySel(e.target.checked)} /> Export selection only
          </label>
        )}
      </div>
    </Modal>
  );
}
