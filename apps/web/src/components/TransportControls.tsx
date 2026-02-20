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
  return (
    <div className="flex items-center gap-3 px-4 py-2 bg-surface-raised border-b border-surface-border select-none">
      {/* Play/Pause */}
      <button
        onClick={onToggle}
        className="w-9 h-9 rounded-full flex items-center justify-center bg-accent hover:bg-accent-hover transition-colors"
        title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
      >
        {isPlaying ? (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="white">
            <rect x="2" y="1" width="4" height="12" rx="1" />
            <rect x="8" y="1" width="4" height="12" rx="1" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 14 14" fill="white">
            <polygon points="3,1 13,7 3,13" />
          </svg>
        )}
      </button>

      {/* Time display */}
      <span className="font-mono text-sm text-gray-300 min-w-[72px]">
        {formatTime(currentTime)}
      </span>

      {/* Seek bar */}
      <div className="flex-1 relative h-1.5 bg-surface-border rounded-full cursor-pointer group"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - rect.left) / rect.width;
          onSeek(ratio * duration);
        }}
      >
        <div
          className="absolute left-0 top-0 h-full bg-accent rounded-full"
          style={{ width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%' }}
        />
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ left: duration > 0 ? `calc(${(currentTime / duration) * 100}% - 6px)` : '0' }}
        />
      </div>

      {/* Duration */}
      <span className="font-mono text-sm text-gray-500 min-w-[72px] text-right">
        {formatTime(duration)}
      </span>
    </div>
  );
}
