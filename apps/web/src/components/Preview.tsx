'use client';

import { useEffect, useRef, useCallback } from 'react';
import type { Project, Asset, BeatsData, Clip, Transform, TextStyle } from '@video-editor/shared';
import { getBeatZoomScale, clamp } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  project: Project | null;
  assets: Asset[];
  currentTime: number;
  isPlaying: boolean;
  beatsData: Map<string, BeatsData>;
  selectedClipId: string | null;
  onClipSelect: (clipId: string | null) => void;
  onClipUpdate: (clipId: string, updates: Partial<Clip>) => void;
}

interface Bounds {
  x: number; y: number; w: number; h: number;
}

type Handle = 'tl' | 'tr' | 'bl' | 'br' | 'rotate';

type DragState =
  | { type: 'none' }
  | {
      type: 'move';
      clipId: string;
      startMouseX: number; startMouseY: number;
      startTX: number; startTY: number;
    }
  | {
      type: 'scale';
      clipId: string;
      handle: Handle;
      startMouseX: number; startMouseY: number;
      startScale: number;
      boundsW: number; boundsH: number;
    }
  | {
      type: 'rotate';
      clipId: string;
      centerX: number; centerY: number;
      startAngle: number; startRotation: number;
    };

// ─── Constants ────────────────────────────────────────────────────────────────

const HANDLE_RADIUS = 7;
const ROTATE_HANDLE_OFFSET = 28;
const DEFAULT_TRANSFORM: Transform = { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 };
const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Arial',
  fontSize: 96,
  color: '#ffffff',
  bold: true,
  italic: false,
  align: 'center',
};

// ─── Video element cache ──────────────────────────────────────────────────────

const videoElementCache = new Map<string, HTMLVideoElement>();

function getOrCreateVideoEl(assetId: string, src: string): HTMLVideoElement {
  if (!videoElementCache.has(assetId)) {
    const el = document.createElement('video');
    el.src = src;
    el.preload = 'auto';
    el.muted = true;
    el.crossOrigin = 'anonymous';
    el.style.display = 'none';
    document.body.appendChild(el);
    videoElementCache.set(assetId, el);
  }
  return videoElementCache.get(assetId)!;
}

// ─── Bounds helpers ───────────────────────────────────────────────────────────

function getVideoBounds(
  transform: Transform,
  videoEl: HTMLVideoElement | null,
  W: number,
  H: number
): Bounds {
  const vW = videoEl?.videoWidth || W;
  const vH = videoEl?.videoHeight || H;
  const scale = transform.scale;
  const targetAR = W / H;
  const videoAR = vW / vH;
  let drawW: number, drawH: number;
  if (videoAR > targetAR) {
    drawH = H * scale;
    drawW = drawH * videoAR;
  } else {
    drawW = W * scale;
    drawH = drawW / videoAR;
  }
  const x = (W - drawW) / 2 + transform.x;
  const y = (H - drawH) / 2 + transform.y;
  return { x, y, w: drawW, h: drawH };
}

function getTextBounds(
  clip: Clip,
  transform: Transform,
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number
): Bounds {
  const style = clip.textStyle ?? DEFAULT_TEXT_STYLE;
  const fontSize = Math.round((style.fontSize / 1920) * H * transform.scale);
  const font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${fontSize}px ${style.fontFamily}`;
  ctx.save();
  ctx.font = font;
  const text = clip.textContent ?? 'Text';
  const measured = ctx.measureText(text);
  ctx.restore();
  const tw = measured.width;
  const th = fontSize * 1.4;
  const cx = W / 2 + transform.x;
  const cy = H / 2 + transform.y;
  return { x: cx - tw / 2, y: cy - th / 2, w: tw, h: th };
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function isInRect(mx: number, my: number, b: Bounds): boolean {
  return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
}

function getHandlePositions(bounds: Bounds): Record<Handle, [number, number]> {
  const { x, y, w, h } = bounds;
  const cx = x + w / 2;
  return {
    tl: [x, y],
    tr: [x + w, y],
    bl: [x, y + h],
    br: [x + w, y + h],
    rotate: [cx, y - ROTATE_HANDLE_OFFSET],
  };
}

// ─── Canvas drawing helpers ───────────────────────────────────────────────────

function drawSelectionOverlay(
  ctx: CanvasRenderingContext2D,
  bounds: Bounds,
  rotation: number
) {
  const { x, y, w, h } = bounds;
  const cx = x + w / 2;
  const cy = y + h / 2;

  ctx.save();
  if (rotation !== 0) {
    ctx.translate(cx, cy);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  // Dashed selection rect
  ctx.strokeStyle = '#00d4a0';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 3]);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);

  // Rotation handle line + circle
  ctx.beginPath();
  ctx.moveTo(cx, y);
  ctx.lineTo(cx, y - ROTATE_HANDLE_OFFSET);
  ctx.strokeStyle = '#00d4a0';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const handles = getHandlePositions(bounds);
  for (const [handle, [hx, hy]] of Object.entries(handles) as [Handle, [number, number]][]) {
    ctx.beginPath();
    ctx.arc(hx, hy, HANDLE_RADIUS, 0, Math.PI * 2);
    if (handle === 'rotate') {
      ctx.fillStyle = '#00d4a0';
    } else {
      ctx.fillStyle = '#ffffff';
    }
    ctx.fill();
    ctx.strokeStyle = '#00d4a0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

function drawTextClip(
  ctx: CanvasRenderingContext2D,
  clip: Clip,
  transform: Transform,
  W: number,
  H: number
) {
  const style = clip.textStyle ?? DEFAULT_TEXT_STYLE;
  const fontSize = Math.round((style.fontSize / 1920) * H * transform.scale);
  const font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${fontSize}px ${style.fontFamily}`;
  const text = clip.textContent ?? 'Text';
  const cx = W / 2 + transform.x;
  const cy = H / 2 + transform.y;

  ctx.save();
  ctx.globalAlpha = transform.opacity;
  ctx.font = font;
  ctx.textAlign = style.align ?? 'center';
  ctx.textBaseline = 'middle';

  if (transform.rotation !== 0) {
    ctx.translate(cx, cy);
    ctx.rotate((transform.rotation * Math.PI) / 180);
    ctx.translate(-cx, -cy);
  }

  // Optional background
  if (style.background) {
    const measured = ctx.measureText(text);
    const padX = fontSize * 0.3;
    const padY = fontSize * 0.2;
    const bgAlpha = style.backgroundOpacity ?? 0.65;
    ctx.globalAlpha = transform.opacity * bgAlpha;
    ctx.fillStyle = style.background;
    ctx.fillRect(
      cx - measured.width / 2 - padX,
      cy - fontSize / 2 - padY,
      measured.width + padX * 2,
      fontSize + padY * 2
    );
    ctx.globalAlpha = transform.opacity;
  }

  // Text shadow
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 6;
  ctx.fillStyle = style.color;
  ctx.fillText(text, cx, cy);

  ctx.restore();
}

// ─── Preview component ────────────────────────────────────────────────────────

export default function Preview({
  project,
  assets,
  currentTime,
  isPlaying,
  beatsData,
  selectedClipId,
  onClipSelect,
  onClipUpdate,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Keep latest props in refs to avoid stale closures in rAF
  const propsRef = useRef({ project, assets, currentTime, isPlaying, beatsData, selectedClipId });
  useEffect(() => {
    propsRef.current = { project, assets, currentTime, isPlaying, beatsData, selectedClipId };
  });

  // Live transform override during drag (bypass React state for smooth dragging)
  const liveTransformRef = useRef<{ clipId: string; transform: Transform } | null>(null);

  // Drag state
  const dragRef = useRef<DragState>({ type: 'none' });

  const assetMap = useRef(new Map<string, Asset>());
  useEffect(() => {
    const map = new Map<string, Asset>();
    for (const a of assets) map.set(a.id, a);
    assetMap.current = map;
  }, [assets]);

  // Preload video elements for all video assets in project
  useEffect(() => {
    if (!project) return;
    for (const track of project.tracks) {
      if (track.type !== 'video') continue;
      for (const clip of track.clips) {
        const asset = assetMap.current.get(clip.assetId);
        if (asset?.type === 'video' && asset.proxyPath) {
          getOrCreateVideoEl(asset.id, `/files/${asset.proxyPath}`);
        }
      }
    }
  }, [project]);

  // ── Build clip bounds map for hit testing ──────────────────────────────────

  const getClipBounds = useCallback(
    (clip: Clip, transform: Transform, W: number, H: number, ctx: CanvasRenderingContext2D): Bounds | null => {
      if (!project) return null;
      const track = project.tracks.find((t) => t.clips.some((c) => c.id === clip.id));
      if (!track) return null;

      if (track.type === 'video') {
        const asset = assetMap.current.get(clip.assetId);
        const videoEl = asset?.proxyPath
          ? videoElementCache.get(asset.id) ?? null
          : null;
        return getVideoBounds(transform, videoEl, W, H);
      } else if (track.type === 'text') {
        return getTextBounds(clip, transform, ctx, W, H);
      }
      return null;
    },
    [project]
  );

  // ── Draw frame ────────────────────────────────────────────────────────────

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { project, assets: _assets, currentTime, beatsData, selectedClipId } = propsRef.current;
    if (!project) {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#444';
      ctx.font = '14px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No project loaded', canvas.width / 2, canvas.height / 2);
      return;
    }

    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    // Master beats for beat zoom effect
    const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    const masterBeatData = masterClip ? beatsData.get(masterClip.assetId) : undefined;
    const masterBeats = masterBeatData && masterClip
      ? masterBeatData.beats.map((b) => masterClip.timelineStart + (b - masterClip.sourceStart))
      : undefined;

    // ── Render video tracks ──────────────────────────────────────────────────
    const videoTracks = project.tracks.filter((t) => t.type === 'video' && !t.muted);
    for (const track of videoTracks) {
      for (const clip of track.clips) {
        if (currentTime < clip.timelineStart || currentTime >= clip.timelineEnd) continue;

        const asset = assetMap.current.get(clip.assetId);
        if (!asset) continue;

        const elapsed = currentTime - clip.timelineStart;
        const sourceTime = clip.sourceStart + elapsed;

        const videoEl = asset.proxyPath
          ? getOrCreateVideoEl(asset.id, `/files/${asset.proxyPath}`)
          : null;
        if (!videoEl) continue;

        // Sync video element
        const targetTime = Math.max(0, Math.min(sourceTime, videoEl.duration || 9999));
        if (propsRef.current.isPlaying) {
          if (videoEl.paused) {
            videoEl.currentTime = targetTime;
            videoEl.play().catch(() => {});
          } else if (Math.abs(videoEl.currentTime - targetTime) > 0.5) {
            videoEl.currentTime = targetTime;
          }
        } else {
          if (Math.abs(videoEl.currentTime - targetTime) > 0.08) {
            videoEl.currentTime = targetTime;
          }
        }

        // Use live override if dragging this clip
        const live = liveTransformRef.current;
        const transform = (live?.clipId === clip.id)
          ? live.transform
          : (clip.transform ?? { ...DEFAULT_TRANSFORM });

        let scale = transform.scale;

        // Beat zoom effect
        const beatZoom = clip.effects.find((e) => e.type === 'beatZoom');
        if (beatZoom && beatZoom.type === 'beatZoom' && beatZoom.enabled && masterBeats) {
          scale *= getBeatZoomScale(
            currentTime, masterBeats, beatZoom.intensity, beatZoom.durationMs, beatZoom.easing
          );
        }

        const effectiveTransform = { ...transform, scale };
        const bounds = getVideoBounds(effectiveTransform, videoEl, W, H);

        ctx.save();
        ctx.globalAlpha = transform.opacity;

        if (transform.rotation !== 0) {
          const cx = bounds.x + bounds.w / 2;
          const cy = bounds.y + bounds.h / 2;
          ctx.translate(cx, cy);
          ctx.rotate((transform.rotation * Math.PI) / 180);
          ctx.translate(-cx, -cy);
        }

        try {
          ctx.drawImage(videoEl, bounds.x, bounds.y, bounds.w, bounds.h);
        } catch {
          ctx.fillStyle = '#1a1a1a';
          ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
        }

        ctx.restore();
      }
    }

    // ── Render text tracks ───────────────────────────────────────────────────
    const textTracks = project.tracks.filter((t) => t.type === 'text' && !t.muted);
    for (const track of textTracks) {
      for (const clip of track.clips) {
        if (currentTime < clip.timelineStart || currentTime >= clip.timelineEnd) continue;

        const live = liveTransformRef.current;
        const transform = (live?.clipId === clip.id)
          ? live.transform
          : (clip.transform ?? { ...DEFAULT_TRANSFORM });

        drawTextClip(ctx, clip, transform, W, H);
      }
    }

    // ── Lyrics overlay ───────────────────────────────────────────────────────
    if (project.lyrics?.enabled && project.lyrics.words && project.lyrics.words.length > 0) {
      drawLyricsOverlay(ctx, W, H, currentTime, project.lyrics);
    }

    // ── Selection overlay ────────────────────────────────────────────────────
    if (selectedClipId) {
      const selectedClip = project.tracks
        .flatMap((t) => t.clips)
        .find((c) => c.id === selectedClipId);

      if (selectedClip && currentTime >= selectedClip.timelineStart && currentTime < selectedClip.timelineEnd) {
        const live = liveTransformRef.current;
        const transform = (live?.clipId === selectedClipId)
          ? live.transform
          : (selectedClip.transform ?? { ...DEFAULT_TRANSFORM });

        const bounds = getClipBounds(selectedClip, transform, W, H, ctx);
        if (bounds) {
          drawSelectionOverlay(ctx, bounds, transform.rotation);
        }
      } else if (selectedClip) {
        // Show outline even when clip is not at current time (so user knows it's selected)
        const live = liveTransformRef.current;
        const transform = (live?.clipId === selectedClipId)
          ? live.transform
          : (selectedClip.transform ?? { ...DEFAULT_TRANSFORM });
        const bounds = getClipBounds(selectedClip, transform, W, H, ctx);
        if (bounds) {
          ctx.save();
          ctx.strokeStyle = 'rgba(0,212,160,0.35)';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.strokeRect(bounds.x, bounds.y, bounds.w, bounds.h);
          ctx.setLineDash([]);
          ctx.restore();
        }
      }
    }
  }, [getClipBounds]);

  // ── RAF loop ──────────────────────────────────────────────────────────────

  const rafRef = useRef<number>(0);
  useEffect(() => {
    if (isPlaying) {
      const loop = () => {
        drawFrame();
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      return () => cancelAnimationFrame(rafRef.current);
    } else {
      drawFrame();
    }
  }, [isPlaying, drawFrame]);

  useEffect(() => {
    if (!isPlaying) {
      videoElementCache.forEach((el) => { if (!el.paused) el.pause(); });
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying) drawFrame();
  }, [currentTime, isPlaying, drawFrame, project, selectedClipId]);

  // ── Canvas resize ─────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver(() => {
      const { clientWidth, clientHeight } = container;
      const aspect = project
        ? project.outputResolution.w / project.outputResolution.h
        : 9 / 16;
      let w = clientWidth;
      let h = w / aspect;
      if (h > clientHeight) {
        h = clientHeight;
        w = h * aspect;
      }
      canvas.width = Math.round(w);
      canvas.height = Math.round(h);
      drawFrame();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [drawFrame, project?.outputResolution]);

  // ── Mouse interactions ────────────────────────────────────────────────────

  const getCanvasMousePos = (e: React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const { x: mx, y: my } = getCanvasMousePos(e);
      const W = canvas.width;
      const H = canvas.height;
      const { project, selectedClipId, currentTime } = propsRef.current;
      if (!project) return;

      // Check handles of currently selected clip first
      if (selectedClipId) {
        const selClip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId);
        if (selClip) {
          const live = liveTransformRef.current;
          const transform = (live?.clipId === selectedClipId)
            ? live.transform
            : (selClip.transform ?? { ...DEFAULT_TRANSFORM });

          const bounds = getClipBounds(selClip, transform, W, H, ctx);
          if (bounds) {
            const handles = getHandlePositions(bounds);

            // Check rotation handle
            const [rhx, rhy] = handles.rotate;
            if (dist(mx, my, rhx, rhy) <= HANDLE_RADIUS + 4) {
              const cx = bounds.x + bounds.w / 2;
              const cy = bounds.y + bounds.h / 2;
              const startAngle = Math.atan2(my - cy, mx - cx);
              dragRef.current = {
                type: 'rotate',
                clipId: selectedClipId,
                centerX: cx, centerY: cy,
                startAngle,
                startRotation: transform.rotation,
              };
              liveTransformRef.current = { clipId: selectedClipId, transform: { ...transform } };
              e.preventDefault();
              return;
            }

            // Check corner handles (scale)
            for (const [handle, [hx, hy]] of Object.entries(handles) as [Handle, [number, number]][]) {
              if (handle === 'rotate') continue;
              if (dist(mx, my, hx, hy) <= HANDLE_RADIUS + 4) {
                dragRef.current = {
                  type: 'scale',
                  clipId: selectedClipId,
                  handle,
                  startMouseX: mx, startMouseY: my,
                  startScale: transform.scale,
                  boundsW: bounds.w, boundsH: bounds.h,
                };
                liveTransformRef.current = { clipId: selectedClipId, transform: { ...transform } };
                e.preventDefault();
                return;
              }
            }

            // Check if inside the clip body (move)
            if (isInRect(mx, my, bounds)) {
              dragRef.current = {
                type: 'move',
                clipId: selectedClipId,
                startMouseX: mx, startMouseY: my,
                startTX: transform.x, startTY: transform.y,
              };
              liveTransformRef.current = { clipId: selectedClipId, transform: { ...transform } };
              e.preventDefault();
              return;
            }
          }
        }
      }

      // Hit test all clips at current time (topmost last = highest z-index)
      const clipsAtTime: Array<{ clip: Clip; trackType: string }> = [];
      for (const track of project.tracks) {
        if (track.type === 'audio' || track.muted) continue;
        for (const clip of track.clips) {
          if (currentTime >= clip.timelineStart && currentTime < clip.timelineEnd) {
            clipsAtTime.push({ clip, trackType: track.type });
          }
        }
      }

      // Test in reverse (topmost rendered = last in array)
      for (let i = clipsAtTime.length - 1; i >= 0; i--) {
        const { clip } = clipsAtTime[i];
        const transform = clip.transform ?? { ...DEFAULT_TRANSFORM };
        const bounds = getClipBounds(clip, transform, W, H, ctx);
        if (bounds && isInRect(mx, my, bounds)) {
          onClipSelect(clip.id);
          dragRef.current = {
            type: 'move',
            clipId: clip.id,
            startMouseX: mx, startMouseY: my,
            startTX: transform.x, startTY: transform.y,
          };
          liveTransformRef.current = { clipId: clip.id, transform: { ...transform } };
          e.preventDefault();
          return;
        }
      }

      // Clicked empty space: deselect
      onClipSelect(null);
    },
    [getClipBounds, onClipSelect]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (drag.type === 'none') return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const { x: mx, y: my } = getCanvasMousePos(e);

      if (drag.type === 'move') {
        const dx = mx - drag.startMouseX;
        const dy = my - drag.startMouseY;
        const prev = liveTransformRef.current!;
        liveTransformRef.current = {
          clipId: drag.clipId,
          transform: { ...prev.transform, x: drag.startTX + dx, y: drag.startTY + dy },
        };
        drawFrame();
      } else if (drag.type === 'scale') {
        const dx = mx - drag.startMouseX;
        const dy = my - drag.startMouseY;
        // Scale based on drag distance relative to original bounds diagonal
        const origSize = Math.sqrt(drag.boundsW ** 2 + drag.boundsH ** 2);
        const dragDist = drag.handle === 'tl' || drag.handle === 'bl'
          ? -(dx + dy) / 2
          : (dx + dy) / 2;
        const scaleDelta = dragDist / (origSize / 2);
        const newScale = clamp(drag.startScale + scaleDelta, 0.05, 10);
        const prev = liveTransformRef.current!;
        liveTransformRef.current = {
          clipId: drag.clipId,
          transform: { ...prev.transform, scale: newScale },
        };
        drawFrame();
      } else if (drag.type === 'rotate') {
        const angle = Math.atan2(my - drag.centerY, mx - drag.centerX);
        const deltaAngle = ((angle - drag.startAngle) * 180) / Math.PI;
        let newRotation = drag.startRotation + deltaAngle;
        // Snap to 0/90/180/270 if within 5 degrees
        for (const snap of [0, 90, 180, 270, -90, -180]) {
          if (Math.abs(newRotation - snap) < 5) { newRotation = snap; break; }
        }
        const prev = liveTransformRef.current!;
        liveTransformRef.current = {
          clipId: drag.clipId,
          transform: { ...prev.transform, rotation: newRotation },
        };
        drawFrame();
      }
    },
    [drawFrame]
  );

  const handleMouseUp = useCallback(() => {
    const drag = dragRef.current;
    if (drag.type === 'none') return;

    const live = liveTransformRef.current;
    if (live) {
      onClipUpdate(live.clipId, { transform: live.transform });
    }

    dragRef.current = { type: 'none' };
    liveTransformRef.current = null;
  }, [onClipUpdate]);

  // Update cursor based on what's under pointer
  const handleMouseMoveForCursor = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      handleMouseMove(e);

      const drag = dragRef.current;
      const canvas = canvasRef.current;
      if (!canvas) return;

      if (drag.type !== 'none') {
        if (drag.type === 'rotate') canvas.style.cursor = 'grabbing';
        else if (drag.type === 'scale') canvas.style.cursor = 'nwse-resize';
        else canvas.style.cursor = 'grabbing';
        return;
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const { x: mx, y: my } = getCanvasMousePos(e);
      const W = canvas.width;
      const H = canvas.height;
      const { project, selectedClipId, currentTime } = propsRef.current;
      if (!project) return;

      // Check handles of selected clip
      if (selectedClipId) {
        const selClip = project.tracks.flatMap((t) => t.clips).find((c) => c.id === selectedClipId);
        if (selClip) {
          const live = liveTransformRef.current;
          const transform = (live?.clipId === selectedClipId)
            ? live.transform
            : (selClip.transform ?? { ...DEFAULT_TRANSFORM });
          const bounds = getClipBounds(selClip, transform, W, H, ctx);
          if (bounds) {
            const handles = getHandlePositions(bounds);
            const [rhx, rhy] = handles.rotate;
            if (dist(mx, my, rhx, rhy) <= HANDLE_RADIUS + 4) {
              canvas.style.cursor = 'grab';
              return;
            }
            for (const [handle, [hx, hy]] of Object.entries(handles) as [Handle, [number, number]][]) {
              if (handle === 'rotate') continue;
              if (dist(mx, my, hx, hy) <= HANDLE_RADIUS + 4) {
                canvas.style.cursor = 'nwse-resize';
                return;
              }
            }
            if (isInRect(mx, my, bounds)) {
              canvas.style.cursor = 'move';
              return;
            }
          }
        }
      }

      // Check clip bodies
      let foundClip = false;
      for (const track of project.tracks) {
        if (track.type === 'audio' || track.muted) continue;
        for (const clip of track.clips) {
          if (currentTime >= clip.timelineStart && currentTime < clip.timelineEnd) {
            const transform = clip.transform ?? { ...DEFAULT_TRANSFORM };
            const bounds = getClipBounds(clip, transform, W, H, ctx);
            if (bounds && isInRect(mx, my, bounds)) {
              foundClip = true;
              break;
            }
          }
        }
        if (foundClip) break;
      }

      canvas.style.cursor = foundClip ? 'move' : 'default';
    },
    [handleMouseMove, getClipBounds]
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center bg-black"
      style={{ minHeight: 0 }}
    >
      <canvas
        ref={canvasRef}
        style={{ display: 'block', imageRendering: 'auto' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMoveForCursor}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
    </div>
  );
}

// ─── Lyrics overlay ───────────────────────────────────────────────────────────

function drawLyricsOverlay(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  currentTime: number,
  lyrics: NonNullable<Project['lyrics']>
) {
  const words = lyrics.words ?? [];
  const style = lyrics.style ?? {
    fontSize: 48,
    color: '#FFFFFF',
    highlightColor: '#FFE600',
    position: 'bottom',
    wordsPerChunk: 3,
  };

  const chunkSize = style.wordsPerChunk;
  const fontSize = Math.round((style.fontSize / 1920) * H);

  let chunkStart = -1;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    if (currentTime >= chunk[0].start && currentTime <= (chunk[chunk.length - 1].end + 0.5)) {
      chunkStart = i;
      break;
    }
  }

  if (chunkStart < 0) return;

  const chunk = words.slice(chunkStart, chunkStart + chunkSize);

  ctx.save();
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = 'center';

  const y = style.position === 'bottom'
    ? H - fontSize * 2
    : style.position === 'top'
    ? fontSize * 2
    : H / 2;

  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 8;

  const texts = chunk.map((w) => w.word);
  const fullText = texts.join(' ');
  const totalWidth = ctx.measureText(fullText).width;
  let x = (W - totalWidth) / 2;

  for (let i = 0; i < chunk.length; i++) {
    const w = chunk[i];
    const isCurrentWord = currentTime >= w.start && currentTime <= w.end;
    ctx.fillStyle = isCurrentWord ? style.highlightColor : style.color;
    const wordText = i < chunk.length - 1 ? w.word + ' ' : w.word;
    ctx.fillText(wordText, x + ctx.measureText(wordText).width / 2, y);
    x += ctx.measureText(wordText).width;
  }

  ctx.restore();
}
