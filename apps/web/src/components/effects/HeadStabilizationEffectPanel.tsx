'use client';

import type { HeadStabilizationEffect } from '@video-editor/shared';

interface Props {
  clipId: string;
  effect: HeadStabilizationEffect;
  onAdd: (clipId: string, effect: HeadStabilizationEffect) => void;
  onRemove: (clipId: string, type: string) => void;
  onUpdate: (clipId: string, type: string, updates: Partial<HeadStabilizationEffect>) => void;
  onProcess: (clipId: string) => void;
}

export function HeadStabilizationEffectPanel({ clipId, effect, onRemove, onUpdate, onProcess }: Omit<Props, 'onAdd'>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid rgba(0,212,160,0.20)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.50)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={effect.enabled}
          onChange={(e) => onUpdate(clipId, 'headStabilization', { enabled: e.target.checked })}
        />
        Enabled
      </label>
      {(
        [
          { key: 'smoothingX' as const, label: 'X Axis' },
          { key: 'smoothingY' as const, label: 'Y Axis' },
          { key: 'smoothingZ' as const, label: 'Z Zoom' },
        ] as const
      ).map(({ key, label }) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', width: 52, flexShrink: 0 }}>{label}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={effect[key]}
            style={{ flex: 1 }}
            onChange={(e) =>
              onUpdate(clipId, 'headStabilization', {
                [key]: parseFloat(e.target.value),
                status: 'pending',
              })
            }
          />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', width: 32, flexShrink: 0 }}>
            {Math.round(effect[key] * 100)}%
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <div style={{
          fontSize: 11,
          color: effect.status === 'done'
            ? '#4ade80'
            : effect.status === 'error'
            ? '#f87171'
            : effect.status === 'processing'
            ? '#fbbf24'
            : 'rgba(255,255,255,0.28)',
          flex: 1,
        }}>
          {effect.status === 'done' && 'Stabilized'}
          {effect.status === 'processing' && 'Processing...'}
          {effect.status === 'error' && 'Error – retry below'}
          {(effect.status === 'pending' || !effect.status) && 'Not processed'}
        </div>
        <button
          className="btn btn-ghost"
          style={{
            fontSize: 11,
            border: '1px solid rgba(0,212,160,0.30)',
            padding: '4px 10px',
            color: effect.status === 'processing' ? 'rgba(255,255,255,0.30)' : '#00d4a0',
            opacity: effect.status === 'processing' ? 0.5 : 1,
          }}
          disabled={effect.status === 'processing'}
          onClick={() => onProcess(clipId)}
        >
          Process
        </button>
        <button
          style={{ fontSize: 12, color: '#ff7090', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff9090'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff7090'; }}
          onClick={() => onRemove(clipId, 'headStabilization')}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export function HeadStabilizationEffectAddButton({ clipId, onAdd }: Pick<Props, 'clipId' | 'onAdd'>) {
  return (
    <button
      className="btn btn-ghost"
      style={{ fontSize: 12, border: '1px solid rgba(255,255,255,0.12)', padding: '4px 10px' }}
      onClick={() =>
        onAdd(clipId, {
          type: 'headStabilization',
          enabled: true,
          smoothingX: 0.7,
          smoothingY: 0.7,
          smoothingZ: 0.0,
          status: 'pending',
        })
      }
    >
      + Add
    </button>
  );
}
