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
  isMobile?: boolean;
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
  isMobile = false,
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
  const [isScrubbing, setIsScrubbing] = useState(false);

  const hasWorkArea = workArea != null && onWorkAreaChange != null;

  // Refs for direct DOM updates during playback, bypassing React render cycle
  const progressFillRef = useRef<HTMLDivElement>(null);
  const scrubDotRef = useRef<HTMLDivElement>(null);
  const timeDisplayRef = useRef<HTMLSpanElement>(null);
  const rafRef = useRef<number>(0);

  // Keep latest displayDuration/waStart in refs so the RAF loop always reads
  // up-to-date values without needing to restart when they change.
  const displayDurationRef = useRef(displayDuration);
  displayDurationRef.current = displayDuration;
  const waStartRef = useRef(waStart);
  waStartRef.current = waStart;

  // When NOT playing, sync progress bar width from React state so seeking and
  // paused-seek scrubbing are reflected immediately.
  useEffect(() => {
    if (isPlaying) return;
    const pct = Math.min(100, Math.max(0, progress));
    if (progressFillRef.current) {
      progressFillRef.current.style.transition = 'width 0.08s linear';
      progressFillRef.current.style.width = `${pct}%`;
    }
    if (scrubDotRef.current) {
      scrubDotRef.current.style.left = `calc(${pct}% - 10px)`;
    }
    if (timeDisplayRef.current) {
      timeDisplayRef.current.textContent = formatTime(displayTime);
    }
  }, [isPlaying, progress, displayTime]);

  // When playing, update progress bar directly via DOM at 60fps to guarantee
  // smooth updates regardless of React's render scheduling. React must NOT
  // control the `width` style on progressFillRef while this loop is active —
  // that's why we manage width exclusively via DOM refs here (and via the
  // effect above when paused).
  useEffect(() => {
    if (!isPlaying || !getTime) return;

    if (progressFillRef.current) {
      progressFillRef.current.style.transition = 'none';
    }

    const update = () => {
      const t = getTime();
      const dt = Math.max(0, t - waStartRef.current);
      const dd = displayDurationRef.current;
      const pct = dd > 0 ? (dt / dd) * 100 : 0;
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
  }, [isPlaying, getTime]);

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
          gap: isMobile ? 10 : 16,
          padding: isMobile ? '0 12px' : '0 20px',
          height: isMobile ? 52 : 64,
        }}
      >
        {/* Play/Pause button */}
        <button
          onClick={onToggle}
          style={{
            width: isMobile ? 44 : 52,
            height: isMobile ? 44 : 52,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            background: 'linear-gradient(135deg, #00d4a0, #38bdf8)',
            boxShadow: isPlaying
              ? '0 0 40px rgba(0,212,160,0.85), 0 0 14px rgba(56,189,248,0.50), 0 4px 14px rgba(0,0,0,0.35)'
              : '0 0 20px rgba(0,212,160,0.45), 0 4px 14px rgba(0,0,0,0.30)',
            border: '1.5px solid rgba(0,212,160,0.50)',
            cursor: 'pointer',
            transition: 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)',
            animation: isPlaying ? 'glowPulse 2.5s ease-in-out infinite' : 'none',
            position: 'relative',
            overflow: 'visible',
          }}
          onMouseEnter={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.transform = 'scale(1.12)';
            el.style.boxShadow = '0 0 40px rgba(0,212,160,0.80), 0 8px 22px rgba(0,0,0,0.4)';
          }}
          onMouseLeave={(e) => {
            const el = e.currentTarget as HTMLElement;
            el.style.transform = '';
            el.style.boxShadow = isPlaying
              ? '0 0 40px rgba(0,212,160,0.85), 0 0 14px rgba(56,189,248,0.50), 0 4px 14px rgba(0,0,0,0.35)'
              : '0 0 20px rgba(0,212,160,0.45), 0 4px 14px rgba(0,0,0,0.30)';
          }}
          onMouseDown={(e) => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(0.92)';
            (e.currentTarget as HTMLElement).style.transition = 'all 0.08s ease';
          }}
          onMouseUp={(e) => {
            (e.currentTarget as HTMLElement).style.transform = 'scale(1.12)';
            (e.currentTarget as HTMLElement).style.transition = 'all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)';
          }}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {/* Ripple ring when playing */}
          {isPlaying && (
            <>
              <span style={{
                position: 'absolute',
                inset: -6,
                borderRadius: '50%',
                border: '1.5px solid rgba(0,212,160,0.45)',
                animation: 'ripple 2s ease-out infinite',
                pointerEvents: 'none',
              }} />
              <span style={{
                position: 'absolute',
                inset: -6,
                borderRadius: '50%',
                border: '1.5px solid rgba(0,212,160,0.25)',
                animation: 'ripple 2s ease-out 0.7s infinite',
                pointerEvents: 'none',
              }} />
            </>
          )}
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
            fontSize: isMobile ? 13 : 15,
            minWidth: isMobile ? 60 : 80,
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
            height: isMobile ? 12 : 8,
            background: 'rgba(255,255,255,0.08)',
            // Enlarge touch hit area vertically via padding
            paddingTop: isMobile ? 8 : 4,
            paddingBottom: isMobile ? 8 : 4,
            marginTop: isMobile ? -8 : -4,
            marginBottom: isMobile ? -8 : -4,
            touchAction: 'none',
          }}
          className="group"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            onSeek(waStart + ratio * displayDuration);
          }}
          onTouchStart={(e) => {
            e.preventDefault();
            setIsScrubbing(true);
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
            onSeek(waStart + ratio * displayDuration);
          }}
          onTouchMove={(e) => {
            e.preventDefault();
            if (!isScrubbing) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / rect.width));
            onSeek(waStart + ratio * displayDuration);
          }}
          onTouchEnd={(e) => {
            e.preventDefault();
            setIsScrubbing(false);
          }}
        >
          {/* Filled portion — width driven exclusively via DOM ref (progressFillRef).
              React must NOT set width here; it would overwrite the RAF loop's updates. */}
          <div
            ref={progressFillRef}
            style={{
              position: 'absolute',
              left: 0,
              top: isMobile ? 8 : 4,
              height: isMobile ? 12 : 8,
              width: 0,
              borderRadius: 6,
              overflow: 'hidden',
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
          {/* Scrubber dot — always visible on mobile/touch, hover-only on desktop */}
          <div
            ref={scrubDotRef}
            className={isMobile ? '' : 'opacity-0 group-hover:opacity-100'}
            style={{
              position: 'absolute',
              top: '50%',
              transform: 'translateY(-50%)',
              left: `calc(0% - 10px)`,
              width: isMobile ? 24 : 20,
              height: isMobile ? 24 : 20,
              background: '#00d4a0',
              borderRadius: '50%',
              boxShadow: '0 0 12px rgba(0,212,160,0.85)',
              border: '2.5px solid rgba(255,255,255,0.85)',
              transition: 'opacity 0.15s',
              opacity: isMobile ? 1 : undefined,
              zIndex: 2,
            }}
          />
        </div>

        {/* Duration of the work area interval — hidden on mobile to save space */}
        {!isMobile && (
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
        )}
      </div>

      {/* ── Work area row: interval start / end inputs ── */}
      {hasWorkArea && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: isMobile ? 6 : 8,
            padding: isMobile ? '0 12px 8px' : '0 20px 10px',
            flexWrap: 'nowrap',
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
            {isMobile ? 'In/Out' : 'Interval'}
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
              width: isMobile ? 68 : 76,
              padding: '3px 6px',
              background: 'rgba(0,212,160,0.08)',
              border: '1px solid rgba(0,212,160,0.25)',
              borderRadius: 6,
              color: '#7de0cc',
              outline: 'none',
              textAlign: 'center',
              flexShrink: 0,
            }}
            title="Interval start (MM:SS.d)"
          />

          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 13, flexShrink: 0 }}>→</span>

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
              width: isMobile ? 68 : 76,
              padding: '3px 6px',
              background: 'rgba(0,212,160,0.08)',
              border: '1px solid rgba(0,212,160,0.25)',
              borderRadius: 6,
              color: '#7de0cc',
              outline: 'none',
              textAlign: 'center',
              flexShrink: 0,
            }}
            title="Interval end (MM:SS.d)"
          />

          {!isMobile && (
            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.20)', marginLeft: 2 }}>
              ({formatTime(displayDuration)} total)
            </span>
          )}
        </div>
      )}
    </div>
  );
}
