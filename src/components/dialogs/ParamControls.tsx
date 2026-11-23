import { ParamDef, Params } from '../../audio/effects';

export function ParamControls({ defs, values, onChange, compact }: { defs: ParamDef[]; values: Params; onChange: (v: Params) => void; compact?: boolean }) {
  return (
    <div className={compact ? 'params params-eq' : 'params'}>
      {defs.map((d) => {
        const id = `p-${d.key}`;
        if (d.type === 'select') {
          return (
            <label key={d.key} className="field" htmlFor={id}>
              <span className="field-label">{d.label}</span>
              <select id={id} value={String(values[d.key])} onChange={(e) => onChange({ ...values, [d.key]: e.target.value })}>
                {d.options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          );
        }
        const v = Number(values[d.key]);
        if (compact) {
          return (
            <label key={d.key} className="eq-band" htmlFor={id}>
              <span className="eq-val">{v > 0 ? '+' : ''}{v}</span>
              <input id={id} type="range" min={d.min} max={d.max} step={d.step} value={v} aria-label={`${d.label} Hz band`} onChange={(e) => onChange({ ...values, [d.key]: Number(e.target.value) })} />
              <span className="eq-label">{d.label}</span>
            </label>
          );
        }
        return (
          <div key={d.key} className="field">
            <div className="field-row">
              <label className="field-label" htmlFor={id}>{d.label}</label>
              <span className="field-num">
                <input
                  type="number"
                  aria-label={`${d.label} value`}
                  min={d.min}
                  max={d.max}
                  step={d.step}
                  value={v}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isNaN(n)) onChange({ ...values, [d.key]: Math.min(d.max, Math.max(d.min, n)) });
                  }}
                />
                {d.unit && <em>{d.unit}</em>}
              </span>
            </div>
            <input id={id} type="range" className="slider" min={d.min} max={d.max} step={d.step} value={v} style={{ ['--pct' as string]: `${((v - d.min) / (d.max - d.min)) * 100}%` }} onChange={(e) => onChange({ ...values, [d.key]: Number(e.target.value) })} />
          </div>
        );
      })}
    </div>
  );
}
