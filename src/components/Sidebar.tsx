import { useMemo, useState } from 'react';
import { Search, Flag, X, ChevronRight } from 'lucide-react';
import { useEditor } from '../store/editor';
import { EFFECTS, EFFECT_CATEGORIES } from '../audio/effects';
import { stats } from '../audio/analysis';
import { length } from '../audio/buffer';
import { formatDb, formatTime, formatBytes } from '../app/format';
import { measureLoudness } from '../audio/loudness';
import { Spectrum } from './Meters';
import { useSettings } from '../store/settings';

type Panel = 'effects' | 'info' | 'markers' | 'history';

export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [panel, setPanel] = useState<Panel>('effects');
  const showSpectrum = useSettings((s) => s.showSpectrum);
  const [q, setQ] = useState('');
  const doc = useEditor((s) => s.active());
  const noiseProfile = useEditor((s) => s.noiseProfile);
  const st = useEditor.getState();
  const hasAudio = !!doc && length(doc.audio) > 0;

  const info = useMemo(() => {
    if (!doc || panel !== 'info') return null;
    return { all: stats(doc.audio), sel: doc.selection ? stats(doc.audio, doc.selection) : null, loud: length(doc.audio) < doc.audio.sampleRate * 600 ? measureLoudness(doc.audio) : null };
  }, [doc, panel]);

  const filtered = EFFECTS.filter((e) => (e.name + e.description + e.category).toLowerCase().includes(q.toLowerCase()));

  return (
    <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Side panel">
      <div className="sb-head">
        <div className="segmented sb-tabs" role="tablist">
          {(['effects', 'info', 'markers', 'history'] as Panel[]).map((p) => (
            <button key={p} role="tab" aria-selected={panel === p} className={panel === p ? 'on' : ''} onClick={() => setPanel(p)}>
              {p[0].toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
        <button className="icon-btn sb-close" aria-label="Close side panel" onClick={onClose}><X size={18} /></button>
      </div>

      <div className="sb-body">
        {panel === 'effects' && (
          <>
            <label className="search">
              <Search size={15} aria-hidden />
              <input placeholder="Search effects…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search effects" />
            </label>
            {EFFECT_CATEGORIES.map((cat) => {
              const list = filtered.filter((e) => e.category === cat);
              if (!list.length) return null;
              return (
                <section key={cat} className="fx-cat">
                  <h3>{cat}</h3>
                  {list.map((e) => (
                    <button
                      key={e.id}
                      className="fx-item"
                      disabled={!hasAudio || (e.stereoOnly && doc!.audio.channels.length < 2) || (e.needsProfile && !noiseProfile)}
                      title={e.needsProfile && !noiseProfile ? 'Grab a noise sample first (Restore → Grab Noise)' : undefined}
                      onClick={() => st.setDialog({ type: 'effect', effectId: e.id })}
                      data-testid={`sb-fx-${e.id}`}
                    >
                      <span>
                        <strong>{e.name}</strong>
                        <small>{e.description}</small>
                      </span>
                      <ChevronRight size={16} aria-hidden />
                    </button>
                  ))}
                </section>
              );
            })}
          </>
        )}

        {panel === 'info' && (
          doc && info ? (
            <dl className="info-list" data-testid="info">
              <div><dt>Name</dt><dd>{doc.name}</dd></div>
              <div><dt>Duration</dt><dd>{formatTime(length(doc.audio) / doc.audio.sampleRate)}</dd></div>
              <div><dt>Format</dt><dd>{doc.audio.sampleRate} Hz · {doc.audio.channels.length === 1 ? 'Mono' : `${doc.audio.channels.length} ch`} · 32-bit float</dd></div>
              <div><dt>Memory</dt><dd>{formatBytes(length(doc.audio) * 4 * doc.audio.channels.length)}</dd></div>
              <div><dt>Peak</dt><dd>{formatDb(info.all.peakDb)}</dd></div>
              <div><dt>RMS</dt><dd>{formatDb(info.all.rmsDb)}</dd></div>
              <div><dt>DC offset</dt><dd>{(info.all.dcOffset * 100).toFixed(3)} %</dd></div>
              <div><dt>Clipped samples</dt><dd className={info.all.clippedSamples ? 'warn-text' : ''}>{info.all.clippedSamples}</dd></div>
              {info.sel && (
                <>
                  <div className="info-sep"><dt>Selection</dt><dd>{formatTime(info.sel.duration)}</dd></div>
                  <div><dt>Sel. peak</dt><dd>{formatDb(info.sel.peakDb)}</dd></div>
                  <div><dt>Sel. RMS</dt><dd>{formatDb(info.sel.rmsDb)}</dd></div>
                </>
              )}
              {info.loud && (
                <>
                  <div className="info-sep"><dt>Loudness</dt><dd data-testid="info-lufs">{Number.isFinite(info.loud.integrated) ? `${info.loud.integrated.toFixed(1)} LUFS` : '—'}</dd></div>
                  <div><dt>True peak</dt><dd>{Number.isFinite(info.loud.truePeak) ? `${info.loud.truePeak.toFixed(1)} dBTP` : '—'}</dd></div>
                  <div><dt>Loudness range</dt><dd>{info.loud.range.toFixed(1)} LU</dd></div>
                </>
              )}
              <div><dt>Undo steps</dt><dd>{doc.history.size}</dd></div>
            </dl>
          ) : <p className="muted pad">Open a file to see its details.</p>
        )}

        {panel === 'history' && (
          doc ? (
            <ol className="history-list" data-testid="history-list">
              {(() => {
                const done = doc.history.undoLabels;
                const todo = doc.history.redoLabels;
                const items = [{ label: `Opened “${doc.name}”`, i: 0 }, ...done.map((l, k) => ({ label: l, i: k + 1 })), ...todo.map((l, k) => ({ label: l, i: done.length + 1 + k }))];
                const cur = done.length;
                return items.map((it) => (
                  <li key={it.i}>
                    <button className={`hist-item ${it.i === cur ? 'current' : it.i > cur ? 'future' : ''}`} onClick={() => st.historyJump(it.i - cur)} data-testid={`hist-${it.i}`}>
                      <span className="hist-n">{it.i}</span>
                      <span>{it.label}</span>
                      {it.i === cur && <em>current</em>}
                    </button>
                  </li>
                ));
              })()}
            </ol>
          ) : <p className="muted pad">Your edits will be listed here.</p>
        )}

        {panel === 'markers' && (
          <div className="markers">
            <button className="btn btn-secondary btn-sm full" disabled={!doc} onClick={st.addMarker}><Flag size={14} /> Add marker at cursor</button>
            {doc?.markers.length ? (
              <ul>
                {doc.markers.map((m) => (
                  <li key={m.id}>
                    <button className="marker-jump" onClick={() => st.setCursor(m.pos)}>
                      <Flag size={13} />
                      <input
                        value={m.label}
                        aria-label="Marker name"
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => useEditor.setState((s) => ({ docs: s.docs.map((d) => (d.id === doc.id ? { ...d, markers: d.markers.map((x) => (x.id === m.id ? { ...x, label: e.target.value } : x)) } : d)) }))}
                      />
                      <span>{formatTime(m.pos / doc.audio.sampleRate)}</span>
                    </button>
                    <button className="icon-btn" aria-label={`Remove ${m.label}`} onClick={() => st.removeMarker(m.id)}><X size={14} /></button>
                  </li>
                ))}
              </ul>
            ) : <p className="muted pad">No markers yet. Press M while editing to drop one at the cursor.</p>}
          </div>
        )}
      </div>

      {showSpectrum && (
        <div className="sb-spectrum">
          <div className="sb-label">Spectrum</div>
          <Spectrum />
        </div>
      )}
    </aside>
  );
}
