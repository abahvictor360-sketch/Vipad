import { useState } from 'react';
import { Mic, Circle } from 'lucide-react';
import { Modal } from './Modal';
import { useEditor } from '../../store/editor';
import { useSettings } from '../../store/settings';
import { useRecording, RecordDest } from '../../store/recording';
import { MicPicker } from './MicPicker';

/** Record options: microphone, channels, voice processing and where the take goes. Recording itself happens live in the editor. */
export function RecordDialog() {
  const doc = useEditor((s) => s.active());
  const s = useSettings();
  const [dest, setDest] = useState<RecordDest>(s.multitrack ? 'track' : 'auto');
  const close = () => useEditor.getState().setDialog(null);

  return (
    <Modal
      title="Record options"
      subtitle="Recording happens live in the editor — you’ll see the waveform as you record."
      onClose={close}
      icon={<Mic size={18} />}
      footer={
        <>
          <span className="spacer" />
          <button className="btn btn-ghost" onClick={close}>Cancel</button>
          <button
            className="btn btn-rec"
            data-testid="rec-start"
            onClick={() => {
              close();
              void useRecording.getState().start(dest);
            }}
          >
            <Circle size={14} fill="currentColor" /> Start recording
          </button>
        </>
      }
    >
      <div className="params">
        <MicPicker />
        <div className="grid-2">
          <div className="field">
            <span className="field-label">Channels</span>
            <div className="segmented">
              <button className={s.recordChannels === 1 ? 'on' : ''} onClick={() => s.set({ recordChannels: 1 })}>Mono</button>
              <button className={s.recordChannels === 2 ? 'on' : ''} onClick={() => s.set({ recordChannels: 2 })}>Stereo</button>
            </div>
          </div>
          <label className="field">
            <span className="field-label">Record into</span>
            <select value={dest} onChange={(e) => setDest(e.target.value as RecordDest)} data-testid="rec-dest">
              {s.multitrack && <option value="track">New multitrack track</option>}
              <option value="auto">Automatic (new tab, or the empty file)</option>
              <option value="new">New tab</option>
              <option value="insert" disabled={!doc}>Current file at cursor</option>
              <option value="overdub" disabled={!doc}>Overdub (mix on top)</option>
            </select>
          </label>
        </div>
        <label className="check">
          <input type="checkbox" checked={s.recordVoiceProcessing} onChange={(e) => s.set({ recordVoiceProcessing: e.target.checked })} />
          Voice processing (echo cancel, noise suppression, auto gain) — best for calls, off for music
        </label>
      </div>
    </Modal>
  );
}
