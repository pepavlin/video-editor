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
      className="flex items-center gap-4 px-5 flex-shrink-0 border-b select-none"
      style={{
        height: 56,
        background: 'rgba(10,20,36,0.92)',
        backdropFilter: 'blur(16px)',
        borderColor: 'rgba(255,255,255,0.08)',
        boxShadow: 'inset 0 -1px 0 rgba(0,212,160,0.12)',
      }}
    >
      {/* Play/Pause button */}
      <button
        onClick={onToggle}
        className="rounded-full flex items-center justify-center flex-shrink-0 active:scale-95"
        style={{
          width: 48,
          height: 48,
          background: isPlaying
            ? 'linear-gradient(135deg, #00d4a0, #38bdf8)'
            : 'linear-gradient(135deg, #00d4a0, #38bdf8)',
          boxShadow: isPlaying
            ? '0 0 32px rgba(0,212,160,0.75), 0 0 10px rgba(56,189,248,0.4), 0 4px 12px rgba(0,0,0,0.35)'
            : '0 0 18px rgba(0,212,160,0.4), 0 4px 12px rgba(0,0,0,0.3)',
          border: '1.5px solid rgba(0,212,160,0.5)',
          transition: 'all 0.15s cubic-bezier(0.4,0,0.2,1)',
          animation: isPlaying ? 'glowPulse 2.5s ease-in-out infinite' : 'none',
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLElement).style.transform = 'scale(1.1)';
          (e.currentTarget as HTMLElement).style.boxShadow = '0 0 32px rgba(0,212,160,0.7), 0 6px 16px rgba(0,0,0,0.4)';
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLElement).style.transform = '';
          (e.currentTarget as HTMLElement).style.boxShadow = isPlaying
            ? '0 0 32px rgba(0,212,160,0.75), 0 0 10px rgba(56,189,248,0.4), 0 4px 12px rgba(0,0,0,0.35)'
            : '0 0 18px rgba(0,212,160,0.4), 0 4px 12px rgba(0,0,0,0.3)';
        }}
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="#040a08">
            <rect x="2" y="1" width="4" height="12" rx="1.5" />
            <rect x="8" y="1" width="4" height="12" rx="1.5" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="#040a08">
            <polygon points="3,1 13,7 3,13" />
          </svg>
        )}
      </button>

      {/* Current time */}
      <span className="font-mono text-sm min-w-[72px] tabular-nums font-semibold" style={{ color: '#7de0cc' }}>
        {formatTime(currentTime)}
      </span>

      {/* Seek bar */}
      <div
        className="flex-1 relative rounded-full cursor-pointer group"
        style={{ height: 6, background: 'rgba(255,255,255,0.08)' }}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
          onSeek(ratio * duration);
        }}
      >
        {/* Filled portion */}
        <div
          className="absolute left-0 top-0 h-full rounded-full overflow-hidden"
          style={{ width: `${progress}%`, transition: 'width 0.08s linear' }}
        >
          <div
            className="w-full h-full"
            style={{ background: 'linear-gradient(90deg, #00d4a0, #38bdf8)', boxShadow: '0 0 8px rgba(0,212,160,0.5)' }}
          />
          {/* Shimmer */}
          <div className="progress-shimmer" />
        </div>
        {/* Scrubber dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 rounded-full opacity-0 group-hover:opacity-100"
          style={{
            left: `calc(${progress}% - 8px)`,
            width: 16,
            height: 16,
            background: '#00d4a0',
            boxShadow: '0 0 10px rgba(0,212,160,0.8)',
            border: '2px solid rgba(255,255,255,0.8)',
            transition: 'opacity 0.15s',
          }}
        />
      </div>

      {/* Duration */}
      <span className="font-mono text-sm min-w-[72px] text-right tabular-nums" style={{ color: 'rgba(255,255,255,0.22)' }}>
        {formatTime(duration)}
      </span>
    </div>
  );
}
