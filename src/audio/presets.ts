/** Built-in and user effect presets (user presets live in this device's storage). */
import { Params } from './effects';

export const BUILTIN_PRESETS: Record<string, Record<string, Params>> = {
  eq: {
    'Voice clarity': { b31: -6, b62: -4, b125: -1, b250: -2, b500: 0, b1000: 1, b2000: 3, b4000: 4, b8000: 2, b16000: 0 },
    'Podcast warmth': { b31: -4, b62: 1, b125: 3, b250: 1, b500: -1, b1000: 0, b2000: 1, b4000: 2, b8000: 1, b16000: -1 },
    'Bass boost': { b31: 6, b62: 6, b125: 4, b250: 1, b500: 0, b1000: 0, b2000: 0, b4000: 0, b8000: 0, b16000: 0 },
    'Treble boost': { b31: 0, b62: 0, b125: 0, b250: 0, b500: 0, b1000: 1, b2000: 2, b4000: 4, b8000: 6, b16000: 6 },
    'Remove rumble': { b31: -18, b62: -12, b125: -3, b250: 0, b500: 0, b1000: 0, b2000: 0, b4000: 0, b8000: 0, b16000: 0 },
    'Loudness (smile)': { b31: 5, b62: 4, b125: 2, b250: 0, b500: -2, b1000: -2, b2000: 0, b4000: 2, b8000: 4, b16000: 5 },
  },
  compressor: {
    'Gentle vocal': { threshold: -20, ratio: 2.5, attack: 15, release: 200, makeup: 3 },
    Podcast: { threshold: -24, ratio: 4, attack: 8, release: 150, makeup: 6 },
    'Heavy / radio': { threshold: -30, ratio: 8, attack: 3, release: 100, makeup: 10 },
  },
  reverb: {
    'Small room': { room: 0.3, damping: 0.6, wet: 0.2, dry: 0.9, tail: 0.8 },
    'Concert hall': { room: 0.8, damping: 0.4, wet: 0.35, dry: 0.8, tail: 3 },
    Cathedral: { room: 0.97, damping: 0.2, wet: 0.45, dry: 0.7, tail: 6 },
  },
  echo: {
    Slapback: { delay: 110, feedback: 0.1, mix: 0.4 },
    Canyon: { delay: 650, feedback: 0.55, mix: 0.45 },
  },
  gate: { 'Voice (studio)': { threshold: -50, reduction: 40, attack: 2, release: 150 }, 'Noisy room': { threshold: -38, reduction: 30, attack: 3, release: 200 } },
  denoise: { Light: { reduction: 10, sensitivity: 1.2 }, Strong: { reduction: 28, sensitivity: 2 } },
  pitch: { 'Chipmunk (+7)': { semitones: 7 }, 'Deep voice (−5)': { semitones: -5 }, 'Octave up': { semitones: 12 }, 'Octave down': { semitones: -12 } },
  loudnorm: { 'Spotify / YouTube': { target: '-14', ceiling: -1 }, 'Apple Podcasts': { target: '-16', ceiling: -1 }, 'Broadcast (EBU R128)': { target: '-23', ceiling: -1 } },
};

const KEY = 'vipad.presets.v1';
type Store = Record<string, Record<string, Params>>;

export function userPresets(effectId: string): Record<string, Params> {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store)[effectId] ?? {};
  } catch {
    return {};
  }
}

function write(fn: (s: Store) => void) {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Store;
    fn(s);
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: presets just don't persist */
  }
}

export const saveUserPreset = (effectId: string, name: string, params: Params) => write((s) => { s[effectId] = { ...(s[effectId] ?? {}), [name]: params }; });
export const deleteUserPreset = (effectId: string, name: string) => write((s) => { if (s[effectId]) delete s[effectId][name]; });
