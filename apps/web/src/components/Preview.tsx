'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import type { Project, Asset, BeatsData, Clip, Transform, TextStyle, CartoonEffect } from '@video-editor/shared';
import { getBeatZoomScale, clamp } from '@/lib/utils';

// ─── Zoom constants ────────────────────────────────────────────────────────────

const MIN_VIEW_ZOOM = 0.1;
const MAX_VIEW_ZOOM = 8;
const ZOOM_STEP = 0.1; // for buttons

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
      boundsW: number; boundsH: number;
      offsetX: number; // bounds.x - transform.x (stable during move)
      offsetY: number; // bounds.y - transform.y (stable during move)
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
const PREVIEW_SNAP_THRESHOLD = 12; // canvas pixels — snap to edges/center within this distance
const DEFAULT_TRANSFORM: Transform = { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 };
const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Arial',
  fontSize: 96,
  color: '#ffffff',
  bold: true,
  italic: false,
  align: 'center',
};

// ─── Cartoon effect (canvas preview) ─────────────────────────────────────────
//
// Simulates the FFmpeg cartoon pipeline in the browser:
//   hqdn3d  → blur (color simplification)
//   eq      → saturate
//   edgedetect + blend multiply → Sobel edges multiplied onto base
//
// Two module-level canvases are reused each frame to avoid GC pressure.

let _cartoonBase: HTMLCanvasElement | null = null;
let _cartoonEdge: HTMLCanvasElement | null = null;

function getCartoonCanvases(iw: number, ih: number) {
  const ew = Math.max(2, Math.round(iw / 2));
  const eh = Math.max(2, Math.round(ih / 2));

  if (!_cartoonBase || _cartoonBase.width !== iw || _cartoonBase.height !== ih) {
    _cartoonBase = document.createElement('canvas');
    _cartoonBase.width = iw;
    _cartoonBase.height = ih;
  }
  if (!_cartoonEdge || _cartoonEdge.width !== ew || _cartoonEdge.height !== eh) {
    _cartoonEdge = document.createElement('canvas');
    _cartoonEdge.width = ew;
    _cartoonEdge.height = eh;
  }
  return { base: _cartoonBase, edge: _cartoonEdge, ew, eh };
}

/**
 * Draw a cartoon-styled video frame onto ctx at the given bounds.
 * Relies on the caller to have set ctx.globalAlpha and any rotation transform.
 *
 * The pipeline mirrors the FFmpeg export:
 *   1. Blur + saturate the video onto an offscreen base canvas
 *   2. Run Sobel edge-detection at ½ resolution on a second canvas
 *   3. Multiply the edge mask onto the base (dark edges darken the colour)
 *   4. Blit the result to the main canvas
 *
 * If step 2 fails (e.g. SecurityError from getImageData) the function falls
 * back to showing the blurred/saturated base without edge lines — still
 * visually different from unprocessed video.
 */
function applyCartoonEffectToCtx(
  ctx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement,
  bounds: Bounds,
  effect: import('@video-editor/shared').EffectClipConfig
): void {
  const iw = Math.max(2, Math.round(bounds.w));
  const ih = Math.max(2, Math.round(bounds.h));

  const { base, edge, ew, eh } = getCartoonCanvases(iw, ih);
  const baseCtx = base.getContext('2d');
  const edgeCtx = edge.getContext('2d');
  if (!baseCtx || !edgeCtx) {
    // Should never happen for plain 2D canvases, but guard anyway
    ctx.drawImage(videoEl, bounds.x, bounds.y, bounds.w, bounds.h);
    return;
  }

  // ── 1. Color-simplified base: blur + saturation ───────────────────────────
  const colorSimplification = effect.colorSimplification ?? 0.3;
  const saturation = effect.saturation ?? 1.4;
  const edgeStrengthVal = effect.edgeStrength ?? 0.5;
  const blurPx = colorSimplification * 5;
  baseCtx.clearRect(0, 0, iw, ih);
  baseCtx.filter =
    blurPx > 0.1
      ? `blur(${blurPx.toFixed(1)}px) saturate(${saturation.toFixed(2)})`
      : `saturate(${saturation.toFixed(2)})`;
  baseCtx.drawImage(videoEl, 0, 0, iw, ih);
  baseCtx.filter = 'none';

  // ── 2. Edge detection at half resolution (Sobel) ─────────────────────────
  // Wrapped in try/catch: getImageData throws a SecurityError if the canvas
  // is tainted by a cross-origin video without proper CORS headers.  In that
  // case we fall back gracefully to just the blur+saturation base.
  try {
    edgeCtx.clearRect(0, 0, ew, eh);
    edgeCtx.drawImage(videoEl, 0, 0, ew, eh);

    const { data: srcData } = edgeCtx.getImageData(0, 0, ew, eh);
    const edgeImageData = edgeCtx.createImageData(ew, eh);
    const dst = edgeImageData.data;

    // Grayscale pre-pass
    const gray = new Float32Array(ew * eh);
    for (let i = 0; i < ew * eh; i++) {
      const p = i * 4;
      gray[i] = 0.299 * srcData[p] + 0.587 * srcData[p + 1] + 0.114 * srcData[p + 2];
    }

    // edgeStrength=0 → rawThreshold=200 (almost no edges)
    // edgeStrength=1 → rawThreshold=0   (all gradients become edges)
    const rawThreshold = (1 - edgeStrengthVal) * 200;

    for (let y = 0; y < eh; y++) {
      for (let x = 0; x < ew; x++) {
        let edgeVal = 255; // white = transparent in multiply blend
        if (y > 0 && y < eh - 1 && x > 0 && x < ew - 1) {
          const tl = gray[(y - 1) * ew + (x - 1)];
          const tm = gray[(y - 1) * ew + x];
          const tr = gray[(y - 1) * ew + (x + 1)];
          const ml = gray[y * ew + (x - 1)];
          const mr = gray[y * ew + (x + 1)];
          const bl = gray[(y + 1) * ew + (x - 1)];
          const bm = gray[(y + 1) * ew + x];
          const br = gray[(y + 1) * ew + (x + 1)];
          const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
          const gy = -tl - 2 * tm - tr + bl + 2 * bm + br;
          const mag = Math.sqrt(gx * gx + gy * gy);
          if (mag > rawThreshold) {
            // Darker = stronger edge; scale by edgeStrength
            edgeVal = Math.max(0, 255 - (mag - rawThreshold) * edgeStrengthVal * 4);
          }
        }
        const idx = (y * ew + x) * 4;
        dst[idx] = dst[idx + 1] = dst[idx + 2] = Math.round(edgeVal);
        dst[idx + 3] = 255;
      }
    }
    edgeCtx.putImageData(edgeImageData, 0, 0);

    // ── 3. Multiply edges onto base ─────────────────────────────────────────
    // White pixels (no edge) leave base unchanged; dark pixels darken the base.
    baseCtx.save();
    baseCtx.globalCompositeOperation = 'multiply';
    baseCtx.drawImage(edge, 0, 0, ew, eh, 0, 0, iw, ih);
    baseCtx.restore();
  } catch (err) {
    // Edge detection failed (e.g. SecurityError).  The base canvas still holds
    // the blurred + saturated frame, so we continue to blit it below.
    console.warn('[Preview] Cartoon edge detection failed, falling back to blur/saturation:', err);
  }

  // ── 4. Blit result to main canvas (inherits caller's globalAlpha + transform) ──
  ctx.drawImage(base, bounds.x, bounds.y, bounds.w, bounds.h);
}

// ─── Video element cache ──────────────────────────────────────────────────────

const videoElementCache = new Map<string, HTMLVideoElement>();

function getOrCreateVideoEl(assetId: string, src: string): HTMLVideoElement {
  if (!videoElementCache.has(assetId)) {
    const el = document.createElement('video');
    // crossOrigin must be set BEFORE src so the CORS request is made correctly
    // from the start; setting it after src causes browsers to re-fetch or use a
    // non-CORS response which would taint the canvas and break getImageData.
    el.crossOrigin = 'anonymous';
    el.src = src;
    el.preload = 'auto';
    el.muted = true;
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
  // Add generous padding for easier hit testing
  const pad = Math.max(16, fontSize * 0.3);
  return { x: cx - tw / 2 - pad, y: cy - th / 2 - pad, w: tw + pad * 2, h: th + pad * 2 };
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

// ─── SVG selection overlay helper ─────────────────────────────────────────────

function updateSelectionSvg(
  svg: SVGSVGElement,
  bounds: Bounds | null,
  rotation: number,
  faded = false
) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!bounds) return;

  const ns = 'http://www.w3.org/2000/svg';
  const { x, y, w, h } = bounds;
  const cx = x + w / 2;
  const cy = y + h / 2;

  const g = document.createElementNS(ns, 'g');
  if (rotation !== 0) {
    g.setAttribute('transform', `rotate(${rotation} ${cx} ${cy})`);
  }

  if (faded) {
    // Faded outline when clip not at current time
    const rect = document.createElementNS(ns, 'rect');
    rect.setAttribute('x', String(x));
    rect.setAttribute('y', String(y));
    rect.setAttribute('width', String(w));
    rect.setAttribute('height', String(h));
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', 'rgba(13,148,136,0.35)');
    rect.setAttribute('stroke-width', '1');
    rect.setAttribute('stroke-dasharray', '4,4');
    g.appendChild(rect);
    svg.appendChild(g);
    return;
  }

  // Dashed selection rect
  const rect = document.createElementNS(ns, 'rect');
  rect.setAttribute('x', String(x));
  rect.setAttribute('y', String(y));
  rect.setAttribute('width', String(w));
  rect.setAttribute('height', String(h));
  rect.setAttribute('fill', 'none');
  rect.setAttribute('stroke', '#0d9488');
  rect.setAttribute('stroke-width', '1.5');
  rect.setAttribute('stroke-dasharray', '5,3');
  g.appendChild(rect);

  // Rotation handle line
  const line = document.createElementNS(ns, 'line');
  line.setAttribute('x1', String(cx));
  line.setAttribute('y1', String(y));
  line.setAttribute('x2', String(cx));
  line.setAttribute('y2', String(y - ROTATE_HANDLE_OFFSET));
  line.setAttribute('stroke', '#0d9488');
  line.setAttribute('stroke-width', '1.5');
  g.appendChild(line);

  // Handles
  const handles = getHandlePositions(bounds);
  for (const [handle, [hx, hy]] of Object.entries(handles) as [Handle, [number, number]][]) {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', String(hx));
    circle.setAttribute('cy', String(hy));
    circle.setAttribute('r', String(HANDLE_RADIUS));
    circle.setAttribute('fill', handle === 'rotate' ? '#0d9488' : '#ffffff');
    circle.setAttribute('stroke', '#0d9488');
    circle.setAttribute('stroke-width', '1.5');
    g.appendChild(circle);
  }

  svg.appendChild(g);
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
  const selectionSvgRef = useRef<SVGSVGElement>(null);

  // ── Viewport zoom / pan ───────────────────────────────────────────────────
  const [viewZoom, setViewZoom] = useState(1);
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  // Refs for smooth zoom/pan updates without stale closures
  const viewZoomRef = useRef(1);
  const viewPanRef = useRef({ x: 0, y: 0 });
  const midPanDragRef = useRef<{ startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);

  const setZoom = useCallback((z: number) => {
    viewZoomRef.current = z;
    setViewZoom(z);
  }, []);
  const setPan = useCallback((p: { x: number; y: number }) => {
    viewPanRef.current = p;
    setViewPan(p);
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, [setZoom, setPan]);

  // Keep latest props in refs to avoid stale closures in rAF
  const propsRef = useRef({ project, assets, currentTime, isPlaying, beatsData, selectedClipId });
  useEffect(() => {
    propsRef.current = { project, assets, currentTime, isPlaying, beatsData, selectedClipId };
  });

  // Live transform override during drag (bypass React state for smooth dragging)
  const liveTransformRef = useRef<{ clipId: string; transform: Transform } | null>(null);

  // Drag state
  const dragRef = useRef<DragState>({ type: 'none' });

  // Active snap guide lines drawn during move drag { x: canvas-x[], y: canvas-y[] }
  const snapLinesRef = useRef<{ x: number[]; y: number[] }>({ x: [], y: [] });

  const assetMap = useRef(new Map<string, Asset>());
  useEffect(() => {
    const map = new Map<string, Asset>();
    for (const a of assets) map.set(a.id, a);
    assetMap.current = map;
  }, [assets]);

  // Ref to drawFrame so video event handlers can call it without stale closures
  const drawFrameRef = useRef<() => void>(() => {});

  // Preload video elements for all video assets in project.
  // Also attach seeked/loadeddata listeners so the preview redraws automatically
  // when a seek completes or new video data becomes available (e.g. after the
  // video element first buffers). Without this, a frame rendered while the video
  // is still seeking shows a stale (or blank) result and never updates because
  // no React state change triggers another drawFrame call.
  useEffect(() => {
    if (!project) return;
    const attached: Array<{ el: HTMLVideoElement; handler: () => void }> = [];
    for (const track of project.tracks) {
      if (track.type !== 'video') continue;
      for (const clip of track.clips) {
        const asset = assetMap.current.get(clip.assetId);
        if (asset?.type === 'video' && asset.proxyPath) {
          const el = getOrCreateVideoEl(asset.id, `/files/${asset.proxyPath}`);
          const handler = () => { if (!propsRef.current.isPlaying) drawFrameRef.current(); };
          el.addEventListener('seeked', handler);
          el.addEventListener('loadeddata', handler);
          attached.push({ el, handler });
        }
      }
    }
    return () => {
      for (const { el, handler } of attached) {
        el.removeEventListener('seeked', handler);
        el.removeEventListener('loadeddata', handler);
      }
    };
  }, [project]);

  // ── Build clip bounds map for hit testing ──────────────────────────────────

  const getClipBounds = useCallback(
    (clip: Clip, transform: Transform, W: number, H: number, ctx: CanvasRenderingContext2D): Bounds | null => {
      if (!project) return null;
      const track = project.tracks.find((t) => t.clips.some((c) => c.id === clip.id));
      if (!track) return null;

      // Text clips can live on any visual track (video or legacy text type)
      if (clip.textContent) {
        return getTextBounds(clip, transform, ctx, W, H);
      } else if (track.type === 'video') {
        const asset = assetMap.current.get(clip.assetId);
        const videoEl = asset?.proxyPath
          ? videoElementCache.get(asset.id) ?? null
          : null;
        return getVideoBounds(transform, videoEl, W, H);
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
      if (selectionSvgRef.current) updateSelectionSvg(selectionSvgRef.current, null, 0);
      return;
    }

    const W = canvas.width;
    const H = canvas.height;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    // Master beats for beat zoom effect
    const masterTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);
    const masterClip = masterTrack?.clips[0];
    const masterBeatData = masterClip ? beatsData.get(masterClip.assetId) : undefined;
    const masterBeats = masterBeatData && masterClip
      ? masterBeatData.beats.map((b) => masterClip.timelineStart + (b - masterClip.sourceStart))
      : undefined;

    // ── Render all non-audio tracks in reverse order so that tracks higher in
    // the timeline (lower array index) appear on top in the preview, matching
    // the visual timeline order (top track = on top in preview).
    for (const track of [...project.tracks].reverse()) {
      if (track.type === 'audio' || track.muted) continue;

      for (const clip of track.clips) {
        if (currentTime < clip.timelineStart || currentTime >= clip.timelineEnd) continue;

        const live = liveTransformRef.current;
        const transform = (live?.clipId === clip.id)
          ? live.transform
          : (clip.transform ?? { ...DEFAULT_TRANSFORM });

        // Text clips can live on any visual track (video or legacy text type)
        if (clip.textContent) {
          drawTextClip(ctx, clip, transform, W, H);
          continue;
        }

        if (track.type === 'video') {
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

          let scale = transform.scale;

          // Beat zoom effect — read from effect track (type='effect', effectType='beatZoom')
          const beatZoomEffectTrack = project.tracks.find(
            (t) => t.type === 'effect' && t.effectType === 'beatZoom' && t.parentTrackId === track.id
          );
          const activeBeatZoomClip = beatZoomEffectTrack?.clips.find(
            (ec) => currentTime >= ec.timelineStart && currentTime <= ec.timelineEnd
          );
          if (activeBeatZoomClip?.effectConfig?.enabled && masterBeats) {
            const cfg = activeBeatZoomClip.effectConfig;
            scale *= getBeatZoomScale(
              currentTime, masterBeats,
              cfg.intensity ?? 0.08,
              cfg.durationMs ?? 150,
              cfg.easing ?? 'easeOut',
              cfg.beatDivision ?? 1
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

          const cartoonEffectTrack = project.tracks.find(
            (t) => t.type === 'effect' && t.effectType === 'cartoon' && t.parentTrackId === track.id
          );
          const cartoonEff = cartoonEffectTrack?.clips.find(
            (ec) => currentTime >= ec.timelineStart && currentTime <= ec.timelineEnd
          )?.effectConfig;
          try {
            if (cartoonEff?.enabled) {
              applyCartoonEffectToCtx(ctx, videoEl, bounds, cartoonEff);
            } else {
              ctx.drawImage(videoEl, bounds.x, bounds.y, bounds.w, bounds.h);
            }
          } catch (err) {
            console.error('[Preview] Failed to render video clip:', err);
            ctx.fillStyle = '#1a1a1a';
            ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
          }

          ctx.restore();
        }
      }
    }

    // ── Snap guide lines (shown during move drag) ─────────────────────────────
    const snapLines = snapLinesRef.current;
    if (dragRef.current.type === 'move' && (snapLines.x.length > 0 || snapLines.y.length > 0)) {
      ctx.save();
      ctx.strokeStyle = 'rgba(13,148,136,0.85)';
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 4]);
      for (const sx of snapLines.x) {
        ctx.beginPath();
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, H);
        ctx.stroke();
      }
      for (const sy of snapLines.y) {
        ctx.beginPath();
        ctx.moveTo(0, sy);
        ctx.lineTo(W, sy);
        ctx.stroke();
      }
      ctx.restore();
    }

    // ── Lyrics overlay ───────────────────────────────────────────────────────
    if (project.lyrics?.enabled && project.lyrics.words && project.lyrics.words.length > 0) {
      drawLyricsOverlay(ctx, W, H, currentTime, project.lyrics);
    }

    // ── Selection overlay (via SVG) ───────────────────────────────────────────
    const svg = selectionSvgRef.current;
    if (svg) {
      if (selectedClipId) {
        const selectedClip = project.tracks
          .flatMap((t) => t.clips)
          .find((c) => c.id === selectedClipId);

        if (selectedClip) {
          const live = liveTransformRef.current;
          const transform = (live?.clipId === selectedClipId)
            ? live.transform
            : (selectedClip.transform ?? { ...DEFAULT_TRANSFORM });

          const bounds = getClipBounds(selectedClip, transform, W, H, ctx);
          const isAtCurrentTime = currentTime >= selectedClip.timelineStart && currentTime < selectedClip.timelineEnd;
          updateSelectionSvg(svg, bounds, transform.rotation, !isAtCurrentTime);
        } else {
          updateSelectionSvg(svg, null, 0);
        }
      } else {
        updateSelectionSvg(svg, null, 0);
      }
    }
  }, [getClipBounds]);

  // ── RAF loop ──────────────────────────────────────────────────────────────

  // Keep drawFrameRef in sync so video event listeners can call the latest version
  useEffect(() => {
    drawFrameRef.current = drawFrame;
  }, [drawFrame]);

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
      // Skip when container is hidden (display:none / visibility:hidden collapses to 0)
      if (clientWidth === 0 || clientHeight === 0) return;
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

  const getCanvasMousePos = (e: MouseEvent | React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  // Document-level event handlers for drag outside canvas bounds
  useEffect(() => {
    const onDocMouseMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (drag.type === 'none') return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const { x: mx, y: my } = getCanvasMousePos(e);

      if (drag.type === 'move') {
        const dx = mx - drag.startMouseX;
        const dy = my - drag.startMouseY;
        let newX = drag.startTX + dx;
        let newY = drag.startTY + dy;

        // ── Snap to canvas edges and center ──────────────────────────────────
        const W = canvas.width;
        const H = canvas.height;
        const { boundsW, boundsH, offsetX, offsetY } = drag;
        const activeSnapX: number[] = [];
        const activeSnapY: number[] = [];

        // Projected bounds edges at current position
        const bLeft   = newX + offsetX;
        const bRight  = bLeft + boundsW;
        const bCenterX = bLeft + boundsW / 2;
        const bTop    = newY + offsetY;
        const bBottom = bTop + boundsH;
        const bCenterY = bTop + boundsH / 2;

        // Snap X: left edge→0, right edge→W, center→W/2
        if (Math.abs(bLeft) < PREVIEW_SNAP_THRESHOLD) {
          newX = -offsetX;
          activeSnapX.push(0);
        } else if (Math.abs(bRight - W) < PREVIEW_SNAP_THRESHOLD) {
          newX = W - boundsW - offsetX;
          activeSnapX.push(W);
        } else if (Math.abs(bCenterX - W / 2) < PREVIEW_SNAP_THRESHOLD) {
          newX = W / 2 - boundsW / 2 - offsetX;
          activeSnapX.push(W / 2);
        }

        // Snap Y: top edge→0, bottom edge→H, center→H/2
        if (Math.abs(bTop) < PREVIEW_SNAP_THRESHOLD) {
          newY = -offsetY;
          activeSnapY.push(0);
        } else if (Math.abs(bBottom - H) < PREVIEW_SNAP_THRESHOLD) {
          newY = H - boundsH - offsetY;
          activeSnapY.push(H);
        } else if (Math.abs(bCenterY - H / 2) < PREVIEW_SNAP_THRESHOLD) {
          newY = H / 2 - boundsH / 2 - offsetY;
          activeSnapY.push(H / 2);
        }

        snapLinesRef.current = { x: activeSnapX, y: activeSnapY };

        const prev = liveTransformRef.current!;
        liveTransformRef.current = {
          clipId: drag.clipId,
          transform: { ...prev.transform, x: newX, y: newY },
        };
        drawFrame();
      } else if (drag.type === 'scale') {
        const dx = mx - drag.startMouseX;
        const dy = my - drag.startMouseY;
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
    };

    const onDocMouseUp = () => {
      const drag = dragRef.current;
      if (drag.type === 'none') return;

      const live = liveTransformRef.current;
      if (live) {
        onClipUpdate(live.clipId, { transform: live.transform });
      }

      dragRef.current = { type: 'none' };
      liveTransformRef.current = null;
      snapLinesRef.current = { x: [], y: [] };

      // Reset cursor
      if (canvasRef.current) canvasRef.current.style.cursor = 'default';
    };

    document.addEventListener('mousemove', onDocMouseMove);
    document.addEventListener('mouseup', onDocMouseUp);
    return () => {
      document.removeEventListener('mousemove', onDocMouseMove);
      document.removeEventListener('mouseup', onDocMouseUp);
    };
  }, [drawFrame, onClipUpdate]);

  // ── Viewport wheel zoom ───────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const containerCX = rect.left + rect.width / 2;
      const containerCY = rect.top + rect.height / 2;

      // Cursor offset from container center
      const cursorX = e.clientX - containerCX;
      const cursorY = e.clientY - containerCY;

      const currentZoom = viewZoomRef.current;
      const currentPan = viewPanRef.current;

      // Point in "natural canvas space" (relative to canvas center) under cursor
      const localX = (cursorX - currentPan.x) / currentZoom;
      const localY = (cursorY - currentPan.y) / currentZoom;

      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = clamp(currentZoom * factor, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);

      // Adjust pan so the point under cursor stays fixed
      const newPan = {
        x: cursorX - localX * newZoom,
        y: cursorY - localY * newZoom,
      };

      setZoom(newZoom);
      setPan(newPan);
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [setZoom, setPan]);

  // ── Middle-mouse-button pan ───────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 1) return; // middle button only
      e.preventDefault();
      midPanDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPanX: viewPanRef.current.x,
        startPanY: viewPanRef.current.y,
      };
      container.style.cursor = 'grabbing';
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!midPanDragRef.current) return;
      const { startX, startY, startPanX, startPanY } = midPanDragRef.current;
      setPan({ x: startPanX + (e.clientX - startX), y: startPanY + (e.clientY - startY) });
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 1 || !midPanDragRef.current) return;
      midPanDragRef.current = null;
      container.style.cursor = '';
    };

    container.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, [setPan]);

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

      // ── Step 1: Check handles of currently selected clip first ────────────
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
            if (dist(mx, my, rhx, rhy) <= HANDLE_RADIUS + 8) {
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
              if (dist(mx, my, hx, hy) <= HANDLE_RADIUS + 8) {
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
          }
        }
      }

      // ── Step 2: Hit-test all clips at current time (topmost first) ─────────
      // Build list of all visible clips. Tracks are now rendered in reverse order
      // (index 0 = top of timeline = rendered last = visually on top), so we
      // collect in reverse order and test forward (first = topmost on screen).
      const clipsAtTime: Clip[] = [];
      for (const track of [...project.tracks].reverse()) {
        if (track.type === 'audio' || track.muted) continue;
        for (const clip of track.clips) {
          if (currentTime >= clip.timelineStart && currentTime < clip.timelineEnd) {
            clipsAtTime.push(clip);
          }
        }
      }

      // Test forward (topmost rendered = first in list, since we reversed above)
      for (let i = 0; i < clipsAtTime.length; i++) {
        const clip = clipsAtTime[i];
        const transform = clip.transform ?? { ...DEFAULT_TRANSFORM };
        const bounds = getClipBounds(clip, transform, W, H, ctx);
        if (bounds && isInRect(mx, my, bounds)) {
          onClipSelect(clip.id);
          // Start move drag for the hit clip
          dragRef.current = {
            type: 'move',
            clipId: clip.id,
            startMouseX: mx, startMouseY: my,
            startTX: transform.x, startTY: transform.y,
            boundsW: bounds.w, boundsH: bounds.h,
            offsetX: bounds.x - transform.x,
            offsetY: bounds.y - transform.y,
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

  // Update cursor based on what's under pointer
  const handleMouseMoveForCursor = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
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
            if (dist(mx, my, rhx, rhy) <= HANDLE_RADIUS + 8) {
              canvas.style.cursor = 'grab';
              return;
            }
            for (const [handle, [hx, hy]] of Object.entries(handles) as [Handle, [number, number]][]) {
              if (handle === 'rotate') continue;
              if (dist(mx, my, hx, hy) <= HANDLE_RADIUS + 8) {
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
    [getClipBounds]
  );

  // ── Zoom button handlers ──────────────────────────────────────────────────

  const handleZoomIn = useCallback(() => {
    const newZoom = clamp(viewZoomRef.current + ZOOM_STEP, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
    setZoom(newZoom);
  }, [setZoom]);

  const handleZoomOut = useCallback(() => {
    const newZoom = clamp(viewZoomRef.current - ZOOM_STEP, MIN_VIEW_ZOOM, MAX_VIEW_ZOOM);
    setZoom(newZoom);
  }, [setZoom]);

  return (
    <div
      ref={containerRef}
      className="flex-1 flex items-center justify-center"
      style={{
        minHeight: 0,
        position: 'relative',
        overflow: 'hidden',
        backgroundColor: '#1a1a2e',
        backgroundImage:
          'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)',
        backgroundSize: `${24 * viewZoom}px ${24 * viewZoom}px`,
        backgroundPosition: `${viewPan.x}px ${viewPan.y}px`,
      }}
    >
      {/* Zoomable canvas wrapper — CSS transform for viewport zoom */}
      <div
        data-testid="preview-zoom-wrapper"
        style={{
          position: 'relative',
          display: 'inline-block',
          lineHeight: 0,
          transform: `translate(${viewPan.x}px, ${viewPan.y}px) scale(${viewZoom})`,
          transformOrigin: 'center center',
          willChange: 'transform',
        }}
      >
        <canvas
          ref={canvasRef}
          style={{ display: 'block', imageRendering: 'auto' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMoveForCursor}
        />
        {/* SVG selection overlay — overflow:visible lets handles appear outside canvas */}
        <svg
          ref={selectionSvgRef}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* Zoom controls overlay */}
      <div
        data-testid="preview-zoom-controls"
        style={{
          position: 'absolute',
          bottom: 10,
          right: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'rgba(255,255,255,0.90)',
          borderRadius: 6,
          padding: '3px 6px',
          userSelect: 'none',
          zIndex: 10,
        }}
      >
        <button
          data-testid="zoom-out-btn"
          onClick={handleZoomOut}
          title="Zoom out (scroll down)"
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(15,23,42,0.55)',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '0 2px',
          }}
        >
          −
        </button>
        <button
          data-testid="zoom-reset-btn"
          onClick={resetView}
          title="Reset zoom (100%)"
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(15,23,42,0.55)',
            cursor: 'pointer',
            fontSize: 11,
            fontFamily: 'monospace',
            minWidth: 40,
            textAlign: 'center',
            padding: '0 2px',
          }}
        >
          {Math.round(viewZoom * 100)}%
        </button>
        <button
          data-testid="zoom-in-btn"
          onClick={handleZoomIn}
          title="Zoom in (scroll up)"
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(15,23,42,0.55)',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: '0 2px',
          }}
        >
          +
        </button>
        <div
          style={{
            width: 1,
            height: 14,
            background: 'rgba(15,23,42,0.15)',
            margin: '0 2px',
          }}
        />
        <button
          data-testid="view-center-btn"
          onClick={resetView}
          title="Reset view — přesune pohled zpět na video"
          style={{
            background: 'none',
            border: 'none',
            color: 'rgba(15,23,42,0.55)',
            cursor: 'pointer',
            fontSize: 13,
            lineHeight: 1,
            padding: '0 2px',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          ⊡
        </button>
      </div>
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
