'use client';

import { useEffect, useRef, useState } from 'react';
import { formatTime, parseTime } from '@/lib/utils';

interface Props {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLooping: boolean;
  workArea?: { start: number; end: number } | null;
  onToggle: () => void;
  onLoopToggle: () => void;
  onSeek: (t: number) => void;
  /** Real-time position getter — bypasses React render latency for smooth progress updates. */
  getTime?: () => number;
  onWorkAreaChange?: (start: number, end: number) => void;
}

export default function TransportControls({
  isPlaying,
  currentTime,
  duration,
  isLooping,
  workArea,
  onToggle,
  onLoopToggle,
  onSeek,
  getTime,
  onWorkAreaChange,
}: Props) {
  // Time displayed relative to work area start so 00:00 = start of interval
  const waStart = workArea?.start ?? 0;
  const waEnd = workArea?.end ?? duration;
  const displayDuration = waEnd - waStart;
  const displayTime = Math.max(0, currentTime - waStart);
  const progress = displayDuration > 0 ? (displayTime / displayDuration) * 100 : 0;

  // Local edit state for work area inputs
  const [editStart, setEditStart] = useState<string | null>(null);
  const [editEnd, setEditEnd] = useState<string | null>(null);

  const hasWorkArea = workArea != null && onWorkAreaChange != null;

  // Refs for direct DOM updates during playback, bypassing React render cycle
  const progressFillRef = useRef<HTMLDivElement>(null);
  const scrubDotRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number>(0);

  // When playing, update progress bar directly via DOM to guarantee 60fps updates
  // regardless of React's render scheduling.
  useEffect(() => {
    if (!isPlaying || !getTime) return;

    const update = () => {
      const t = getTime();
      const dt = Math.max(0, t - waStart);
      const pct = displayDuration > 0 ? (dt / displayDuration) * 100 : 0;
      const clampedPct = Math.min(100, Math.max(0, pct));

      if (progressFillRef.current) {
        progressFillRef.current.style.width = `${clampedPct}%`;
      }
      if (scrubDotRef.current) {
        scrubDotRef.current.style.left = `calc(${clampedPct}% - 10px)`;
      }
      if (timeDisplayRef.current) {
        timeDisplayRef.current.textContent = formatTime(dt);
      }

      rafRef.current = requestAnimationFrame(update);
    };

    rafRef.current = requestAnimationFrame(update);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, displayDuration, waStart, getTime]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        background: 'rgba(8,18,34,0.95)',
        backdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        boxShadow: 'inset 0 -1px 0 rgba(0,212,160,0.10)',
        userSelect: 'none',
      }}
    >
      {/* ── Main row: play, loop, time, seek bar, duration ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          padding: '0 20px',
          height: 64,
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

        {/* Current time (relative to work area start) — updated via DOM ref during playback */}
        <span
          ref={timeDisplayRef}
          style={{
            fontFamily: 'ui-monospace, "SFMono-Regular", monospace',
            fontSize: 15,
            minWidth: 80,
            fontVariantNumeric: 'tabular-nums',
            fontWeight: 600,
            color: '#7de0cc',
          }}
        >
          {formatTime(displayTime)}
        </span>

        {/* Seek bar — spans only the work area range */}
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
            // Translate to absolute project time
            onSeek(waStart + ratio * displayDuration);
          }}
        >
          {/* Filled portion — width driven by DOM ref during playback */}
          <div
            ref={progressFillRef}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              height: '100%',
              width: `${progress}%`,
              borderRadius: 6,
              overflow: 'hidden',
              transition: isPlaying && getTime ? 'none' : 'width 0.08s linear',
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
            ref={scrubDotRef}
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

        {/* Duration of the work area interval */}
        <span style={{
          fontFamily: 'ui-monospace, "SFMono-Regular", monospace',
          fontSize: 15,
          minWidth: 80,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          color: 'rgba(255,255,255,0.22)',
        }}>
          {formatTime(displayDuration)}
        </span>
      </div>

      {/* ── Work area row: interval start / end inputs ── */}
      {hasWorkArea && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '0 20px 10px',
          }}
        >
          <span style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'rgba(0,212,160,0.55)',
            flexShrink: 0,
          }}>
            Interval
          </span>

          {/* Start input */}
          <input
            type="text"
            value={editStart ?? formatTime(workArea!.start)}
            onChange={(e) => setEditStart(e.target.value)}
            onFocus={() => setEditStart(formatTime(workArea!.start))}
            onBlur={() => {
              if (editStart !== null) {
                const parsed = parseTime(editStart);
                if (!isNaN(parsed) && isFinite(parsed)) {
                  const clamped = Math.max(0, Math.min(parsed, workArea!.end - 0.1));
                  onWorkAreaChange!(clamped, workArea!.end);
                }
                setEditStart(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') { setEditStart(null); (e.target as HTMLInputElement).blur(); }
            }}
            style={{
              fontFamily: 'ui-monospace, "SFMono-Regular", monospace',
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              width: 76,
              padding: '3px 6px',
              background: 'rgba(0,212,160,0.08)',
              border: '1px solid rgba(0,212,160,0.25)',
              borderRadius: 6,
              color: '#7de0cc',
              outline: 'none',
              textAlign: 'center',
            }}
            title="Interval start (MM:SS.d)"
          />

          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13 }}>→</span>

          {/* End input */}
          <input
            type="text"
            value={editEnd ?? formatTime(workArea!.end)}
            onChange={(e) => setEditEnd(e.target.value)}
            onFocus={() => setEditEnd(formatTime(workArea!.end))}
            onBlur={() => {
              if (editEnd !== null) {
                const parsed = parseTime(editEnd);
                if (!isNaN(parsed) && isFinite(parsed)) {
                  const clamped = Math.max(workArea!.start + 0.1, Math.min(parsed, duration));
                  onWorkAreaChange!(workArea!.start, clamped);
                }
                setEditEnd(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') { setEditEnd(null); (e.target as HTMLInputElement).blur(); }
            }}
            style={{
              fontFamily: 'ui-monospace, "SFMono-Regular", monospace',
              fontSize: 12,
              fontVariantNumeric: 'tabular-nums',
              width: 76,
              padding: '3px 6px',
              background: 'rgba(0,212,160,0.08)',
              border: '1px solid rgba(0,212,160,0.25)',
              borderRadius: 6,
              color: '#7de0cc',
              outline: 'none',
              textAlign: 'center',
            }}
            title="Interval end (MM:SS.d)"
          />

          <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.20)', marginLeft: 2 }}>
            ({formatTime(displayDuration)} total)
          </span>
        </div>
      )}
    </div>
  );
}
