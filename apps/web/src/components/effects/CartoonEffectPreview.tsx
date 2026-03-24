'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { EffectClipConfig } from '@video-editor/shared';
import { processCartoonFrame, processAiStyleFrame } from '@video-editor/elements';

interface Props {
  /** URL to the proxy video (e.g. `/files/${asset.proxyPath}`) */
  proxyUrl: string;
  /** Current effect configuration */
  cfg: EffectClipConfig;
  /** Source time in the video to capture the frame from (seconds) */
  sourceTime?: number;
}

/**
 * Captures a single frame from the proxy video and applies the cartoon effect
 * (classic or aiStyle) to show a before/after preview in the Inspector panel.
 *
 * Uses a hidden <video> element to seek and capture a frame, then runs the
 * same Canvas 2D processing functions used by the real-time preview pipeline.
 */
export function CartoonEffectPreview({ proxyUrl, cfg, sourceTime }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalCanvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameReadyRef = useRef(false);
  const processingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [showOriginal, setShowOriginal] = useState(false);
  const [splitPosition, setSplitPosition] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const PREVIEW_WIDTH = 240;
  const PREVIEW_HEIGHT = 135; // 16:9 aspect

  // Load video and seek to frame
  useEffect(() => {
    if (!proxyUrl) return;

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    videoRef.current = video;
    frameReadyRef.current = false;
    setLoading(true);

    const onSeeked = () => {
      frameReadyRef.current = true;
      setLoading(false);
    };

    const onLoaded = () => {
      const seekTo = sourceTime ?? Math.min(video.duration * 0.25, 1.0);
      video.currentTime = seekTo;
    };

    video.addEventListener('seeked', onSeeked);
    video.addEventListener('loadeddata', onLoaded);
    video.src = proxyUrl;

    return () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('loadeddata', onLoaded);
      video.pause();
      video.removeAttribute('src');
      video.load();
      videoRef.current = null;
      frameReadyRef.current = false;
    };
  }, [proxyUrl, sourceTime]);

  // Process frame when cfg changes or frame becomes ready
  const processFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const origCanvas = originalCanvasRef.current;
    if (!video || !canvas || !origCanvas || !frameReadyRef.current || processingRef.current) return;

    processingRef.current = true;

    // Determine actual dimensions preserving aspect ratio
    const vw = video.videoWidth || PREVIEW_WIDTH;
    const vh = video.videoHeight || PREVIEW_HEIGHT;
    const aspect = vw / vh;
    const drawW = PREVIEW_WIDTH;
    const drawH = Math.round(PREVIEW_WIDTH / aspect);

    canvas.width = drawW;
    canvas.height = drawH;
    origCanvas.width = drawW;
    origCanvas.height = drawH;

    // Draw original frame
    const origCtx = origCanvas.getContext('2d');
    if (origCtx) {
      origCtx.drawImage(video, 0, 0, drawW, drawH);
    }

    // Apply cartoon effect
    const bounds = { x: 0, y: 0, w: drawW, h: drawH };
    let result: HTMLCanvasElement | null = null;

    if (cfg.cartoonMode === 'aiStyle') {
      result = processAiStyleFrame(video, bounds, cfg);
    } else {
      result = processCartoonFrame(video, bounds, cfg);
    }

    const ctx = canvas.getContext('2d');
    if (ctx && result) {
      ctx.clearRect(0, 0, drawW, drawH);
      ctx.drawImage(result, 0, 0, drawW, drawH);
    } else if (ctx) {
      // Fallback: just draw the original
      ctx.drawImage(video, 0, 0, drawW, drawH);
    }

    processingRef.current = false;
  }, [cfg]);

  // Re-process when config changes or frame ready
  useEffect(() => {
    if (!loading && frameReadyRef.current) {
      // Debounce processing
      const timer = setTimeout(processFrame, 50);
      return () => clearTimeout(timer);
    }
  }, [loading, cfg, processFrame]);

  // Handle split drag
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isDragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSplitPosition(pct);
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const actualHeight = (() => {
    const video = videoRef.current;
    if (video && video.videoWidth && video.videoHeight) {
      return Math.round(PREVIEW_WIDTH / (video.videoWidth / video.videoHeight));
    }
    return PREVIEW_HEIGHT;
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {/* Preview label + toggle */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
          Preview
        </span>
        <div style={{ display: 'flex', gap: 2 }}>
          {(['split', 'before', 'after'] as const).map((mode) => (
            <button
              key={mode}
              style={{
                fontSize: 10,
                padding: '2px 6px',
                border: '1px solid',
                borderColor: (mode === 'split' && !showOriginal) || (mode === 'before' && showOriginal) || (mode === 'after' && false)
                  ? 'rgba(132,204,22,0.50)'
                  : 'var(--border)',
                borderRadius: 3,
                background:
                  (mode === 'split' && !showOriginal ? 'rgba(132,204,22,0.10)' :
                   mode === 'before' && showOriginal ? 'rgba(132,204,22,0.10)' :
                   'transparent'),
                color:
                  (mode === 'split' && !showOriginal ? 'rgba(132,204,22,0.90)' :
                   mode === 'before' && showOriginal ? 'rgba(132,204,22,0.90)' :
                   'var(--text-muted)'),
                cursor: 'pointer',
                fontWeight: 500,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
              onClick={() => {
                if (mode === 'split') setShowOriginal(false);
                else if (mode === 'before') setShowOriginal(true);
              }}
            >
              {mode === 'split' ? 'Split' : mode === 'before' ? 'Original' : 'Effect'}
            </button>
          ))}
        </div>
      </div>

      {/* Preview canvas container */}
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: PREVIEW_WIDTH,
          height: actualHeight,
          borderRadius: 6,
          overflow: 'hidden',
          border: '1px solid var(--border)',
          background: '#000',
          cursor: isDragging ? 'col-resize' : 'default',
          userSelect: 'none',
        }}
      >
        {loading && (
          <div style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(0,0,0,0.6)',
            zIndex: 10,
          }}>
            <div style={{
              width: 20,
              height: 20,
              border: '2px solid rgba(132,204,22,0.30)',
              borderTopColor: 'rgba(132,204,22,0.90)',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }} />
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        )}

        {/* Original frame (underneath or visible based on mode) */}
        <canvas
          ref={originalCanvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: PREVIEW_WIDTH,
            height: actualHeight,
            display: showOriginal ? 'block' : 'block',
          }}
        />

        {/* Processed frame (clipped in split mode) */}
        <canvas
          ref={canvasRef}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: PREVIEW_WIDTH,
            height: actualHeight,
            clipPath: showOriginal
              ? 'none'
              : `inset(0 ${100 - splitPosition}% 0 0)`,
            opacity: showOriginal ? 0 : 1,
          }}
        />

        {/* Split divider line */}
        {!showOriginal && (
          <>
            <div
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${splitPosition}%`,
                width: 2,
                background: 'rgba(255,255,255,0.80)',
                transform: 'translateX(-1px)',
                zIndex: 5,
                pointerEvents: 'none',
              }}
            />
            {/* Drag handle */}
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: `${splitPosition}%`,
                transform: 'translate(-50%, -50%)',
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: 'rgba(255,255,255,0.95)',
                border: '2px solid rgba(132,204,22,0.80)',
                cursor: 'col-resize',
                zIndex: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              onMouseDown={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
            >
              <svg width="8" height="10" viewBox="0 0 8 10" fill="none">
                <path d="M1 0v10M4 0v10M7 0v10" stroke="rgba(132,204,22,0.80)" strokeWidth="1" />
              </svg>
            </div>

            {/* Labels */}
            <span style={{
              position: 'absolute',
              top: 4,
              left: 4,
              fontSize: 9,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.70)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              zIndex: 5,
              textShadow: '0 1px 3px rgba(0,0,0,0.6)',
              pointerEvents: 'none',
            }}>
              Effect
            </span>
            <span style={{
              position: 'absolute',
              top: 4,
              right: 4,
              fontSize: 9,
              fontWeight: 600,
              color: 'rgba(255,255,255,0.70)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              zIndex: 5,
              textShadow: '0 1px 3px rgba(0,0,0,0.6)',
              pointerEvents: 'none',
            }}>
              Original
            </span>
          </>
        )}

        {showOriginal && (
          <span style={{
            position: 'absolute',
            top: 4,
            left: 4,
            fontSize: 9,
            fontWeight: 600,
            color: 'rgba(255,255,255,0.70)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            zIndex: 5,
            textShadow: '0 1px 3px rgba(0,0,0,0.6)',
            pointerEvents: 'none',
          }}>
            Original
          </span>
        )}
      </div>
    </div>
  );
}
