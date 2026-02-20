'use client';

import { formatTime } from '@/lib/utils';

interface Props {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  onToggle: () => void;
  onSeek: (t: number) => void;
}

export default function TransportControls({ isPlaying, currentTime, duration, onToggle, onSeek }: Props) {
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div
      className="flex items-center gap-4 px-5 py-3 flex-shrink-0 border-b select-none"
      style={{
        background: 'rgba(8,18,32,0.88)',
        backdropFilter: 'blur(12px)',
        borderColor: 'rgba(0,212,160,0.18)',
      }}
    >
      {/* Play/Pause button */}
      <button
        onClick={onToggle}
        className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-150 active:scale-95"
        style={{
          background: 'linear-gradient(135deg, #00d4a0, #38bdf8)',
          boxShadow: isPlaying
            ? '0 0 24px rgba(0,212,160,0.55), 0 0 8px rgba(56,189,248,0.4)'
            : '0 0 14px rgba(0,212,160,0.35)',
          border: '1px solid rgba(0,212,160,0.4)',
        }}
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
      >
        {isPlaying ? (
          <svg width="13" height="13" viewBox="0 0 13 13" fill="#040a08">
            <rect x="1.5" y="0.5" width="4" height="12" rx="1.5" />
            <rect x="7.5" y="0.5" width="4" height="12" rx="1.5" />
          </svg>
        ) : (
          <svg width="13" height="13" viewBox="0 0 13 13" fill="#040a08">
            <polygon points="2.5,0.5 12.5,6.5 2.5,12.5" />
          </svg>
        )}
      </button>

      {/* Current time */}
      <span className="font-mono text-sm min-w-[72px] tabular-nums" style={{ color: '#9dd4c8' }}>
        {formatTime(currentTime)}
      </span>

      {/* Seek bar */}
      <div
        className="flex-1 relative h-2 rounded-full cursor-pointer group"
        style={{ background: 'rgba(0,212,160,0.1)' }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          onSeek(ratio * duration);
        }}
      >
        {/* Filled portion */}
        <div
          className="absolute left-0 top-0 h-full rounded-full transition-none"
          style={{
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #00d4a0, #38bdf8)',
            boxShadow: '0 0 8px rgba(0,212,160,0.4)',
          }}
        />
        {/* Scrubber dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          style={{
            left: `calc(${progress}% - 8px)`,
            background: '#00d4a0',
            boxShadow: '0 0 8px rgba(0,212,160,0.7)',
          }}
        />
      </div>

      {/* Duration */}
      <span className="font-mono text-sm min-w-[72px] text-right tabular-nums" style={{ color: 'rgba(0,212,160,0.4)' }}>
        {formatTime(duration)}
      </span>
    </div>
  );
}
