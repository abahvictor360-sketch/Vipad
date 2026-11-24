import { useState } from 'react';
import { Play, Square, RotateCcw, Wand2, Save, Trash2 } from 'lucide-react';
import { BUILTIN_PRESETS, userPresets, saveUserPreset, deleteUserPreset } from '../../audio/presets';
import { Modal } from './Modal';
import { ParamControls } from './ParamControls';
import { EFFECTS_BY_ID, defaultParams } from '../../audio/effects';
import { useEditor } from '../../store/editor';
import { slice, length } from '../../audio/buffer';
import { runEffect } from '../../audio/runEffect';
import { player } from '../../audio/player';
import { formatTime } from '../../app/format';

export function EffectDialog({ effectId }: { effectId: string }) {
  const e = EFFECTS_BY_ID[effectId];
  const last = useEditor((s) => s.lastParams[effectId]);
  const doc = useEditor((s) => s.active());
  const [params, setParams] = useState(() => last ?? defaultParams(e));
  const [previewing, setPreviewing] = useState(false);
  const [preset, setPreset] = useState('');
  const [users, setUsers] = useState(() => userPresets(effectId));
  const builtins = Object.keys(BUILTIN_PRESETS[effectId] ?? {});
  const close = () => {
    player.stop();
    useEditor.getState().setDialog(null);
  };
  if (!doc) return null;
  const sr = doc.audio.sampleRate;
  const range = doc.selection ?? { start: 0, end: length(doc.audio) };
  const scope = doc.selection ? `Selection · ${formatTime((range.end - range.start) / sr)}` : `Whole file · ${formatTime(length(doc.audio) / sr)}`;

  const preview = async () => {
    if (previewing) {
      player.stop();
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    const clip = slice(doc.audio, { start: range.start, end: Math.min(range.end, range.start + sr * 8) });
    try {
      const out = await runEffect(effectId, clip, params);
      player.preview(out);
      const unsub = player.subscribe(() => {
        if (!player.playing) {
          setPreviewing(false);
          unsub();
        }
      });
    } catch {
      setPreviewing(false);
    }
  };

  return (
    <Modal
      title={e.name}
      subtitle={`${e.description}  ·  ${scope}`}
      onClose={close}
      wide={effectId === 'eq'}
      icon={<Wand2 size={18} />}
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => setParams(defaultParams(e))} disabled={!e.params.length}>
            <RotateCcw size={16} /> Reset
          </button>
          <span className="spacer" />
          <button className="btn btn-secondary" onClick={preview} data-testid="effect-preview">
            {previewing ? <Square size={16} /> : <Play size={16} />} {previewing ? 'Stop' : 'Preview'}
          </button>
          <button
            className="btn btn-primary"
            data-testid="effect-apply"
            onClick={() => {
              close();
              void useEditor.getState().applyEffect(effectId, params);
            }}
          >
            Apply
          </button>
        </>
      }
    >
      {e.params.length > 0 && (
        <div className="preset-row">
          <label className="field preset-field">
            <span className="field-label">Preset</span>
            <select
              value={preset}
              data-testid="preset-select"
              onChange={(ev) => {
                const v = ev.target.value;
                setPreset(v);
                if (v === '') setParams(defaultParams(e));
                else if (v.startsWith('b:')) setParams({ ...defaultParams(e), ...BUILTIN_PRESETS[effectId][v.slice(2)] });
                else if (v.startsWith('u:')) setParams({ ...defaultParams(e), ...users[v.slice(2)] });
              }}
            >
              <option value="">Default settings</option>
              {builtins.length > 0 && <optgroup label="Built-in">{builtins.map((n) => <option key={n} value={`b:${n}`}>{n}</option>)}</optgroup>}
              {Object.keys(users).length > 0 && <optgroup label="My presets">{Object.keys(users).map((n) => <option key={n} value={`u:${n}`}>{n}</option>)}</optgroup>}
            </select>
          </label>
          <button className="btn btn-ghost btn-sm" data-testid="preset-save" onClick={() => {
            const name = prompt('Save these settings as a preset named:', preset.startsWith('u:') ? preset.slice(2) : '');
            if (!name?.trim()) return;
            saveUserPreset(effectId, name.trim(), params);
            setUsers(userPresets(effectId));
            setPreset(`u:${name.trim()}`);
            useEditor.getState().toast(`Preset “${name.trim()}” saved`, 'success');
          }}><Save size={14} /> Save preset</button>
          {preset.startsWith('u:') && (
            <button className="icon-btn" aria-label="Delete this preset" title="Delete preset" onClick={() => {
              deleteUserPreset(effectId, preset.slice(2));
              setUsers(userPresets(effectId));
              setPreset('');
            }}><Trash2 size={15} /></button>
          )}
        </div>
      )}
      {e.params.length ? (
        <ParamControls defs={e.params} values={params} onChange={setParams} compact={effectId === 'eq'} />
      ) : (
        <p className="muted">This effect has no settings. Preview it or apply it directly.</p>
      )}
    </Modal>
  );
}
