'use client';

import { Row } from '../inspector/InspectorLayout';

interface CutoutEffect {
  type: 'cutout';
  enabled: boolean;
  background: { type: 'solid' | 'video'; color?: string; assetId?: string };
  maskStatus?: 'pending' | 'processing' | 'done' | 'error';
}

interface Props {
  clipId: string;
  effect: CutoutEffect;
  onAdd: (clipId: string, effect: CutoutEffect) => Promise<void>;
  onRemove: (clipId: string, type: string) => void;
  onUpdate: (clipId: string, type: string, updates: Partial<CutoutEffect>) => void;
}

export function CutoutEffectPanel({ clipId, effect, onRemove, onUpdate }: Omit<Props, 'onAdd'>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid rgba(0,212,160,0.20)' }}>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.38)' }}>
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
      style={{ fontSize: 12, border: '1px solid rgba(255,255,255,0.12)', padding: '4px 10px' }}
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
