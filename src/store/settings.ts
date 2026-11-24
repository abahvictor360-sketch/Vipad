import { create } from 'zustand';

export interface Settings {
  // new files & multitrack
  newSampleRate: number;
  newChannels: 1 | 2;
  multitrack: boolean;
  // recording
  micDeviceId: string;
  micLabel: string;
  masterVolume: number;
  showSidePanel: boolean;
  showMenuBar: boolean;
  snapToZero: boolean;
  recordCountdown: number;
  soundActivated: boolean;
  soundThresholdDb: number;
  showRibbon: boolean;
  notifyUpdates: boolean;
  lastSeenVersion: string;
  dismissedUpdate: string;
  recordChannels: 1 | 2;
  recordVoiceProcessing: boolean;
  recordPlayAlong: boolean;
  autoSaveRecordings: boolean;
  // export
  exportFormat: 'mp3' | 'wav' | 'flac' | 'ogg' | 'm4a' | 'aiff' | 'webm' | 'au' | 'raw';
  mp3Bitrate: number;
  wavBitDepth: 8 | 16 | 24 | 32;
  exportChannels: 'keep' | 'mono' | 'stereo';
  exportSampleRate: number | 'keep';
  // editing & view
  followPlayhead: boolean;
  confirmClose: boolean;
  undoSteps: number;
  waveformStyle: 'filled' | 'outline';
  showSpectrum: boolean;
  skipSeconds: number;
}

export const DEFAULT_SETTINGS: Settings = {
  newSampleRate: 48000,
  newChannels: 2,
  multitrack: false,
  micDeviceId: '',
  micLabel: '',
  masterVolume: 1,
  showSidePanel: true,
  showMenuBar: true,
  snapToZero: false,
  recordCountdown: 0,
  soundActivated: false,
  soundThresholdDb: -40,
  showRibbon: true,
  notifyUpdates: true,
  lastSeenVersion: '',
  dismissedUpdate: '',
  recordChannels: 1,
  recordVoiceProcessing: false,
  recordPlayAlong: true,
  autoSaveRecordings: true,
  exportFormat: 'mp3',
  mp3Bitrate: 192,
  wavBitDepth: 16,
  exportChannels: 'keep',
  exportSampleRate: 'keep',
  followPlayhead: true,
  confirmClose: true,
  undoSteps: 100,
  waveformStyle: 'filled',
  showSpectrum: true,
  skipSeconds: 1,
};

const KEY = 'vipad.settings.v1';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsState extends Settings {
  set: (patch: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>((set, get) => {
  const persist = () => {
    try {
      const { set: _s, reset: _r, ...data } = get();
      void _s; void _r;
      localStorage.setItem(KEY, JSON.stringify(data));
    } catch {
      /* storage unavailable (private mode) — settings still apply for this session */
    }
  };
  return {
    ...load(),
    set: (patch) => {
      set(patch);
      persist();
    },
    reset: () => {
      set(DEFAULT_SETTINGS);
      persist();
    },
  };
});
