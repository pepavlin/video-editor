'use client';

interface CartoonEffect {
  type: 'cartoon';
  enabled: boolean;
  edgeStrength: number;
  colorSimplification: number;
  saturation: number;
}

interface Props {
  clipId: string;
  effect: CartoonEffect;
  onAdd: (clipId: string, effect: CartoonEffect) => void;
  onRemove: (clipId: string, type: string) => void;
  onUpdate: (clipId: string, type: string, updates: Partial<CartoonEffect>) => void;
}

export function CartoonEffectPanel({ clipId, effect, onRemove, onUpdate }: Omit<Props, 'onAdd'>) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingLeft: 12, borderLeft: '2px solid rgba(0,212,160,0.20)' }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'rgba(255,255,255,0.50)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={effect.enabled}
          onChange={(e) => onUpdate(clipId, 'cartoon', { enabled: e.target.checked })}
        />
        Enabled
      </label>
      {(
        [
          { key: 'edgeStrength' as const, label: 'Edges', min: 0, max: 1, format: (v: number) => `${Math.round(v * 100)}%` },
          { key: 'colorSimplification' as const, label: 'Flatten', min: 0, max: 1, format: (v: number) => `${Math.round(v * 100)}%` },
          { key: 'saturation' as const, label: 'Saturation', min: 0, max: 2, format: (v: number) => `${v.toFixed(1)}×` },
        ] as const
      ).map(({ key, label, min, max, format }) => (
        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', width: 70, flexShrink: 0 }}>{label}</span>
          <input
            type="range"
            min={min}
            max={max}
            step={0.05}
            value={effect[key]}
            style={{ flex: 1 }}
            onChange={(e) =>
              onUpdate(clipId, 'cartoon', { [key]: parseFloat(e.target.value) })
            }
          />
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.35)', width: 36, flexShrink: 0 }}>
            {format(effect[key])}
          </span>
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          style={{ fontSize: 12, color: '#ff7090', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff9090'; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = '#ff7090'; }}
          onClick={() => onRemove(clipId, 'cartoon')}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

export function CartoonEffectAddButton({ clipId, onAdd }: Pick<Props, 'clipId' | 'onAdd'>) {
  return (
    <button
      className="btn btn-ghost"
      style={{ fontSize: 12, border: '1px solid rgba(255,255,255,0.12)', padding: '4px 10px' }}
      onClick={() =>
        onAdd(clipId, {
          type: 'cartoon',
          enabled: true,
          edgeStrength: 0.6,
          colorSimplification: 0.5,
          saturation: 1.5,
        })
      }
    >
      + Add
    </button>
  );
}
