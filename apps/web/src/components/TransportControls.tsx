'use client';

import { formatTime } from '@/lib/utils';

interface Props {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLooping: boolean;
  onToggle: () => void;
  onLoopToggle: () => void;
  onSeek: (t: number) => void;
}

export default function TransportControls({ isPlaying, currentTime, duration, isLooping, onToggle, onLoopToggle, onSeek }: Props) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '0 20px',
        flexShrink: 0,
        height: 64,
        background: 'rgba(8,18,34,0.95)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        boxShadow: 'inset 0 -1px 0 rgba(0,212,160,0.10)',
        userSelect: 'none',
      }}
    >
      {/* Play/Pause button */}
      <button
        onClick={onToggle}
        style={{
          width: 52,
          height: 52,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: 'linear-gradient(135deg, #00d4a0, #38bdf8)',
          boxShadow: isPlaying
            ? '0 0 36px rgba(0,212,160,0.80), 0 0 12px rgba(56,189,248,0.45), 0 4px 14px rgba(0,0,0,0.35)'
            : '0 0 20px rgba(0,212,160,0.45), 0 4px 14px rgba(0,0,0,0.30)',
          border: '1.5px solid rgba(0,212,160,0.50)',
          cursor: 'pointer',
          transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
          animation: isPlaying ? 'glowPulse 2.5s ease-in-out infinite' : 'none',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.transform = 'scale(1.10)';
          (e.currentTarget as HTMLElement).style.boxShadow = '0 0 36px rgba(0,212,160,0.75), 0 6px 18px rgba(0,0,0,0.4)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.transform = '';
          (e.currentTarget as HTMLElement).style.boxShadow = isPlaying
            ? '0 0 36px rgba(0,212,160,0.80), 0 0 12px rgba(56,189,248,0.45), 0 4px 14px rgba(0,0,0,0.35)'
            : '0 0 20px rgba(0,212,160,0.45), 0 4px 14px rgba(0,0,0,0.30)';
        }}
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
      >
        {isPlaying ? (
          <svg width="16" height="16" viewBox="0 0 14 14" fill="#040a08">
            <rect x="2" y="1" width="4" height="12" rx="1.5" />
            <rect x="8" y="1" width="4" height="12" rx="1.5" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 14 14" fill="#040a08">
            <polygon points="3,1 13,7 3,13" />
          </svg>
        )}
      </button>

      {/* Loop button */}
      <button
        onClick={onLoopToggle}
        style={{
          width: 34,
          height: 34,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          background: isLooping
            ? 'linear-gradient(135deg, rgba(0,212,160,0.22), rgba(56,189,248,0.15))'
            : 'rgba(255,255,255,0.05)',
          boxShadow: isLooping
            ? '0 0 14px rgba(0,212,160,0.40), inset 0 0 0 1px rgba(0,212,160,0.55)'
            : 'inset 0 0 0 1px rgba(255,255,255,0.10)',
          border: 'none',
          cursor: 'pointer',
          transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
          color: isLooping ? '#00d4a0' : 'rgba(255,255,255,0.35)',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.background = isLooping
            ? 'linear-gradient(135deg, rgba(0,212,160,0.30), rgba(56,189,248,0.22))'
            : 'rgba(255,255,255,0.09)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.background = isLooping
            ? 'linear-gradient(135deg, rgba(0,212,160,0.22), rgba(56,189,248,0.15))'
            : 'rgba(255,255,255,0.05)';
        }}
        title={isLooping ? 'Loop: On' : 'Loop: Off'}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 2l4 4-4 4" />
          <path d="M3 11V9a4 4 0 0 1 4-4h14" />
          <path d="M7 22l-4-4 4-4" />
          <path d="M21 13v2a4 4 0 0 1-4 4H3" />
        </svg>
      </button>

      {/* Current time */}
      <span style={{
        fontFamily: 'ui-monospace, "SFMono-Regular", monospace',
        fontSize: 15,
        minWidth: 80,
        fontVariantNumeric: 'tabular-nums',
        fontWeight: 600,
        color: '#7de0cc',
      }}>
        {formatTime(currentTime)}
      </span>

      {/* Seek bar */}
      <div
        style={{
          flex: 1,
          position: 'relative',
          borderRadius: 6,
          cursor: 'pointer',
          height: 8,
          background: 'rgba(255,255,255,0.08)',
        }}
        className="group"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          onSeek(ratio * duration);
        }}
      >
        {/* Filled portion */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${progress}%`,
            borderRadius: 6,
            overflow: 'hidden',
            transition: 'width 0.08s linear',
          }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              background: 'linear-gradient(90deg, #00d4a0, #38bdf8)',
              boxShadow: '0 0 10px rgba(0,212,160,0.55)',
            }}
          />
          {/* Shimmer */}
          <div className="progress-shimmer" />
        </div>
        {/* Scrubber dot */}
        <div
          className="opacity-0 group-hover:opacity-100"
          style={{
            position: 'absolute',
            top: '50%',
            transform: 'translateY(-50%)',
            left: `calc(${progress}% - 10px)`,
            width: 20,
            height: 20,
            background: '#00d4a0',
            borderRadius: '50%',
            boxShadow: '0 0 12px rgba(0,212,160,0.85)',
            border: '2.5px solid rgba(255,255,255,0.85)',
            transition: 'opacity 0.15s',
          }}
        />
      </div>

      {/* Duration */}
      <span style={{
        fontFamily: 'ui-monospace, "SFMono-Regular", monospace',
        fontSize: 15,
        minWidth: 80,
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
        color: 'rgba(255,255,255,0.22)',
      }}>
        {formatTime(duration)}
      </span>
    </div>
  );
}
