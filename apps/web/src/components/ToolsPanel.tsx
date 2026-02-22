'use client';

import React from 'react';
import type { Project, EffectType } from '@video-editor/shared';

interface ToolsPanelProps {
  project: Project | null;
  currentTime: number;
  selectedClipId: string | null;
  onAddText: (start: number, duration: number, text: string) => void;
  onAddLyrics: (start: number, duration: number) => void;
  onAddEffect: (effectType: EffectType, start: number, duration: number, parentTrackId?: string) => void;
}

interface ToolItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}

const EFFECT_OPTIONS: { type: EffectType; label: string; icon: string; color: string }[] = [
  { type: 'beatZoom',          label: 'Zoom',    icon: '⚡', color: 'rgba(251,191,36,0.85)' },
  { type: 'cutout',            label: 'Cutout',  icon: '✂',  color: 'rgba(52,211,153,0.85)' },
  { type: 'headStabilization', label: 'Stabilize', icon: '⦿', color: 'rgba(129,140,248,0.85)' },
  { type: 'cartoon',           label: 'Cartoon', icon: '◈',  color: 'rgba(251,146,60,0.85)' },
  { type: 'colorGrade',        label: 'Color',   icon: '◑',  color: 'rgba(248,113,113,0.85)' },
];

export default function ToolsPanel({
  project,
  currentTime,
  selectedClipId,
  onAddText,
  onAddLyrics,
  onAddEffect,
}: ToolsPanelProps) {
  const [showEffects, setShowEffects] = React.useState(false);

  const hasVideoTrack = project?.tracks.some(
    (t) => t.type === 'video' && t.clips.some((c) => !!c.assetId)
  ) ?? false;

  const tools: ToolItem[] = [
    {
      id: 'text',
      icon: (
        <span style={{ fontSize: 18, fontWeight: 800, fontFamily: 'serif', color: 'inherit', lineHeight: 1 }}>
          T
        </span>
      ),
      label: 'Text',
      description: 'Přidat textový overlay',
      onClick: () => onAddText(currentTime, 3, 'Text'),
    },
    {
      id: 'lyrics',
      icon: (
        <span style={{
          fontSize: 17,
          fontWeight: 700,
          background: 'linear-gradient(135deg, #c084fc, #818cf8)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          display: 'block',
          lineHeight: 1,
        }}>
          ♪
        </span>
      ),
      label: 'Lyrics',
      description: 'Přidat lyrics track',
      onClick: () => onAddLyrics(currentTime, 10),
    },
  ];

  const handleAddEffect = (type: EffectType) => {
    setShowEffects(false);
    let parentTrackId: string | undefined;
    if (project && selectedClipId) {
      for (const t of project.tracks) {
        if (t.type === 'video' && t.clips.some((c) => c.id === selectedClipId)) {
          parentTrackId = t.id;
          break;
        }
      }
    }
    if (!parentTrackId && project) {
      const vt = project.tracks.find((t) => t.type === 'video' && t.clips.some((c) => c.assetId))
        ?? project.tracks.find((t) => t.type === 'video');
      if (vt) parentTrackId = vt.id;
    }
    onAddEffect(type, currentTime, 3, parentTrackId);
  };

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: '8px 6px',
      gap: 6,
      overflowY: 'auto',
      overflowX: 'hidden',
    }}>
      {/* Section header */}
      <div style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.09em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)',
        padding: '0 2px 4px',
        borderBottom: '1px solid var(--border-subtle)',
        userSelect: 'none',
      }}>
        Přidat
      </div>

      {/* Tool buttons – 2-column icon grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 4,
      }}>
        {tools.map((tool) => (
          <IconToolButton
            key={tool.id}
            icon={tool.icon}
            label={tool.label}
            description={tool.description}
            enabled={hasVideoTrack}
            onClick={tool.onClick}
          />
        ))}
      </div>

      {/* Effect button – full width, expands effects grid below */}
      <EffectToolButton
        enabled={hasVideoTrack}
        expanded={showEffects}
        onToggle={() => setShowEffects((v) => !v)}
        onSelectEffect={handleAddEffect}
      />

      {/* Divider */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '2px 0' }} />

      {/* Video – drag hint */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        padding: '8px 4px',
        borderRadius: 8,
        opacity: 0.4,
        userSelect: 'none',
        cursor: 'default',
      }}>
        <div style={{
          width: 30,
          height: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 7,
          background: 'var(--surface-hover)',
          border: '1px solid var(--border-subtle)',
        }}>
          <VideoIcon />
        </div>
        <span style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.3 }}>
          Video
        </span>
      </div>

      {/* No video warning */}
      {!hasVideoTrack && project && (
        <div style={{
          marginTop: 'auto',
          padding: '6px 4px',
          borderRadius: 6,
          background: 'rgba(234,179,8,0.08)',
          border: '1px solid rgba(234,179,8,0.20)',
          fontSize: 9,
          color: 'rgba(234,179,8,0.85)',
          textAlign: 'center',
          lineHeight: 1.4,
          userSelect: 'none',
        }}>
          Nejprve přidej video
        </div>
      )}
    </div>
  );
}

// ─── EffectToolButton ──────────────────────────────────────────────────────────

function EffectToolButton({
  enabled,
  expanded,
  onToggle,
  onSelectEffect,
}: {
  enabled: boolean;
  expanded: boolean;
  onToggle: () => void;
  onSelectEffect: (type: EffectType) => void;
}) {
  const [hovered, setHovered] = React.useState(false);
  const [hoveredEffect, setHoveredEffect] = React.useState<EffectType | null>(null);

  return (
    <div style={{ width: '100%' }}>
      {/* Effect toggle button */}
      <button
        disabled={!enabled}
        onClick={onToggle}
        title={enabled ? 'Přidat efekt' : 'Nejprve přidej video do timeline'}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          padding: '8px 4px',
          borderRadius: expanded ? '8px 8px 0 0' : 8,
          border: `1px solid ${
            expanded && enabled
              ? 'rgba(251,146,60,0.55)'
              : hovered && enabled
              ? 'var(--border-default)'
              : 'var(--border-subtle)'
          }`,
          borderBottom: expanded && enabled ? '1px solid rgba(251,146,60,0.20)' : undefined,
          background: expanded && enabled
            ? 'rgba(251,146,60,0.12)'
            : hovered && enabled
            ? 'var(--surface-hover)'
            : 'transparent',
          cursor: enabled ? 'pointer' : 'not-allowed',
          opacity: enabled ? 1 : 0.35,
          transition: 'background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease',
          width: '100%',
          color: expanded && enabled
            ? 'rgba(251,146,60,0.95)'
            : hovered && enabled
            ? 'var(--text-primary)'
            : 'var(--text-secondary)',
          userSelect: 'none',
          WebkitTapHighlightColor: 'transparent',
        } as React.CSSProperties}
      >
        <div style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 8,
          background: expanded && enabled
            ? 'rgba(251,146,60,0.18)'
            : hovered && enabled
            ? 'var(--surface-base)'
            : 'var(--surface-hover)',
          border: `1px solid ${expanded && enabled ? 'rgba(251,146,60,0.40)' : 'var(--border-subtle)'}`,
          transition: 'background 0.15s ease, border-color 0.15s ease',
          flexShrink: 0,
        }}>
          <span style={{
            fontSize: 14,
            color: expanded && enabled ? 'rgba(251,146,60,0.95)' : 'inherit',
            lineHeight: 1,
          }}>✦</span>
        </div>
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.01em' }}>
          Effect
        </span>
      </button>

      {/* Expanded effects – 2-column icon grid */}
      {expanded && enabled && (
        <div style={{
          background: 'rgba(251,146,60,0.06)',
          border: '1px solid rgba(251,146,60,0.30)',
          borderTop: 'none',
          borderRadius: '0 0 8px 8px',
          padding: '6px 4px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 4,
        }}>
          {EFFECT_OPTIONS.map(({ type, label, icon, color }) => (
            <button
              key={type}
              onClick={() => onSelectEffect(type)}
              onMouseEnter={() => setHoveredEffect(type)}
              onMouseLeave={() => setHoveredEffect(null)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 3,
                padding: '7px 2px',
                background: hoveredEffect === type ? 'rgba(251,146,60,0.18)' : 'rgba(251,146,60,0.06)',
                border: `1px solid ${hoveredEffect === type ? 'rgba(251,146,60,0.40)' : 'rgba(251,146,60,0.15)'}`,
                borderRadius: 7,
                cursor: 'pointer',
                transition: 'background 0.12s ease, border-color 0.12s ease',
                WebkitTapHighlightColor: 'transparent',
              } as React.CSSProperties}
            >
              <span style={{
                fontSize: 15,
                color,
                lineHeight: 1,
              }}>
                {icon}
              </span>
              <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(251,146,60,0.85)', lineHeight: 1 }}>
                {label}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── IconToolButton ────────────────────────────────────────────────────────────

function IconToolButton({
  icon,
  label,
  description,
  enabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  enabled: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = React.useState(false);

  return (
    <button
      disabled={!enabled}
      onClick={onClick}
      title={enabled ? description : 'Nejprve přidej video do timeline'}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        padding: '8px 4px',
        borderRadius: 8,
        border: `1px solid ${hovered && enabled ? 'var(--border-default)' : 'var(--border-subtle)'}`,
        background: hovered && enabled ? 'var(--surface-hover)' : 'transparent',
        cursor: enabled ? 'pointer' : 'not-allowed',
        opacity: enabled ? 1 : 0.35,
        transition: 'background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease',
        color: hovered && enabled ? 'var(--text-primary)' : 'var(--text-secondary)',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        width: '100%',
        minHeight: 58,
      } as React.CSSProperties}
    >
      <div style={{
        width: 32,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        background: hovered && enabled ? 'var(--surface-base)' : 'var(--surface-hover)',
        border: '1px solid var(--border-subtle)',
        transition: 'background 0.15s ease',
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.01em', lineHeight: 1, textAlign: 'center' }}>
        {label}
      </span>
    </button>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function VideoIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-secondary)' }}>
      <rect x="1" y="3" width="10" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11 6.2L14.5 4.5v7L11 9.8" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
