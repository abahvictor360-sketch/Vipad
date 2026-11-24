import { Settings as SettingsIcon } from 'lucide-react';
import { Modal } from './Modal';
import { useEditor } from '../../store/editor';
import { useSettings, Settings } from '../../store/settings';
import { MicPicker } from './MicPicker';
import { player } from '../../audio/player';
import { checkForUpdates, CURRENT, useUpdates } from '../../app/updates';
import { createShortcut } from '../../app/shortcut';

function UpdatesSection() {
  const checking = useUpdates((s) => s.checking);
  return (
    <section>
      <h3>Updates &amp; shortcuts</h3>
      <Toggle k="notifyUpdates" label="Notify me about new versions" hint="Shows a message (and a system notification on desktop) when an update is available." />
      <div className="set-row">
        <span className="muted">Installed: v{CURRENT}</span>
        <button className="btn btn-secondary btn-sm" disabled={checking} onClick={() => void checkForUpdates(true)} data-testid="check-updates">{checking ? 'Checking…' : 'Check now'}</button>
      </div>
      <div className="set-row">
        <span className="muted">Put Vipad on your desktop / home screen</span>
        <button className="btn btn-secondary btn-sm" onClick={() => void createShortcut()} data-testid="create-shortcut">Create shortcut</button>
      </div>
    </section>
  );
}

function MasterVolume() {
  const v = useSettings((s) => s.masterVolume);
  return (
    <div className="field">
      <div className="field-row">
        <label className="field-label" htmlFor="master-vol">Master volume</label>
        <span className="field-num"><em>{Math.round(v * 100)} %</em></span>
      </div>
      <input id="master-vol" data-testid="master-volume" type="range" className="slider" min={0} max={1.5} step={0.01} value={v} style={{ ['--pct' as string]: `${(v / 1.5) * 100}%` }} onChange={(e) => { const n = Number(e.target.value); useSettings.getState().set({ masterVolume: n }); player.setVolume(n); }} />
      <small className="field-hint">Playback level for everything you hear in Vipad (0–150 %). Doesn’t change your files.</small>
    </div>
  );
}

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

function Text({ label, k, placeholder, type = 'text', hint }: { label: string; k: 'linkTurnUrl' | 'linkTurnUser' | 'linkTurnPass' | 'linkName'; placeholder?: string; type?: string; hint?: string }) {
  const v = useSettings((s) => s[k]);
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input className="text-input" type={type} value={v} placeholder={placeholder} autoComplete="off" onChange={(e) => useSettings.getState().set({ [k]: e.target.value.trim() } as Partial<Settings>)} data-testid={`set-${k}`} />
      {hint && <small className="field-hint">{hint}</small>}
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
          <Toggle k="showSidePanel" label="Show Effects / Info / Markers panel" />
          <Toggle k="snapToZero" label="Snap selections to zero crossings" hint="Avoids clicks when cutting and pasting." />
          <Toggle k="showMenuBar" label="Show menu bar (File, Edit … Window, Help)" hint="On wide screens. The ☰ menu is always available." />
          <Toggle k="showRibbon" label="Show toolbar" />
          <Select k="skipSeconds" label="Arrow-key skip" options={[[0.1, '0.1 second'], [0.5, '0.5 second'], [1, '1 second'], [5, '5 seconds'], [10, '10 seconds']]} />
          <Select k="undoSteps" label="Undo levels (new files)" options={[[25, '25'], [50, '50'], [100, '100'], [250, '250']]} />
        </section>
        <section>
          <h3>New files</h3>
          <Select k="newSampleRate" label="Sample rate" options={[[22050, '22,050 Hz'], [44100, '44,100 Hz (CD)'], [48000, '48,000 Hz (video)'], [96000, '96,000 Hz (hi-res)']]} />
          <Select k="newChannels" label="Channels" options={[[1, 'Mono'], [2, 'Stereo']]} />
        </section>
        <section>
          <h3>Audio devices</h3>
          <MicPicker />
          <MasterVolume />
        </section>
        <section>
          <h3>Recording</h3>
          <Select k="recordChannels" label="Default channels" options={[[1, 'Mono'], [2, 'Stereo']]} />
          <Toggle k="recordVoiceProcessing" label="Voice processing by default" hint="Echo cancellation, noise suppression and auto-gain. Best off for music." />
          <Toggle k="recordPlayAlong" label="Play other tracks while recording (multitrack)" hint="Hear existing tracks while you overdub. Use headphones to avoid bleed." />
          <Toggle k="autoSaveRecordings" label="Auto-save recordings to library" />
          <Select k="recordCountdown" label="Countdown before recording" options={[[0, 'None'], [3, '3 seconds'], [5, '5 seconds'], [10, '10 seconds']]} />
          <Toggle k="soundActivated" label="Sound-activated recording" hint="Only records while there is sound — silent stretches are skipped automatically." />
          <Select k="soundThresholdDb" label="Sound-activated threshold" options={[[-55, '−55 dB (very sensitive)'], [-45, '−45 dB'], [-40, '−40 dB (default)'], [-35, '−35 dB'], [-30, '−30 dB (loud only)']]} />
        </section>
        <section>
          <h3>Export defaults</h3>
          <Select k="exportFormat" label="Format" options={[['mp3', 'MP3'], ['wav', 'WAV'], ['flac', 'FLAC'], ['ogg', 'OGG (Opus)'], ['m4a', 'M4A (AAC)'], ['aiff', 'AIFF'], ['webm', 'WebM (Opus)'], ['au', 'AU'], ['raw', 'RAW PCM']]} />
          <Select k="mp3Bitrate" label="MP3 bitrate" options={[[96, '96 kbps'], [128, '128 kbps'], [192, '192 kbps'], [256, '256 kbps'], [320, '320 kbps']]} />
          <Select k="wavBitDepth" label="WAV bit depth" options={[[16, '16-bit'], [24, '24-bit'], [32, '32-bit float']]} />
          <Select k="exportChannels" label="Channels" options={[['keep', 'Same as original'], ['mono', 'Mono'], ['stereo', 'Stereo']]} />
          <Select k="exportSampleRate" label="Sample rate" options={[['keep', 'Same as original'], [22050, '22.05 kHz'], [44100, '44.1 kHz (CD)'], [48000, '48 kHz (video)'], [96000, '96 kHz (hi-res)'], [192000, '192 kHz (studio)'], [225000, '225 kHz (maximum)']]} />
        </section>
        <section>
          <h3>Vipad Link (network audio)</h3>
          <Text k="linkName" label="This device’s name" placeholder="e.g. Studio Mac" />
          <Text k="linkTurnUrl" label="TURN relay (optional)" placeholder="turn:relay.example.com:3478" hint="Only needed when devices on different networks can’t connect directly (strict office or mobile networks)." />
          <Text k="linkTurnUser" label="TURN username" />
          <Text k="linkTurnPass" label="TURN password" type="password" />
          <Select k="vbanPort" label="VBAN UDP port (desktop app)" options={[[6980, '6980 (Voicemeeter default)'], [6981, '6981'], [6982, '6982'], [6990, '6990']]} />
        </section>
        <UpdatesSection />
      </div>
    </Modal>
  );
}
