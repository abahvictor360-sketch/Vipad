import { Settings as SettingsIcon } from 'lucide-react';
import { Modal } from './Modal';
import { useEditor } from '../../store/editor';
import { useSettings, Settings } from '../../store/settings';

function Toggle({ label, hint, k }: { label: string; hint?: string; k: keyof Settings }) {
  const v = useSettings((s) => s[k]) as boolean;
  return (
    <label className="set-toggle">
      <span>
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
      <input type="checkbox" role="switch" checked={v} onChange={(e) => useSettings.getState().set({ [k]: e.target.checked } as Partial<Settings>)} data-testid={`set-${k}`} />
    </label>
  );
}

function Select<K extends keyof Settings>({ label, k, options }: { label: string; k: K; options: [Settings[K], string][] }) {
  const v = useSettings((s) => s[k]);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <select
        value={String(v)}
        onChange={(e) => {
          const opt = options.find(([o]) => String(o) === e.target.value);
          if (opt) useSettings.getState().set({ [k]: opt[0] } as Partial<Settings>);
        }}
      >
        {options.map(([o, l]) => <option key={String(o)} value={String(o)}>{l}</option>)}
      </select>
    </label>
  );
}

export function SettingsDialog() {
  const close = () => useEditor.getState().setDialog(null);
  return (
    <Modal
      title="Settings"
      subtitle="Preferences are saved on this device."
      onClose={close}
      wide
      icon={<SettingsIcon size={18} />}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => confirm('Restore all settings to their defaults?') && useSettings.getState().reset()}>Restore defaults</button>
          <span className="spacer" />
          <button className="btn btn-primary" onClick={close}>Done</button>
        </>
      }
    >
      <div className="settings">
        <section>
          <h3>General</h3>
          <Toggle k="multitrack" label="Multitrack mode" hint="Layer several tracks and mix them down. Turn off for the single-file waveform editor." />
          <Toggle k="followPlayhead" label="Follow playhead" hint="Scroll the view to keep the playhead visible while playing." />
          <Toggle k="confirmClose" label="Confirm before closing unsaved files" />
          <Toggle k="showSpectrum" label="Show spectrum analyser" />
          <Select k="skipSeconds" label="Arrow-key skip" options={[[0.1, '0.1 second'], [0.5, '0.5 second'], [1, '1 second'], [5, '5 seconds'], [10, '10 seconds']]} />
          <Select k="undoSteps" label="Undo levels (new files)" options={[[25, '25'], [50, '50'], [100, '100'], [250, '250']]} />
        </section>
        <section>
          <h3>New files</h3>
          <Select k="newSampleRate" label="Sample rate" options={[[22050, '22,050 Hz'], [44100, '44,100 Hz (CD)'], [48000, '48,000 Hz (video)'], [96000, '96,000 Hz (hi-res)']]} />
          <Select k="newChannels" label="Channels" options={[[1, 'Mono'], [2, 'Stereo']]} />
        </section>
        <section>
          <h3>Recording</h3>
          <Select k="recordChannels" label="Default channels" options={[[1, 'Mono'], [2, 'Stereo']]} />
          <Toggle k="recordVoiceProcessing" label="Voice processing by default" hint="Echo cancellation, noise suppression and auto-gain. Best off for music." />
          <Toggle k="recordPlayAlong" label="Play other tracks while recording (multitrack)" hint="Hear existing tracks while you overdub. Use headphones to avoid bleed." />
          <Toggle k="autoSaveRecordings" label="Auto-save recordings to library" />
        </section>
        <section>
          <h3>Export defaults</h3>
          <Select k="exportFormat" label="Format" options={[['mp3', 'MP3'], ['wav', 'WAV']]} />
          <Select k="mp3Bitrate" label="MP3 bitrate" options={[[96, '96 kbps'], [128, '128 kbps'], [192, '192 kbps'], [256, '256 kbps'], [320, '320 kbps']]} />
          <Select k="wavBitDepth" label="WAV bit depth" options={[[16, '16-bit'], [24, '24-bit'], [32, '32-bit float']]} />
        </section>
      </div>
    </Modal>
  );
}
