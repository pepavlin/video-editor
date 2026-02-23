'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { CHANGELOG } from '@/data/changelog';

export const OPEN_CHANGELOG_EVENT = 'open-changelog';

const OVERLAY_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 10001,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: 'rgba(15,23,42,0.45)',
  backdropFilter: 'blur(4px)',
  WebkitBackdropFilter: 'blur(4px)',
  animation: 'changelogOverlayIn 0.18s ease forwards',
};

const MODAL_STYLE: React.CSSProperties = {
  background: 'rgba(255,255,255,0.98)',
  borderRadius: '20px',
  border: '1px solid rgba(15,23,42,0.08)',
  boxShadow: '0 8px 40px rgba(15,23,42,0.18), 0 2px 8px rgba(15,23,42,0.08)',
  width: '480px',
  maxWidth: 'calc(100vw - 32px)',
  maxHeight: 'calc(100vh - 64px)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  animation: 'changelogModalIn 0.22s cubic-bezier(0.4,0,0.2,1) forwards',
};

const KEYFRAMES = `
  @keyframes changelogOverlayIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes changelogModalIn {
    from { opacity: 0; transform: scale(0.96) translateY(8px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
`;

// ─── Sub-components ────────────────────────────────────────────────────────────

function IconSparkle() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <path
        d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.42 1.42M11.54 11.54l1.41 1.41M3.05 12.95l1.42-1.41M11.54 4.46l1.41-1.41"
        stroke="#0d9488"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8" r="2.5" fill="#0d9488" opacity="0.85" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ─── Component ─────────────────────────────────────────────────────────────────

export default function ChangelogModal() {
  const [open, setOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Listen for programmatic open requests from other components (e.g. VersionBanner)
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(OPEN_CHANGELOG_EVENT, handler);
    return () => window.removeEventListener(OPEN_CHANGELOG_EVENT, handler);
  }, []);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, close]);

  // Close on overlay click
  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current) close();
  }

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Přehled změn"
      style={OVERLAY_STYLE}
      onClick={handleOverlayClick}
    >
      <style>{KEYFRAMES}</style>
      <div style={MODAL_STYLE}>
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '16px 20px 12px',
            borderBottom: '1px solid rgba(15,23,42,0.07)',
            flexShrink: 0,
          }}
        >
          <IconSparkle />
          <span style={{ fontWeight: 700, fontSize: '15px', color: '#0f172a' }}>
            Co je nového
          </span>
          <button
            onClick={close}
            aria-label="Zavřít"
            style={{
              marginLeft: 'auto',
              background: 'none',
              border: 'none',
              color: 'rgba(15,23,42,0.38)',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '6px',
              transition: 'color 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = '#0f172a';
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(15,23,42,0.06)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = 'rgba(15,23,42,0.38)';
              (e.currentTarget as HTMLButtonElement).style.background = 'none';
            }}
          >
            <IconClose />
          </button>
        </div>

        {/* Body */}
        <div style={{ overflowY: 'auto', padding: '16px 20px 20px', flex: 1 }}>
          {CHANGELOG.length === 0 ? (
            <p style={{ color: 'rgba(15,23,42,0.45)', fontSize: '13px', margin: 0 }}>
              Žádné záznamy.
            </p>
          ) : (
            CHANGELOG.map((entry, idx) => (
              <div
                key={entry.date}
                style={{ marginBottom: idx < CHANGELOG.length - 1 ? '20px' : 0 }}
              >
                {/* Date badge */}
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: idx === 0 ? 'rgba(13,148,136,0.10)' : 'rgba(15,23,42,0.05)',
                    borderRadius: '20px',
                    padding: '3px 10px',
                    marginBottom: '10px',
                  }}
                >
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      color: idx === 0 ? '#0d9488' : 'rgba(15,23,42,0.50)',
                      letterSpacing: '0.01em',
                    }}
                  >
                    {entry.title}
                  </span>
                  {idx === 0 && (
                    <span
                      style={{
                        fontSize: '10px',
                        fontWeight: 700,
                        color: '#ffffff',
                        background: '#0d9488',
                        borderRadius: '10px',
                        padding: '1px 6px',
                        lineHeight: '16px',
                      }}
                    >
                      nejnovější
                    </span>
                  )}
                </div>

                {/* Change items */}
                <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {entry.items.map((item) => (
                    <li
                      key={item}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: '8px',
                        fontSize: '13px',
                        color: '#0f172a',
                        lineHeight: '1.5',
                      }}
                    >
                      <span
                        style={{
                          width: '5px',
                          height: '5px',
                          borderRadius: '50%',
                          background: '#0d9488',
                          marginTop: '7px',
                          flexShrink: 0,
                          opacity: 0.7,
                        }}
                      />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
