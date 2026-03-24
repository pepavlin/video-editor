'use client';

import { useCallback } from 'react';
import type { ErrorLog as ErrorLogType, ErrorEntry } from '@/hooks/useErrorLog';

const SOURCE_LABELS: Record<ErrorEntry['source'], string> = {
  aiStyle: 'AI Style',
  cutout: 'Cutout',
  headStab: 'Head Stabilization',
  export: 'Export',
  beats: 'Beat Detection',
  lyrics: 'Lyrics',
  sync: 'Audio Sync',
  import: 'Import',
  network: 'Network',
  unknown: 'Error',
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

interface ErrorLogProps {
  errorLog: ErrorLogType;
  isMobile?: boolean;
}

export default function ErrorLog({ errorLog, isMobile }: ErrorLogProps) {
  const { errors, isOpen, hasUnread, toggle, clearErrors, removeError } = errorLog;

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    toggle();
  }, [toggle]);

  return (
    <>
      {/* Toggle button – always visible */}
      <button
        onClick={handleToggle}
        title={isOpen ? 'Hide error log' : 'Show error log'}
        style={{
          position: 'fixed',
          bottom: isMobile ? 'calc(68px + env(safe-area-inset-bottom, 0px) + 8px)' : 20,
          left: 12,
          zIndex: 60,
          background: errors.length > 0
            ? 'linear-gradient(135deg, rgba(239,68,68,0.25), rgba(239,68,68,0.10))'
            : 'rgba(255,255,255,0.06)',
          border: errors.length > 0
            ? '1px solid rgba(239,68,68,0.4)'
            : '1px solid rgba(255,255,255,0.10)',
          borderRadius: 10,
          color: errors.length > 0 ? '#fca5a5' : 'var(--text-secondary, #888)',
          padding: '6px 12px',
          fontSize: 12,
          fontWeight: 500,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          transition: 'all 0.2s ease',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        {errors.length > 0 ? `${errors.length} error${errors.length > 1 ? 's' : ''}` : 'Log'}
        {hasUnread && (
          <span style={{
            width: 7, height: 7,
            borderRadius: '50%',
            background: '#ef4444',
            flexShrink: 0,
            animation: 'ripple 1.6s ease-out infinite',
          }} />
        )}
      </button>

      {/* Panel */}
      {isOpen && (
        <div
          style={{
            position: 'fixed',
            bottom: isMobile ? 'calc(68px + env(safe-area-inset-bottom, 0px) + 52px)' : 64,
            left: 12,
            zIndex: 60,
            width: isMobile ? 'calc(100vw - 24px)' : 420,
            maxHeight: isMobile ? '50vh' : 360,
            background: 'var(--bg-panel, rgba(24,24,27,0.96))',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 12,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}
        >
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '10px 14px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}>
            <span style={{ color: 'var(--text-primary, #fff)', fontSize: 13, fontWeight: 600 }}>
              Error Log
            </span>
            {errors.length > 0 && (
              <button
                onClick={clearErrors}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-secondary, #888)',
                  fontSize: 11,
                  cursor: 'pointer',
                  padding: '2px 8px',
                  borderRadius: 4,
                }}
              >
                Clear all
              </button>
            )}
          </div>

          {/* Error list */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
            {errors.length === 0 ? (
              <div style={{
                padding: '24px 14px',
                textAlign: 'center',
                color: 'var(--text-secondary, #888)',
                fontSize: 12,
              }}>
                No errors recorded
              </div>
            ) : (
              errors.slice().reverse().map((err) => (
                <ErrorItem key={err.id} entry={err} onRemove={removeError} />
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}

function ErrorItem({ entry, onRemove }: { entry: ErrorEntry; onRemove: (id: string) => void }) {
  return (
    <div style={{
      padding: '8px 14px',
      borderBottom: '1px solid rgba(255,255,255,0.03)',
      fontSize: 12,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          <span style={{
            background: 'rgba(239,68,68,0.15)',
            color: '#fca5a5',
            padding: '1px 6px',
            borderRadius: 4,
            fontSize: 10,
            fontWeight: 600,
            flexShrink: 0,
          }}>
            {SOURCE_LABELS[entry.source]}
          </span>
          <span style={{ color: 'var(--text-primary, #fff)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {entry.title}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <span style={{ color: 'var(--text-secondary, #666)', fontSize: 10 }}>
            {formatTime(entry.timestamp)}
          </span>
          <button
            onClick={() => onRemove(entry.id)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-secondary, #666)',
              cursor: 'pointer',
              padding: 0,
              fontSize: 14,
              lineHeight: 1,
            }}
            title="Dismiss"
          >
            &times;
          </button>
        </div>
      </div>
      <div style={{ color: 'var(--text-secondary, #aaa)', marginTop: 3, lineHeight: 1.4, wordBreak: 'break-word' }}>
        {entry.message}
      </div>
      {entry.details && entry.details.length > 0 && (
        <details style={{ marginTop: 4 }}>
          <summary style={{ color: 'var(--text-secondary, #888)', fontSize: 11, cursor: 'pointer' }}>
            Log details ({entry.details.length} lines)
          </summary>
          <pre style={{
            marginTop: 4,
            padding: 8,
            background: 'rgba(0,0,0,0.3)',
            borderRadius: 6,
            fontSize: 10,
            lineHeight: 1.5,
            color: '#d4d4d8',
            overflowX: 'auto',
            maxHeight: 120,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            {entry.details.join('\n')}
          </pre>
        </details>
      )}
    </div>
  );
}
