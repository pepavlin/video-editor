'use client';

import { SnapSlider } from './SnapSlider';

interface ColorGradeEffect {
  type: 'colorGrade';
  enabled: boolean;
  contrast: number;         // 0-2, default 1
  brightness: number;       // 0-2, default 1
  colorSaturation: number;  // 0-2, default 1
  hue: number;              // -180 to 180, default 0
  shadows: number;          // -1 to 1, default 0
  highlights: number;       // -1 to 1, default 0
}

interface Props {
  clipId: string;
  effect: ColorGradeEffect;
  onAdd: (clipId: string, effect: ColorGradeEffect) => void;
  onRemove: (clipId: string, type: string) => void;
  onUpdate: (clipId: string, type: string, updates: Partial<ColorGradeEffect>) => void;
}

const SLIDERS = [
  { key: 'contrast' as const,        label: 'Contrast',    min: 0,    max: 2,   step: 0.05, defaultValue: 1,  format: (v: number) => v.toFixed(2) },
  { key: 'brightness' as const,      label: 'Brightness',  min: 0,    max: 2,   step: 0.05, defaultValue: 1,  format: (v: number) => v.toFixed(2) },
  { key: 'colorSaturation' as const, label: 'Saturation',  min: 0,    max: 2,   step: 0.05, defaultValue: 1,  format: (v: number) => v.toFixed(2) },
  { key: 'hue' as const,             label: 'Hue',         min: -180, max: 180, step: 1,    defaultValue: 0,  format: (v: number) => `${v.toFixed(0)}°` },
  { key: 'shadows' as const,         label: 'Shadows',     min: -1,   max: 1,   step: 0.05, defaultValue: 0,  format: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}` },
  { key: 'highlights' as const,      label: 'Highlights',  min: -1,   max: 1,   step: 0.05, defaultValue: 0,  format: (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}` },
] as const;

export function ColorGradeEffectPanel({ clipId, effect, onRemove, onUpdate }: Omit<Props, 'onAdd'>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid rgba(248,113,113,0.25)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(15,23,42,0.60)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={effect.enabled}
          onChange={(e) => onUpdate(clipId, 'colorGrade', { enabled: e.target.checked })}
        />
        Enabled
      </label>
      {SLIDERS.map(({ key, label, min, max, step, defaultValue, format }) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'rgba(15,23,42,0.45)', width: 70, flexShrink: 0 }}>{label}</span>
          <SnapSlider
            min={min}
            max={max}
            step={step}
            value={effect[key]}
            defaultValue={defaultValue}
            onChange={(v) => onUpdate(clipId, 'colorGrade', { [key]: v })}
          />
          <span style={{ fontSize: 12, color: 'rgba(15,23,42,0.45)', width: 40, flexShrink: 0 }}>
            {format(effect[key])}
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          style={{ fontSize: 12, color: '#ff7090', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff9090'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff7090'; }}
          onClick={() => onRemove(clipId, 'colorGrade')}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export function ColorGradeEffectAddButton({ clipId, onAdd }: Pick<Props, 'clipId' | 'onAdd'>) {
  return (
    <button
      className="btn btn-ghost"
      style={{ fontSize: 12, border: '1px solid rgba(15,23,42,0.12)', padding: '4px 10px' }}
      onClick={() =>
        onAdd(clipId, {
          type: 'colorGrade',
          enabled: true,
          contrast: 1,
          brightness: 1,
          colorSaturation: 1,
          hue: 0,
          shadows: 0,
          highlights: 0,
        })
      }
    >
      + Add
    </button>
  );
}
