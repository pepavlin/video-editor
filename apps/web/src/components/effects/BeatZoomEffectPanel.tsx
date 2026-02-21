'use client';

import type { BeatZoomEffect } from '@video-editor/shared';
import { Row } from '../inspector/InspectorLayout';

interface Props {
  clipId: string;
  effect: BeatZoomEffect;
  onAdd: (clipId: string, effect: BeatZoomEffect) => void;
  onRemove: (clipId: string, type: string) => void;
  onUpdate: (clipId: string, type: string, updates: Partial<BeatZoomEffect>) => void;
}

export function BeatZoomEffectPanel({ clipId, effect, onRemove, onUpdate }: Omit<Props, 'onAdd'>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid rgba(0,212,160,0.20)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.50)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={effect.enabled}
          onChange={(e) => onUpdate(clipId, 'beatZoom', { enabled: e.target.checked })}
        />
        Enabled
      </label>
      <Row label="Intensity">
        <input
          type="range"
          min={0.01}
          max={0.5}
          step={0.01}
          value={effect.intensity}
          style={{ width: '100%' }}
          onChange={(e) =>
            onUpdate(clipId, 'beatZoom', { intensity: parseFloat(e.target.value) })
          }
        />
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>{(effect.intensity * 100).toFixed(0)}%</span>
      </Row>
      <Row label="Duration">
        <input
          type="number"
          value={effect.durationMs}
          min={50}
          max={500}
          step={10}
          style={{ fontSize: 13 }}
          onChange={(e) =>
            onUpdate(clipId, 'beatZoom', { durationMs: parseInt(e.target.value) })
          }
        />
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>ms</span>
      </Row>
      <Row label="Easing">
        <select
          value={effect.easing}
          style={{ fontSize: 13 }}
          onChange={(e) =>
            onUpdate(clipId, 'beatZoom', { easing: e.target.value as BeatZoomEffect['easing'] })
          }
        >
          <option value="linear">Linear</option>
          <option value="easeOut">Ease Out</option>
          <option value="easeIn">Ease In</option>
          <option value="easeInOut">Ease In/Out</option>
        </select>
      </Row>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          style={{ fontSize: 12, color: '#ff7090', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff9090'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff7090'; }}
          onClick={() => onRemove(clipId, 'beatZoom')}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export function BeatZoomEffectAddButton({ clipId, onAdd }: Pick<Props, 'clipId' | 'onAdd'>) {
  return (
    <button
      className="btn btn-ghost"
      style={{ fontSize: 12, border: '1px solid rgba(255,255,255,0.12)', padding: '4px 10px' }}
      onClick={() =>
        onAdd(clipId, {
          type: 'beatZoom',
          enabled: true,
          intensity: 0.08,
          durationMs: 120,
          easing: 'easeOut',
        })
      }
    >
      + Add
    </button>
  );
}
