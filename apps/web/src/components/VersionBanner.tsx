'use client';

import { useEffect } from 'react';
import { useVersionCheck } from '@/hooks/useVersionCheck';

const AUTO_DISMISS_MS = 6_000;

const BANNER_BASE_STYLE: React.CSSProperties = {
  position: 'fixed',
  top: '16px',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 10000,
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '10px 16px',
  borderRadius: '12px',
  background: 'rgba(14, 26, 46, 0.96)',
  backdropFilter: 'blur(24px) saturate(1.5)',
  WebkitBackdropFilter: 'blur(24px) saturate(1.5)',
  border: '1px solid rgba(0,212,160,0.30)',
  boxShadow: '0 0 32px rgba(0,212,160,0.18), 0 8px 32px rgba(0,0,0,0.50)',
  animation: 'versionBannerIn 0.25s cubic-bezier(0.4,0,0.2,1) forwards',
  whiteSpace: 'nowrap',
};

const DISMISS_BTN_STYLE: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'rgba(255,255,255,0.40)',
  cursor: 'pointer',
  fontSize: '18px',
  lineHeight: 1,
  padding: '2px 4px',
  flexShrink: 0,
};

const KEYFRAMES = `
  @keyframes versionBannerIn {
    from { opacity: 0; transform: translateX(-50%) translateY(-10px); }
    to   { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
`;

// ─── Icons ────────────────────────────────────────────────────────────────────

function IconClock() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="7" stroke="#00d4a0" strokeWidth="1.5" opacity="0.55" />
      <path d="M8 4.5v3.5l2 2" stroke="#00d4a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="8" cy="8" r="7" stroke="#00d4a0" strokeWidth="1.5" opacity="0.55" />
      <path d="M5 8l2.5 2.5L11 5.5" stroke="#00d4a0" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function VersionBanner() {
  const { status, dismiss } = useVersionCheck();

  // Auto-dismiss the "welcome" toast after a few seconds.
  useEffect(() => {
    if (status !== 'welcome') return;
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [status, dismiss]);

  if (!status) return null;

  if (status === 'update-available') {
    return (
      <div role="status" aria-live="polite" style={BANNER_BASE_STYLE}>
        <style>{KEYFRAMES}</style>
        <IconClock />
        <span style={{ color: 'rgba(216,240,234,0.90)', fontSize: '13px', fontWeight: 500 }}>
          Dostupná nová verze
        </span>
        <button
          onClick={() => { dismiss(); window.location.reload(); }}
          style={{
            background: 'linear-gradient(135deg, #00d4a0, #38bdf8)',
            border: 'none',
            borderRadius: '7px',
            padding: '5px 13px',
            fontSize: '12px',
            fontWeight: 700,
            color: '#040a08',
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          Obnovit
        </button>
        <button onClick={dismiss} aria-label="Zavřít" style={DISMISS_BTN_STYLE}>
          ×
        </button>
      </div>
    );
  }

  // status === 'welcome'
  return (
    <div role="status" aria-live="polite" style={BANNER_BASE_STYLE}>
      <style>{KEYFRAMES}</style>
      <IconCheck />
      <span style={{ color: 'rgba(216,240,234,0.90)', fontSize: '13px', fontWeight: 500 }}>
        Vítejte v nové verzi!
      </span>
      <button onClick={dismiss} aria-label="Zavřít" style={DISMISS_BTN_STYLE}>
        ×
      </button>
    </div>
  );
}
