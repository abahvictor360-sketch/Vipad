import { useState } from 'react';
import { AudioWaveform, Play, Square } from 'lucide-react';
import { Modal } from './Modal';
import { ParamControls } from './ParamControls';
import { ParamDef, Params } from '../../audio/effects';
import { tone, noise, dtmf, Waveform, NoiseColor } from '../../audio/generators';
import { createSilence, AudioData } from '../../audio/buffer';
import { useEditor } from '../../store/editor';
import { player } from '../../audio/player';

type Kind = 'tone' | 'noise' | 'silence' | 'dtmf';

const DEFS: Record<Kind, { title: string; desc: string; params: ParamDef[] }> = {
  tone: {
    title: 'Generate Tone',
    desc: 'Create a test tone or synth wave.',
    params: [
      { key: 'freq', label: 'Frequency', type: 'number', min: 20, max: 20000, step: 1, default: 440, unit: 'Hz' },
      { key: 'duration', label: 'Duration', type: 'number', min: 0.1, max: 600, step: 0.1, default: 3, unit: 's' },
      { key: 'level', label: 'Level', type: 'number', min: -60, max: 0, step: 0.5, default: -6, unit: 'dB' },
      {
        key: 'wave',
        label: 'Waveform',
        type: 'select',
        default: 'sine',
        options: [
          { value: 'sine', label: 'Sine' },
          { value: 'square', label: 'Square' },
          { value: 'sawtooth', label: 'Sawtooth' },
          { value: 'triangle', label: 'Triangle' },
        ],
      },
    ],
  },
  noise: {
    title: 'Generate Noise',
    desc: 'White, pink or brown noise — great for testing or masking.',
    params: [
      { key: 'duration', label: 'Duration', type: 'number', min: 0.1, max: 600, step: 0.1, default: 3, unit: 's' },
      { key: 'level', label: 'Level', type: 'number', min: -60, max: 0, step: 0.5, default: -12, unit: 'dB' },
      {
        key: 'color',
        label: 'Colour',
        type: 'select',
        default: 'pink',
        options: [
          { value: 'white', label: 'White' },
          { value: 'pink', label: 'Pink' },
          { value: 'brown', label: 'Brown' },
        ],
      },
    ],
  },
  silence: {
    title: 'Insert Silence',
    desc: 'Insert a gap of silence at the cursor (or replace the selection).',
    params: [{ key: 'duration', label: 'Duration', type: 'number', min: 0.01, max: 600, step: 0.01, default: 1, unit: 's' }],
  },
  dtmf: {
    title: 'Generate DTMF Tones',
    desc: 'Telephone keypad tones.',
    params: [
      { key: 'tone', label: 'Tone length', type: 'number', min: 40, max: 1000, step: 10, default: 120, unit: 'ms' },
      { key: 'gap', label: 'Gap', type: 'number', min: 20, max: 1000, step: 10, default: 80, unit: 'ms' },
    ],
  },
};

export function GenerateDialog({ kind }: { kind: Kind }) {
  const def = DEFS[kind];
  const doc = useEditor((s) => s.active());
  const [params, setParams] = useState<Params>(() => Object.fromEntries(def.params.map((p) => [p.key, p.default])));
  const [digits, setDigits] = useState('0123456789*#');
  const [previewing, setPreviewing] = useState(false);
  const sr = doc?.audio.sampleRate ?? 48000;
  const ch = doc?.audio.channels.length ?? 2;

  const build = (): AudioData => {
    const d = Number(params.duration);
    switch (kind) {
      case 'tone':
        return tone(sr, ch, d, Number(params.freq), Number(params.level), params.wave as Waveform);
      case 'noise':
        return noise(sr, ch, d, params.color as NoiseColor, Number(params.level), Date.now() & 0xffff);
      case 'silence':
        return createSilence(sr, ch, d * sr);
      case 'dtmf':
        return dtmf(sr, ch, digits, Number(params.tone), Number(params.gap));
    }
  };

  const close = () => {
    player.stop();
    useEditor.getState().setDialog(null);
  };

  return (
    <Modal
      title={def.title}
      subtitle={def.desc}
      onClose={close}
      icon={<AudioWaveform size={18} />}
      footer={
        <>
          {kind !== 'silence' && (
            <button
              className="btn btn-secondary"
              onClick={() => {
                if (previewing) { player.stop(); setPreviewing(false); return; }
                const a = build();
                player.preview({ sampleRate: a.sampleRate, channels: a.channels.map((c) => c.subarray(0, sr * 5)) });
                setPreviewing(true);
                const u = player.subscribe(() => { if (!player.playing) { setPreviewing(false); u(); } });
              }}
            >
              {previewing ? <Square size={16} /> : <Play size={16} />} {previewing ? 'Stop' : 'Preview'}
            </button>
          )}
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={close}>Cancel</button>
          <button
            className="btn btn-primary"
            data-testid="generate-insert"
            onClick={() => {
              const a = build();
              close();
              useEditor.getState().insertAudio(def.title.replace('Generate ', ''), a);
            }}
          >
            {doc ? 'Insert' : 'Create'}
          </button>
        </>
      }
    >
      {kind === 'dtmf' && (
        <label className="field">
          <span className="field-label">Digits</span>
          <input className="text-input" value={digits} onChange={(e) => setDigits(e.target.value.replace(/[^0-9*#A-Da-d]/g, ''))} />
        </label>
      )}
      <ParamControls defs={def.params} values={params} onChange={setParams} />
    </Modal>
  );
}
