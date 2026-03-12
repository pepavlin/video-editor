'use client';

import { Row } from '../inspector/InspectorLayout';
import { SnapSlider } from './SnapSlider';

interface CutoutEffect {
  type: 'cutout';
  enabled: boolean;
  background: { type: 'solid' | 'video'; color?: string; assetId?: string };
  maskStatus?: 'pending' | 'processing' | 'done' | 'error';
  maskBlur?: number;
  maskExpand?: number;
  maskThreshold?: number;
}

interface Props {
  clipId: string;
  effect: CutoutEffect;
  onAdd: (clipId: string, effect: CutoutEffect) => Promise<void>;
  onRemove: (clipId: string, type: string) => void;
  onUpdate: (clipId: string, type: string, updates: Partial<CutoutEffect>) => void;
}

const MASK_SLIDERS = [
  { key: 'maskThreshold' as const, label: 'Threshold', min: 0, max: 255, step: 1, defaultValue: 128, format: (v: number) => String(Math.round(v)) },
  { key: 'maskExpand' as const, label: 'Expand', min: -10, max: 10, step: 0.5, defaultValue: 0, format: (v: number) => v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1) },
  { key: 'maskBlur' as const, label: 'Feather', min: 0, max: 20, step: 0.5, defaultValue: 0, format: (v: number) => `${v.toFixed(1)}px` },
] as const;

export function CutoutEffectPanel({ clipId, effect, onRemove, onUpdate }: Omit<Props, 'onAdd'>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid rgba(13,148,136,0.25)' }}>
      <div style={{ fontSize: 12, color: 'rgba(15,23,42,0.45)' }}>
        Mask: {effect.maskStatus ?? 'unknown'}
      </div>
      <Row label="BG Type">
        <select
          value={effect.background.type}
          style={{ fontSize: 13 }}
          onChange={(e) =>
            onUpdate(clipId, 'cutout', {
              background: {
                ...effect.background,
                type: e.target.value as 'solid' | 'video',
              },
            })
          }
        >
          <option value="solid">Solid Color</option>
          <option value="video">Video</option>
        </select>
      </Row>
      {effect.background.type === 'solid' && (
        <Row label="Color">
          <input
            type="color"
            value={effect.background.color ?? '#000000'}
            onChange={(e) =>
              onUpdate(clipId, 'cutout', {
                background: { ...effect.background, color: e.target.value },
              })
            }
            style={{ width: '100%', height: 36 }}
          />
        </Row>
      )}

      {/* Mask adjustment sliders */}
      <div style={{ fontSize: 11, color: 'rgba(15,23,42,0.35)', marginTop: 4 }}>
        Mask Refinement
      </div>
      {MASK_SLIDERS.map(({ key, label, min, max, step, defaultValue, format }) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'rgba(15,23,42,0.45)', width: 70, flexShrink: 0 }}>
            {label}
          </span>
          <SnapSlider
            min={min}
            max={max}
            step={step}
            value={effect[key] ?? defaultValue}
            defaultValue={defaultValue}
            onChange={(v) => onUpdate(clipId, 'cutout', { [key]: v })}
          />
          <span style={{ fontSize: 12, color: 'rgba(15,23,42,0.45)', width: 40, flexShrink: 0 }}>
            {format(effect[key] ?? defaultValue)}
          </span>
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          style={{ fontSize: 12, color: '#ff7090', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff9090'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff7090'; }}
          onClick={() => onRemove(clipId, 'cutout')}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export function CutoutEffectAddButton({ clipId, onAdd }: Pick<Props, 'clipId' | 'onAdd'>) {
  return (
    <button
      className="btn btn-ghost"
      style={{ fontSize: 12, border: '1px solid rgba(15,23,42,0.12)', padding: '4px 10px' }}
      onClick={async () => {
        await onAdd(clipId, {
          type: 'cutout',
          enabled: true,
          background: { type: 'solid', color: '#000000' },
          maskStatus: 'pending',
        });
      }}
    >
      + Add
    </button>
  );
}
