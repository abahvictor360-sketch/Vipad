import { AudioData, length, toMono, clone } from './buffer';
import { linearFromDb, stats, findSoundBounds } from './analysis';
import {
  applyBiquad,
  biquadCoeffs,
  changeSpeed,
  dynamics,
  mapChannels,
  pitchShift,
  reverb,
  spectralDenoise,
  timeStretch,
} from './dsp';

export type ParamDef =
  | { key: string; label: string; type: 'number'; min: number; max: number; step: number; default: number; unit?: string }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[]; default: string };

export type Params = Record<string, number | string>;

export type EffectCategory = 'Volume' | 'Time & Pitch' | 'Filters & EQ' | 'Dynamics' | 'Restoration' | 'Special' | 'Channels';

export interface EffectDef {
  id: string;
  name: string;
  category: EffectCategory;
  description: string;
  params: ParamDef[];
  /**
   * 'replace' (default): processed audio replaces the selection (length may change).
   * 'mixTail': output keeps selection length; any extra tail is mixed over the audio that follows.
   */
  tailMode?: 'replace' | 'mixTail';
  /** Requires stereo material. */
  stereoOnly?: boolean;
  apply: (a: AudioData, p: Params) => AudioData;
}

const num = (p: Params, k: string) => Number(p[k]);

export function defaultParams(e: EffectDef): Params {
  const p: Params = {};
  for (const d of e.params) p[d.key] = d.default;
  return p;
}

const curveFn = (curve: string) => {
  switch (curve) {
    case 'exponential':
      return (t: number) => t * t;
    case 'logarithmic':
      return (t: number) => Math.sqrt(t);
    case 's-curve':
      return (t: number) => 0.5 - 0.5 * Math.cos(Math.PI * t);
    default:
      return (t: number) => t;
  }
};

const curveParam: ParamDef = {
  key: 'curve',
  label: 'Curve',
  type: 'select',
  default: 'linear',
  options: [
    { value: 'linear', label: 'Linear' },
    { value: 'exponential', label: 'Exponential' },
    { value: 'logarithmic', label: 'Logarithmic' },
    { value: 's-curve', label: 'S-Curve' },
  ],
};

export const EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EFFECTS: EffectDef[] = [
  // ---------------- Volume
  {
    id: 'amplify',
    name: 'Amplify',
    category: 'Volume',
    description: 'Raise or lower the volume by a fixed amount.',
    params: [{ key: 'gain', label: 'Gain', type: 'number', min: -40, max: 40, step: 0.5, default: 6, unit: 'dB' }],
    apply: (a, p) => {
      const g = linearFromDb(num(p, 'gain'));
      return mapChannels(a, (c) => c.map((v) => v * g));
    },
  },
  {
    id: 'normalize',
    name: 'Normalize',
    category: 'Volume',
    description: 'Scale audio so its loudest peak hits the target level.',
    params: [
      { key: 'target', label: 'Peak target', type: 'number', min: -24, max: 0, step: 0.1, default: -1, unit: 'dBFS' },
      {
        key: 'mode',
        label: 'Channels',
        type: 'select',
        default: 'linked',
        options: [
          { value: 'linked', label: 'Linked (keep balance)' },
          { value: 'independent', label: 'Independent' },
        ],
      },
    ],
    apply: (a, p) => {
      const target = linearFromDb(num(p, 'target'));
      if (p.mode === 'independent') {
        return mapChannels(a, (c) => {
          let pk = 0;
          for (const v of c) pk = Math.max(pk, Math.abs(v));
          const g = pk > 0 ? target / pk : 1;
          return c.map((v) => v * g);
        });
      }
      const pk = stats(a).peak;
      const g = pk > 0 ? target / pk : 1;
      return mapChannels(a, (c) => c.map((v) => v * g));
    },
  },
  {
    id: 'fadeIn',
    name: 'Fade In',
    category: 'Volume',
    description: 'Gradually raise volume from silence across the selection.',
    params: [curveParam],
    apply: (a, p) => {
      const n = length(a);
      const f = curveFn(String(p.curve));
      return mapChannels(a, (c) => c.map((v, i) => v * f(n > 1 ? i / (n - 1) : 1)));
    },
  },
  {
    id: 'fadeOut',
    name: 'Fade Out',
    category: 'Volume',
    description: 'Gradually lower volume to silence across the selection.',
    params: [curveParam],
    apply: (a, p) => {
      const n = length(a);
      const f = curveFn(String(p.curve));
      return mapChannels(a, (c) => c.map((v, i) => v * f(n > 1 ? 1 - i / (n - 1) : 0)));
    },
  },
  {
    id: 'envelope',
    name: 'Volume Ramp',
    category: 'Volume',
    description: 'Smoothly change volume from a start level to an end level.',
    params: [
      { key: 'from', label: 'Start level', type: 'number', min: -60, max: 12, step: 0.5, default: 0, unit: 'dB' },
      { key: 'to', label: 'End level', type: 'number', min: -60, max: 12, step: 0.5, default: -12, unit: 'dB' },
    ],
    apply: (a, p) => {
      const n = length(a);
      const f = num(p, 'from');
      const t = num(p, 'to');
      return mapChannels(a, (c) => c.map((v, i) => v * linearFromDb(f + (t - f) * (n > 1 ? i / (n - 1) : 0))));
    },
  },
  // ---------------- Time & pitch
  {
    id: 'reverse',
    name: 'Reverse',
    category: 'Time & Pitch',
    description: 'Play the selection backwards.',
    params: [],
    apply: (a) => mapChannels(a, (c) => c.slice().reverse()),
  },
  {
    id: 'speed',
    name: 'Change Speed',
    category: 'Time & Pitch',
    description: 'Speed up or slow down — pitch changes too (like a tape machine).',
    params: [{ key: 'speed', label: 'Speed', type: 'number', min: 25, max: 400, step: 1, default: 125, unit: '%' }],
    apply: (a, p) => changeSpeed(a, num(p, 'speed') / 100),
  },
  {
    id: 'tempo',
    name: 'Change Tempo',
    category: 'Time & Pitch',
    description: 'Change speed without affecting pitch.',
    params: [{ key: 'tempo', label: 'Tempo', type: 'number', min: 25, max: 400, step: 1, default: 110, unit: '%' }],
    apply: (a, p) => timeStretch(a, 100 / num(p, 'tempo')),
  },
  {
    id: 'pitch',
    name: 'Change Pitch',
    category: 'Time & Pitch',
    description: 'Shift pitch up or down without changing duration.',
    params: [{ key: 'semitones', label: 'Shift', type: 'number', min: -12, max: 12, step: 0.5, default: 2, unit: 'st' }],
    apply: (a, p) => pitchShift(a, num(p, 'semitones')),
  },
  {
    id: 'echo',
    name: 'Echo',
    category: 'Special',
    description: 'Repeating delayed copies of the sound.',
    tailMode: 'mixTail',
    params: [
      { key: 'delay', label: 'Delay', type: 'number', min: 20, max: 2000, step: 10, default: 350, unit: 'ms' },
      { key: 'feedback', label: 'Feedback', type: 'number', min: 0, max: 0.95, step: 0.01, default: 0.45 },
      { key: 'mix', label: 'Echo level', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    apply: (a, p) => {
      const d = Math.max(1, Math.round((num(p, 'delay') / 1000) * a.sampleRate));
      const fb = num(p, 'feedback');
      const mix = num(p, 'mix');
      // tail until feedback decays below -60 dB
      const repeats = fb > 0 ? Math.min(40, Math.ceil(Math.log(0.001) / Math.log(fb))) : 1;
      const n = length(a);
      const outLen = n + d * repeats;
      return mapChannels(a, (c) => {
        const out = new Float32Array(outLen);
        const line = new Float32Array(outLen);
        for (let i = 0; i < outLen; i++) {
          const x = i < n ? c[i] : 0;
          const delayed = i >= d ? line[i - d] : 0;
          line[i] = x + delayed * fb;
          out[i] = x + delayed * mix;
        }
        return out;
      });
    },
  },
  {
    id: 'reverb',
    name: 'Reverb',
    category: 'Special',
    description: 'Simulate the reflections of a room or hall.',
    tailMode: 'mixTail',
    params: [
      { key: 'room', label: 'Room size', type: 'number', min: 0, max: 1, step: 0.01, default: 0.6 },
      { key: 'damping', label: 'Damping', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: 'wet', label: 'Wet', type: 'number', min: 0, max: 1, step: 0.01, default: 0.33 },
      { key: 'dry', label: 'Dry', type: 'number', min: 0, max: 1, step: 0.01, default: 0.8 },
      { key: 'tail', label: 'Tail', type: 'number', min: 0, max: 8, step: 0.1, default: 2, unit: 's' },
    ],
    apply: (a, p) => reverb(a, num(p, 'room'), num(p, 'damping'), num(p, 'wet'), num(p, 'dry'), num(p, 'tail')),
  },
  {
    id: 'chorus',
    name: 'Chorus',
    category: 'Special',
    description: 'Thicken the sound with modulated, detuned copies.',
    params: [
      { key: 'rate', label: 'Rate', type: 'number', min: 0.1, max: 5, step: 0.1, default: 1.2, unit: 'Hz' },
      { key: 'depth', label: 'Depth', type: 'number', min: 1, max: 20, step: 0.5, default: 6, unit: 'ms' },
      { key: 'mix', label: 'Mix', type: 'number', min: 0, max: 1, step: 0.01, default: 0.5 },
    ],
    apply: (a, p) => {
      const sr = a.sampleRate;
      const rate = num(p, 'rate');
      const depth = (num(p, 'depth') / 1000) * sr;
      const base = 0.012 * sr;
      const mix = num(p, 'mix');
      return mapChannels(a, (c, ch) => {
        const out = new Float32Array(c.length);
        const phase = ch * Math.PI * 0.5;
        for (let i = 0; i < c.length; i++) {
          const d = base + depth * (0.5 + 0.5 * Math.sin((2 * Math.PI * rate * i) / sr + phase));
          const pos = i - d;
          const i0 = Math.floor(pos);
          const f = pos - i0;
          const s = i0 >= 0 && i0 + 1 < c.length ? c[i0] * (1 - f) + c[i0 + 1] * f : 0;
          out[i] = c[i] * (1 - mix * 0.5) + s * mix;
        }
        return out;
      });
    },
  },
  {
    id: 'tremolo',
    name: 'Tremolo',
    category: 'Special',
    description: 'Rhythmic volume modulation.',
    params: [
      { key: 'rate', label: 'Rate', type: 'number', min: 0.5, max: 20, step: 0.1, default: 5, unit: 'Hz' },
      { key: 'depth', label: 'Depth', type: 'number', min: 0, max: 1, step: 0.01, default: 0.6 },
    ],
    apply: (a, p) => {
      const r = num(p, 'rate');
      const d = num(p, 'depth');
      return mapChannels(a, (c) => c.map((v, i) => v * (1 - d * (0.5 + 0.5 * Math.sin((2 * Math.PI * r * i) / a.sampleRate)))));
    },
  },
  {
    id: 'distortion',
    name: 'Distortion',
    category: 'Special',
    description: 'Warm saturation to aggressive overdrive.',
    params: [
      { key: 'drive', label: 'Drive', type: 'number', min: 0, max: 40, step: 0.5, default: 12, unit: 'dB' },
      { key: 'mix', label: 'Mix', type: 'number', min: 0, max: 1, step: 0.01, default: 1 },
      { key: 'output', label: 'Output', type: 'number', min: -24, max: 6, step: 0.5, default: -6, unit: 'dB' },
    ],
    apply: (a, p) => {
      const drive = linearFromDb(num(p, 'drive'));
      const mix = num(p, 'mix');
      const outG = linearFromDb(num(p, 'output'));
      return mapChannels(a, (c) => c.map((v) => (v * (1 - mix) + Math.tanh(v * drive) * mix) * outG));
    },
  },
  {
    id: 'telephone',
    name: 'Telephone',
    category: 'Special',
    description: 'Narrow-band “phone call” voice effect.',
    params: [],
    apply: (a) =>
      mapChannels(a, (c) => {
        let o = applyBiquad(c, biquadCoeffs('highpass', a.sampleRate, 400, 0.9));
        o = applyBiquad(o, biquadCoeffs('lowpass', a.sampleRate, 3200, 0.9));
        return o.map((v) => Math.tanh(v * 2) * 0.7);
      }),
  },
  // ---------------- Filters & EQ
  {
    id: 'eq',
    name: 'Graphic Equalizer',
    category: 'Filters & EQ',
    description: '10-band graphic EQ.',
    params: EQ_BANDS.map((f) => ({
      key: `b${f}`,
      label: f >= 1000 ? `${f / 1000}k` : `${f}`,
      type: 'number' as const,
      min: -18,
      max: 18,
      step: 0.5,
      default: 0,
      unit: 'dB',
    })),
    apply: (a, p) =>
      mapChannels(a, (c) => {
        let o = c;
        for (const f of EQ_BANDS) {
          const g = num(p, `b${f}`);
          if (g === 0 || f >= a.sampleRate / 2) continue;
          o = applyBiquad(o, biquadCoeffs('peaking', a.sampleRate, f, 1.1, g));
        }
        return o === c ? new Float32Array(c) : o;
      }),
  },
  {
    id: 'lowpass',
    name: 'Low-Pass Filter',
    category: 'Filters & EQ',
    description: 'Remove frequencies above the cutoff.',
    params: [
      { key: 'freq', label: 'Cutoff', type: 'number', min: 50, max: 20000, step: 10, default: 4000, unit: 'Hz' },
      { key: 'q', label: 'Resonance (Q)', type: 'number', min: 0.3, max: 10, step: 0.1, default: 0.7 },
    ],
    apply: (a, p) => mapChannels(a, (c) => applyBiquad(c, biquadCoeffs('lowpass', a.sampleRate, num(p, 'freq'), num(p, 'q')))),
  },
  {
    id: 'highpass',
    name: 'High-Pass Filter',
    category: 'Filters & EQ',
    description: 'Remove rumble and frequencies below the cutoff.',
    params: [
      { key: 'freq', label: 'Cutoff', type: 'number', min: 20, max: 5000, step: 5, default: 80, unit: 'Hz' },
      { key: 'q', label: 'Resonance (Q)', type: 'number', min: 0.3, max: 10, step: 0.1, default: 0.7 },
    ],
    apply: (a, p) => mapChannels(a, (c) => applyBiquad(c, biquadCoeffs('highpass', a.sampleRate, num(p, 'freq'), num(p, 'q')))),
  },
  {
    id: 'bandpass',
    name: 'Band-Pass Filter',
    category: 'Filters & EQ',
    description: 'Keep only a band of frequencies around the center.',
    params: [
      { key: 'freq', label: 'Center', type: 'number', min: 50, max: 15000, step: 10, default: 1000, unit: 'Hz' },
      { key: 'q', label: 'Q', type: 'number', min: 0.3, max: 20, step: 0.1, default: 1 },
    ],
    apply: (a, p) => mapChannels(a, (c) => applyBiquad(c, biquadCoeffs('bandpass', a.sampleRate, num(p, 'freq'), num(p, 'q')))),
  },
  {
    id: 'notch',
    name: 'Notch (Hum) Filter',
    category: 'Restoration',
    description: 'Remove mains hum at 50/60 Hz and its harmonics.',
    params: [
      {
        key: 'freq',
        label: 'Mains frequency',
        type: 'select',
        default: '50',
        options: [
          { value: '50', label: '50 Hz (EU / Africa / Asia)' },
          { value: '60', label: '60 Hz (Americas)' },
        ],
      },
      { key: 'harmonics', label: 'Harmonics', type: 'number', min: 1, max: 8, step: 1, default: 4 },
    ],
    apply: (a, p) =>
      mapChannels(a, (c) => {
        let o = c;
        const f0 = Number(p.freq);
        for (let h = 1; h <= num(p, 'harmonics'); h++) o = applyBiquad(o, biquadCoeffs('notch', a.sampleRate, f0 * h, 30));
        return o;
      }),
  },
  {
    id: 'bass',
    name: 'Bass Boost',
    category: 'Filters & EQ',
    description: 'Shelf boost or cut for low frequencies.',
    params: [
      { key: 'gain', label: 'Gain', type: 'number', min: -18, max: 18, step: 0.5, default: 6, unit: 'dB' },
      { key: 'freq', label: 'Frequency', type: 'number', min: 40, max: 500, step: 5, default: 150, unit: 'Hz' },
    ],
    apply: (a, p) => mapChannels(a, (c) => applyBiquad(c, biquadCoeffs('lowshelf', a.sampleRate, num(p, 'freq'), 0.707, num(p, 'gain')))),
  },
  {
    id: 'treble',
    name: 'Treble Boost',
    category: 'Filters & EQ',
    description: 'Shelf boost or cut for high frequencies.',
    params: [
      { key: 'gain', label: 'Gain', type: 'number', min: -18, max: 18, step: 0.5, default: 4, unit: 'dB' },
      { key: 'freq', label: 'Frequency', type: 'number', min: 1000, max: 16000, step: 100, default: 5000, unit: 'Hz' },
    ],
    apply: (a, p) => mapChannels(a, (c) => applyBiquad(c, biquadCoeffs('highshelf', a.sampleRate, num(p, 'freq'), 0.707, num(p, 'gain')))),
  },
  // ---------------- Dynamics
  {
    id: 'compressor',
    name: 'Compressor',
    category: 'Dynamics',
    description: 'Even out loud and quiet parts.',
    params: [
      { key: 'threshold', label: 'Threshold', type: 'number', min: -60, max: 0, step: 0.5, default: -18, unit: 'dB' },
      { key: 'ratio', label: 'Ratio', type: 'number', min: 1, max: 20, step: 0.1, default: 4, unit: ':1' },
      { key: 'attack', label: 'Attack', type: 'number', min: 0.1, max: 200, step: 0.1, default: 10, unit: 'ms' },
      { key: 'release', label: 'Release', type: 'number', min: 10, max: 2000, step: 5, default: 150, unit: 'ms' },
      { key: 'makeup', label: 'Make-up gain', type: 'number', min: 0, max: 24, step: 0.5, default: 6, unit: 'dB' },
    ],
    apply: (a, p) => {
      const th = num(p, 'threshold');
      const r = num(p, 'ratio');
      const mk = num(p, 'makeup');
      return dynamics(a, (db) => (db > th ? (th + (db - th) / r - db) + mk : mk), num(p, 'attack'), num(p, 'release'));
    },
  },
  {
    id: 'limiter',
    name: 'Limiter',
    category: 'Dynamics',
    description: 'Prevent peaks from exceeding a ceiling.',
    params: [
      { key: 'ceiling', label: 'Ceiling', type: 'number', min: -24, max: 0, step: 0.1, default: -1, unit: 'dB' },
      { key: 'release', label: 'Release', type: 'number', min: 1, max: 1000, step: 1, default: 50, unit: 'ms' },
    ],
    apply: (a, p) => {
      const ceil = num(p, 'ceiling');
      const out = dynamics(a, (db) => (db > ceil ? ceil - db : 0), 0.01, num(p, 'release'));
      const lim = linearFromDb(ceil);
      return mapChannels(out, (c) => c.map((v) => Math.max(-lim, Math.min(lim, v))));
    },
  },
  {
    id: 'gate',
    name: 'Noise Gate',
    category: 'Dynamics',
    description: 'Silence audio that falls below the threshold (breaths, room noise).',
    params: [
      { key: 'threshold', label: 'Threshold', type: 'number', min: -80, max: 0, step: 0.5, default: -45, unit: 'dB' },
      { key: 'reduction', label: 'Reduction', type: 'number', min: 0, max: 96, step: 1, default: 60, unit: 'dB' },
      { key: 'attack', label: 'Attack', type: 'number', min: 0.1, max: 100, step: 0.1, default: 2, unit: 'ms' },
      { key: 'release', label: 'Release', type: 'number', min: 5, max: 2000, step: 5, default: 120, unit: 'ms' },
    ],
    apply: (a, p) => {
      const th = num(p, 'threshold');
      const red = num(p, 'reduction');
      return dynamics(a, (db) => (db < th ? -red : 0), num(p, 'attack'), num(p, 'release'));
    },
  },
  // ---------------- Restoration
  {
    id: 'denoise',
    name: 'Noise Reduction',
    category: 'Restoration',
    description: 'Learn the background hiss from the quietest parts and remove it.',
    params: [
      { key: 'reduction', label: 'Reduction', type: 'number', min: 3, max: 40, step: 1, default: 18, unit: 'dB' },
      { key: 'sensitivity', label: 'Sensitivity', type: 'number', min: 0.5, max: 4, step: 0.1, default: 1.5 },
    ],
    apply: (a, p) => spectralDenoise(a, num(p, 'reduction'), num(p, 'sensitivity')),
  },
  {
    id: 'dc',
    name: 'Remove DC Offset',
    category: 'Restoration',
    description: 'Re-center the waveform around zero.',
    params: [],
    apply: (a) =>
      mapChannels(a, (c) => {
        let s = 0;
        for (const v of c) s += v;
        const m = c.length ? s / c.length : 0;
        return c.map((v) => v - m);
      }),
  },
  {
    id: 'declick',
    name: 'Click & Pop Removal',
    category: 'Restoration',
    description: 'Detect sudden spikes and interpolate over them.',
    params: [{ key: 'sensitivity', label: 'Sensitivity', type: 'number', min: 2, max: 20, step: 0.5, default: 8 }],
    apply: (a, p) => {
      const k = num(p, 'sensitivity');
      return mapChannels(a, (c) => {
        const o = new Float32Array(c);
        let avg = 0.001;
        for (let i = 2; i < c.length - 2; i++) {
          const d = Math.abs(c[i] - (c[i - 1] + c[i + 1]) / 2);
          avg = avg * 0.999 + d * 0.001;
          if (d > k * avg * 4 && d > 0.05) {
            o[i] = (o[i - 1] + c[i + 2]) / 2;
          }
        }
        return o;
      });
    },
  },
  {
    id: 'trimSilence',
    name: 'Auto-Trim Silence',
    category: 'Restoration',
    description: 'Remove silence at the start and end.',
    params: [
      { key: 'threshold', label: 'Threshold', type: 'number', min: -80, max: -10, step: 1, default: -50, unit: 'dB' },
      { key: 'pad', label: 'Padding', type: 'number', min: 0, max: 1000, step: 10, default: 50, unit: 'ms' },
    ],
    apply: (a, p) => {
      const b = findSoundBounds(a, num(p, 'threshold'));
      if (!b) return { sampleRate: a.sampleRate, channels: a.channels.map(() => new Float32Array(0)) };
      const pad = Math.round((num(p, 'pad') / 1000) * a.sampleRate);
      const s = Math.max(0, b.start - pad);
      const e = Math.min(length(a), b.end + pad);
      return mapChannels(a, (c) => c.slice(s, e));
    },
  },
  // ---------------- Channels
  {
    id: 'invert',
    name: 'Invert Polarity',
    category: 'Channels',
    description: 'Flip the waveform upside down.',
    params: [],
    apply: (a) => mapChannels(a, (c) => c.map((v) => -v)),
  },
  {
    id: 'pan',
    name: 'Pan / Balance',
    category: 'Channels',
    description: 'Shift the stereo balance left or right.',
    stereoOnly: true,
    params: [{ key: 'pan', label: 'Pan', type: 'number', min: -100, max: 100, step: 1, default: 0, unit: 'L/R' }],
    apply: (a, p) => {
      const pan = num(p, 'pan') / 100;
      const angle = ((pan + 1) * Math.PI) / 4;
      const gl = Math.cos(angle) * Math.SQRT2;
      const gr = Math.sin(angle) * Math.SQRT2;
      return mapChannels(a, (c, i) => c.map((v) => v * Math.min(1, i === 0 ? gl : gr)));
    },
  },
  {
    id: 'swap',
    name: 'Swap Channels',
    category: 'Channels',
    description: 'Exchange left and right channels.',
    stereoOnly: true,
    params: [],
    apply: (a) => ({ sampleRate: a.sampleRate, channels: a.channels.length >= 2 ? [new Float32Array(a.channels[1]), new Float32Array(a.channels[0]), ...a.channels.slice(2).map((c) => new Float32Array(c))] : clone(a).channels }),
  },
  {
    id: 'vocalRemove',
    name: 'Vocal Remover',
    category: 'Channels',
    description: 'Cancel centre-panned vocals (karaoke).',
    stereoOnly: true,
    params: [{ key: 'keepBass', label: 'Keep bass below', type: 'number', min: 0, max: 400, step: 10, default: 150, unit: 'Hz' }],
    apply: (a, p) => {
      if (a.channels.length < 2) return clone(a);
      const [l, r] = a.channels;
      const side = l.map((v, i) => (v - r[i]) * 0.5);
      const kb = num(p, 'keepBass');
      let bass = new Float32Array(l.length);
      if (kb > 0) {
        const mid = l.map((v, i) => (v + r[i]) * 0.5);
        bass = applyBiquad(mid, biquadCoeffs('lowpass', a.sampleRate, kb));
      }
      return { sampleRate: a.sampleRate, channels: [side.map((v, i) => v + bass[i]), side.map((v, i) => -v + bass[i])] };
    },
  },
  {
    id: 'stereoWiden',
    name: 'Stereo Width',
    category: 'Channels',
    description: 'Narrow or widen the stereo image.',
    stereoOnly: true,
    params: [{ key: 'width', label: 'Width', type: 'number', min: 0, max: 200, step: 1, default: 140, unit: '%' }],
    apply: (a, p) => {
      if (a.channels.length < 2) return clone(a);
      const w = num(p, 'width') / 100;
      const [l, r] = a.channels;
      const L = new Float32Array(l.length);
      const R = new Float32Array(l.length);
      for (let i = 0; i < l.length; i++) {
        const m = (l[i] + r[i]) / 2;
        const s = ((l[i] - r[i]) / 2) * w;
        L[i] = m + s;
        R[i] = m - s;
      }
      return { sampleRate: a.sampleRate, channels: [L, R] };
    },
  },
];

export const EFFECTS_BY_ID: Record<string, EffectDef> = Object.fromEntries(EFFECTS.map((e) => [e.id, e]));

export const EFFECT_CATEGORIES: EffectCategory[] = ['Volume', 'Filters & EQ', 'Dynamics', 'Time & Pitch', 'Restoration', 'Special', 'Channels'];

/** Convert a whole document between mono and stereo. */
export function convertChannels(a: AudioData, target: 1 | 2): AudioData {
  if (target === 1) return toMono(a);
  if (a.channels.length === 2) return clone(a);
  const m = toMono(a).channels[0];
  return { sampleRate: a.sampleRate, channels: [new Float32Array(m), new Float32Array(m)] };
}
