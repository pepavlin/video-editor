'use client';

import React from 'react';
import type { Project } from '@video-editor/shared';

interface ToolsPanelProps {
  project: Project | null;
  currentTime: number;
  onAddText: (start: number, duration: number, text: string) => void;
  onAddLyrics: (start: number, duration: number) => void;
}

interface ToolItem {
  id: string;
  icon: React.ReactNode;
  label: string;
  description: string;
  onClick: () => void;
}

export default function ToolsPanel({ project, currentTime, onAddText, onAddLyrics }: ToolsPanelProps) {
  // Tools are only enabled when there's at least one video track with a real video clip
  const hasVideoTrack = project?.tracks.some(
    (t) => t.type === 'video' && t.clips.some((c) => !!c.assetId)
  ) ?? false;

  const tools: ToolItem[] = [
    {
      id: 'text',
      icon: (
        <span style={{ fontSize: 17, fontWeight: 800, fontFamily: 'serif', color: 'inherit' }}>
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
          fontSize: 16,
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

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      padding: '8px 4px',
      gap: 1,
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
        padding: '0 6px 5px',
        borderBottom: '1px solid var(--border-subtle)',
        marginBottom: 3,
        userSelect: 'none',
      }}>
        Přidat prvek
      </div>

      {/* Tool buttons */}
      {tools.map((tool) => (
        <ToolButton
          key={tool.id}
          icon={tool.icon}
          label={tool.label}
          description={tool.description}
          enabled={hasVideoTrack}
          onClick={tool.onClick}
        />
      ))}

      {/* Divider */}
      <div style={{ borderTop: '1px solid var(--border-subtle)', margin: '4px 4px' }} />

      {/* Video – drag hint */}
      <div style={{
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: '4px 6px',
        borderRadius: 6,
        opacity: 0.5,
        userSelect: 'none',
        cursor: 'default',
      }}>
        <div style={{
          width: 26,
          height: 26,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          background: 'var(--surface-hover)',
          border: '1px solid var(--border-subtle)',
          flexShrink: 0,
        }}>
          <VideoIcon />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>
            Video
          </span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.3 }}>
            Přetáhni z Media panelu
          </span>
        </div>
      </div>

      {/* No video warning */}
      {!hasVideoTrack && project && (
        <div style={{
          marginTop: 'auto',
          padding: '6px 6px',
          borderRadius: 6,
          background: 'rgba(234,179,8,0.08)',
          border: '1px solid rgba(234,179,8,0.20)',
          fontSize: 10,
          color: 'rgba(234,179,8,0.85)',
          textAlign: 'center',
          lineHeight: 1.4,
          userSelect: 'none',
        }}>
          Nejprve přidej video do timeline
        </div>
      )}
    </div>
  );
}

// ─── ToolButton ───────────────────────────────────────────────────────────────

function ToolButton({
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
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        padding: '4px 6px',
        borderRadius: 6,
        border: `1px solid ${hovered && enabled ? 'var(--border-default)' : 'transparent'}`,
        background: hovered && enabled ? 'var(--surface-hover)' : 'transparent',
        cursor: enabled ? 'pointer' : 'not-allowed',
        opacity: enabled ? 1 : 0.35,
        transition: 'background 0.15s ease, border-color 0.15s ease, opacity 0.15s ease',
        width: '100%',
        color: hovered && enabled ? 'var(--text-primary)' : 'var(--text-secondary)',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
        textAlign: 'left',
      } as React.CSSProperties}
    >
      <div style={{
        width: 26,
        height: 26,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        background: hovered && enabled ? 'var(--surface-base)' : 'var(--surface-hover)',
        border: '1px solid var(--border-subtle)',
        transition: 'background 0.15s ease',
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.01em', lineHeight: 1.2 }}>
          {label}
        </span>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', lineHeight: 1.2 }}>
          {description}
        </span>
      </div>
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
