'use client';

import { useState, useRef, useEffect } from 'react';

const WEBHOOK_URL = 'https://n8n.pavlin.dev/webhook/c6169b15-e4d2-4515-a059-4f6306819e1c';

type Status = 'idle' | 'sending' | 'sent' | 'error';

export default function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim() || status === 'sending') return;
    setStatus('sending');
    try {
      const res = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: message.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus('sent');
      setMessage('');
      setTimeout(() => {
        setStatus('idle');
        setOpen(false);
      }, 2500);
    } catch {
      setStatus('error');
      setTimeout(() => setStatus('idle'), 3000);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSubmit(e as unknown as React.FormEvent);
    }
    if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <>
      {/* Floating trigger button */}
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (status === 'sent' || status === 'error') setStatus('idle');
        }}
        title="Navrhnout zlepšení"
        aria-label="Napsat návrh"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 9999,
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          background: open
            ? 'linear-gradient(135deg, #05e8b0, #45caff)'
            : 'linear-gradient(135deg, #00d4a0, #38bdf8)',
          border: '1px solid rgba(0,212,160,0.40)',
          boxShadow: open
            ? '0 0 30px rgba(0,212,160,0.60), 0 4px 20px rgba(0,0,0,0.40)'
            : '0 0 18px rgba(0,212,160,0.35), 0 4px 14px rgba(0,0,0,0.35)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.18s cubic-bezier(0.4,0,0.2,1)',
          transform: open ? 'scale(1.08)' : 'scale(1)',
          color: '#040a08',
        }}
      >
        {open ? (
          /* Close X */
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
        ) : (
          /* Lightbulb / idea icon */
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 2a7 7 0 0 1 5 11.9V16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1v-2.1A7 7 0 0 1 12 2z"
              fill="currentColor"
              opacity="0.9"
            />
            <rect x="8.5" y="18" width="7" height="1.5" rx="0.75" fill="currentColor" opacity="0.7"/>
            <rect x="9.5" y="20.5" width="5" height="1.5" rx="0.75" fill="currentColor" opacity="0.5"/>
          </svg>
        )}
      </button>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: 'fixed',
            bottom: '88px',
            right: '24px',
            zIndex: 9998,
            width: '320px',
            borderRadius: '16px',
            background: 'rgba(14, 26, 46, 0.96)',
            backdropFilter: 'blur(32px) saturate(1.6) brightness(1.04)',
            WebkitBackdropFilter: 'blur(32px) saturate(1.6) brightness(1.04)',
            border: '1px solid rgba(0,212,160,0.25)',
            boxShadow: '0 0 40px rgba(0,212,160,0.18), 0 20px 60px rgba(0,0,0,0.55)',
            animation: 'feedbackPanelIn 0.22s cubic-bezier(0.4,0,0.2,1) forwards',
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '14px 16px 10px',
              borderBottom: '1px solid rgba(255,255,255,0.07)',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            <span
              style={{
                background: 'linear-gradient(135deg, #00d4a0, #38bdf8)',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
                fontWeight: 700,
                fontSize: '14px',
              }}
            >
              Napsat návrh
            </span>
            <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '12px', marginLeft: 'auto' }}>
              Ctrl+Enter pro odeslání
            </span>
          </div>

          {/* Body */}
          <div style={{ padding: '12px 16px 14px' }}>
            {status === 'sent' ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '20px 0',
                  color: '#00d4a0',
                  textAlign: 'center',
                }}
              >
                <svg width="36" height="36" viewBox="0 0 36 36" fill="none">
                  <circle cx="18" cy="18" r="17" stroke="#00d4a0" strokeWidth="2" opacity="0.4"/>
                  <path d="M11 18l5 5 9-9" stroke="#00d4a0" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span style={{ fontWeight: 600, fontSize: '14px' }}>
                  Návrh byl poslán k implementaci
                </span>
              </div>
            ) : (
              <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <textarea
                  ref={textareaRef}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Jak bychom mohli tuto stránku zlepšit?"
                  rows={4}
                  disabled={status === 'sending'}
                  style={{
                    resize: 'none',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: '10px',
                    padding: '10px 12px',
                    fontSize: '13px',
                    color: '#d8f0ea',
                    outline: 'none',
                    width: '100%',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                    fontFamily: 'inherit',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'rgba(0,212,160,0.45)';
                    e.target.style.boxShadow = '0 0 0 3px rgba(0,212,160,0.10)';
                    e.target.style.background = 'rgba(0,212,160,0.04)';
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(255,255,255,0.10)';
                    e.target.style.boxShadow = 'none';
                    e.target.style.background = 'rgba(255,255,255,0.05)';
                  }}
                />
                {status === 'error' && (
                  <p style={{ color: '#ff6b6b', fontSize: '12px', margin: 0 }}>
                    Nepodařilo se odeslat návrh. Zkuste to znovu.
                  </p>
                )}
                <button
                  type="submit"
                  disabled={!message.trim() || status === 'sending'}
                  style={{
                    background:
                      !message.trim() || status === 'sending'
                        ? 'rgba(0,212,160,0.25)'
                        : 'linear-gradient(135deg, #00d4a0, #38bdf8)',
                    border: '1px solid rgba(0,212,160,0.40)',
                    borderRadius: '9px',
                    padding: '9px 16px',
                    fontSize: '13px',
                    fontWeight: 700,
                    color: !message.trim() || status === 'sending' ? 'rgba(255,255,255,0.35)' : '#040a08',
                    cursor: !message.trim() || status === 'sending' ? 'not-allowed' : 'pointer',
                    transition: 'all 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '6px',
                  }}
                >
                  {status === 'sending' ? (
                    <>
                      <svg width="14" height="14" viewBox="0 0 14 14" style={{ animation: 'spin 0.8s linear infinite' }}>
                        <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="20 15" fill="none"/>
                      </svg>
                      Odesílám…
                    </>
                  ) : (
                    <>
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M1 7h12M8 2l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      Odeslat návrh
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes feedbackPanelIn {
          from { opacity: 0; transform: translateY(12px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}
