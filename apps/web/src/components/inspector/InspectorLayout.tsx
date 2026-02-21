'use client';

import { useState } from 'react';

// ─── Section ─────────────────────────────────────────────────────────────────

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
      <button
        className="flex items-center justify-between w-full text-left"
        style={{
          padding: '14px 16px',
          transition: 'background 0.15s ease',
        }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.10em',
          color: 'rgba(0,212,160,0.80)',
        }}>
          {title}
        </span>
        <span style={{
          color: 'rgba(0,212,160,0.40)',
          display: 'inline-block',
          fontSize: 14,
          transform: open ? 'rotate(0deg)' : 'rotate(-90deg)',
          transition: 'transform 0.2s cubic-bezier(0.4,0,0.2,1)',
        }}>▾</span>
      </button>
      <div className={`section-body ${open ? 'open' : 'closed'}`}>
        <div className="section-inner">
          <div style={{ padding: '4px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg"
      style={{
        padding: '4px 8px',
        margin: '0 -8px',
        transition: 'background 0.12s ease',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.04)'; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = ''; }}
    >
      <span style={{
        fontSize: 13,
        color: 'rgba(255,255,255,0.35)',
        width: 80,
        flexShrink: 0,
      }}>{label}</span>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

// ─── NumInput ─────────────────────────────────────────────────────────────────

export function NumInput({
  value,
  onChange,
  min,
  max,
  step = 0.01,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{ fontSize: 13 }}
    />
  );
}
