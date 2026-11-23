import { useState } from 'react';
import { Download } from 'lucide-react';
import { Modal } from './Modal';
import { useEditor } from '../../store/editor';
import { length, resample, slice, toMono, toStereo, AudioData } from '../../audio/buffer';
import { encodeWav, WavBitDepth } from '../../audio/wav';
import { encodeMp3 } from '../../audio/mp3';
import { formatBytes, formatTime } from '../../app/format';
import { saveFile } from '../../app/platform';
import { useSettings } from '../../store/settings';

export type ExportFormat = 'wav' | 'mp3';

export interface ExportOptions {
  format: ExportFormat;
  bitDepth: WavBitDepth;
  bitrate: number;
  sampleRate: number | 'keep';
  channels: 'keep' | 'mono' | 'stereo';
}

export function renderExport(src: AudioData, o: ExportOptions): { blob: Blob; ext: string } {
  let a = src;
  if (o.channels === 'mono') a = toMono(a);
  else if (o.channels === 'stereo') a = toStereo(a);
  if (o.sampleRate !== 'keep') a = resample(a, o.sampleRate);
  if (o.format === 'mp3') {
    const bytes = encodeMp3(a, o.bitrate);
    return { blob: new Blob([bytes as BlobPart], { type: 'audio/mpeg' }), ext: 'mp3' };
  }
  return { blob: new Blob([encodeWav(a, o.bitDepth)], { type: 'audio/wav' }), ext: 'wav' };
}

export function estimateSize(a: AudioData, o: ExportOptions): number {
  const sec = length(a) / a.sampleRate;
  const ch = o.channels === 'keep' ? a.channels.length : o.channels === 'mono' ? 1 : 2;
  const sr = o.sampleRate === 'keep' ? a.sampleRate : o.sampleRate;
  return o.format === 'mp3' ? (sec * o.bitrate * 1000) / 8 : 44 + sec * sr * ch * (o.bitDepth / 8);
}

export function ExportDialog() {
  const doc = useEditor((s) => s.active());
  const [name, setName] = useState(doc?.name ?? 'vipad-audio');
  const [onlySel, setOnlySel] = useState(false);
  const [o, setO] = useState<ExportOptions>(() => {
    const s = useSettings.getState();
    return { format: s.exportFormat, bitDepth: s.wavBitDepth, bitrate: s.mp3Bitrate, sampleRate: 'keep', channels: 'keep' };
  });
  const close = () => useEditor.getState().setDialog(null);
  if (!doc) return null;
  const src = onlySel && doc.selection ? slice(doc.audio, doc.selection) : doc.audio;

  const doExport = async () => {
    const st = useEditor.getState();
    close();
    st.setDialog(null);
    useEditor.setState({ busy: 'Encoding…' });
    await new Promise((r) => setTimeout(r, 30));
    try {
      const { blob, ext } = renderExport(src, o);
      const file = `${(name || 'vipad-audio').replace(/[\\/:*?"<>|]/g, '_')}.${ext}`;
      const how = await saveFile(blob, file);
      st.toast(how === 'downloaded' ? `Exported ${file}` : `Saved ${file}`, 'success');
    } catch (e) {
      st.toast(`Export failed: ${(e as Error).message}`, 'error');
    } finally {
      useEditor.setState({ busy: null });
    }
  };

  return (
    <Modal
      title="Export audio"
      subtitle={`${formatTime(length(src) / src.sampleRate)} · est. ${formatBytes(estimateSize(src, o))}`}
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
        <div className="grid-2">
          <label className="field">
            <span className="field-label">Sample rate</span>
            <select value={String(o.sampleRate)} onChange={(e) => setO({ ...o, sampleRate: e.target.value === 'keep' ? 'keep' : Number(e.target.value) })}>
              <option value="keep">Keep ({doc.audio.sampleRate} Hz)</option>
              {[8000, 16000, 22050, 32000, 44100, 48000, 96000].map((r) => (
                <option key={r} value={r}>{r} Hz</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Channels</span>
            <select value={o.channels} onChange={(e) => setO({ ...o, channels: e.target.value as ExportOptions['channels'] })}>
              <option value="keep">Keep ({doc.audio.channels.length === 1 ? 'mono' : 'stereo'})</option>
              <option value="mono">Mono</option>
              <option value="stereo">Stereo</option>
            </select>
          </label>
        </div>
        {doc.selection && (
          <label className="check">
            <input type="checkbox" checked={onlySel} onChange={(e) => setOnlySel(e.target.checked)} /> Export selection only
          </label>
        )}
      </div>
    </Modal>
  );
}
