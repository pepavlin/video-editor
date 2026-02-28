/**
 * Video Clip Element — Unified Preview + Export
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  PREVIEW: Canvas 2D rendering with video synchronization + effect chain  │
 * │  EXPORT:  FFmpeg filter_complex construction with same effect chain       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * This is the single source of truth for how video clips are rendered.
 * Both the preview pipeline and the export pipeline use this file.
 *
 * ## Preview pipeline (VideoClip.preview.render):
 *   1. Sync video element currentTime to timeline position
 *   2. Phase 1 — modifyTransform: effects modify the transform before bounds computed
 *   3. Compute bounds (aspect-aware scaling)
 *   4. Phase 2 — applyRender: effects process pixels (Cutout, Cartoon, ColorGrade)
 *   5. drawImage final source to canvas
 *
 * ## Export pipeline (VideoClip.export.buildFilter):
 *   1. Base clip chain: trim → [base modifiers] → scale → format
 *      - Base modifiers (BeatZoom) are inlined here
 *   2. Effect filter chain: Cutout → Cartoon → ColorGrade each add filter nodes
 *   3. Overlay clip onto accumulated video pad
 *
 * ## When something doesn't work:
 *   - Preview issue   → look at VideoClip.preview below
 *   - Export issue    → look at VideoClip.export below
 *   - Effect issue    → look at packages/elements/src/effects/<EffectName>.ts
 *   - Effect order    → look at EFFECT_REGISTRY in packages/elements/src/index.ts
 *
 * ## Adding a new effect (not element):
 *   → Create packages/elements/src/effects/MyEffect.ts
 *   → Add it to EFFECT_REGISTRY in packages/elements/src/index.ts
 *   → No changes needed here
 */

import type { Clip, Track, Transform } from '@video-editor/shared';
import type {
  ClipElementDefinition,
  ClipPreviewApi,
  ClipExportApi,
  ClipFilterResult,
  Bounds,
  EffectSource,
  PreviewRenderContextWithAssets,
  ExportFilterContext,
} from '../types';
import { EFFECT_REGISTRY } from '../index';
import { getOrCreateMaskVideoEl } from '../effects/Cutout';

// ─── Video element cache ───────────────────────────────────────────────────────
// One hidden <video> element per asset, shared across all frames.
// Exported so Preview.tsx can attach event listeners (seeked, loadeddata).

export const videoElementCache = new Map<string, HTMLVideoElement>();

export function getOrCreateVideoEl(assetId: string, src: string): HTMLVideoElement {
  if (!videoElementCache.has(assetId)) {
    const el = document.createElement('video');
    // crossOrigin must be set BEFORE src for correct CORS behavior
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

// ─── Shared: bounds calculation ───────────────────────────────────────────────

export function getVideoBounds(
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

// ─── Preview implementation ───────────────────────────────────────────────────

const videoClipPreview: ClipPreviewApi = {
  render(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    track: Track,
    transform: Transform,
    context: PreviewRenderContextWithAssets
  ): void {
    const assetProxyPath = context._assetProxyPaths?.get(clip.assetId);
    if (!assetProxyPath) return;

    const videoEl = getOrCreateVideoEl(clip.assetId, `/files/${assetProxyPath}`);

    // ── Sync video time to timeline ─────────────────────────────────────────
    const { currentTime, isPlaying } = context;
    const elapsed = currentTime - clip.timelineStart;
    const sourceTime = clip.sourceStart + elapsed;
    const targetTime = Math.max(0, Math.min(sourceTime, videoEl.duration || 9999));

    if (isPlaying) {
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

    // ── Sync mask video time (needed for Cutout effect) ──────────────────────
    const maskPath = context._maskPaths?.get(clip.assetId);
    if (maskPath) {
      const maskEl = getOrCreateMaskVideoEl(clip.assetId, `/files/${maskPath}`);
      const maskTargetTime = Math.max(
        0,
        Math.min(Math.max(0, clip.sourceStart + (currentTime - clip.timelineStart)), maskEl.duration || 9999)
      );
      if (isPlaying) {
        if (maskEl.paused) { maskEl.currentTime = maskTargetTime; maskEl.play().catch(() => {}); }
        else if (Math.abs(maskEl.currentTime - maskTargetTime) > 0.5) maskEl.currentTime = maskTargetTime;
      } else {
        if (Math.abs(maskEl.currentTime - maskTargetTime) > 0.08) maskEl.currentTime = maskTargetTime;
      }
    }

    // ── Phase 1: Apply transform modifiers (e.g., BeatZoom scale) ───────────
    const effectiveTransform = { ...transform };
    for (const effect of EFFECT_REGISTRY) {
      if (effect.preview.isActive(clip, track, context)) {
        effect.preview.modifyTransform?.(effectiveTransform, clip, track, context);
      }
    }

    const bounds = getVideoBounds(effectiveTransform, videoEl, context.W, context.H);

    // ── Apply transform (opacity + rotation) ─────────────────────────────────
    ctx.save();
    ctx.globalAlpha = transform.opacity;

    if (transform.rotation !== 0) {
      const cx = bounds.x + bounds.w / 2;
      const cy = bounds.y + bounds.h / 2;
      ctx.translate(cx, cy);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    // ── Phase 2: Apply pixel effects in registry order ────────────────────────
    // Each active effect receives the current source and may return a new source.
    // Effects applied in EFFECT_REGISTRY order: BeatZoom → Cutout → Cartoon → ColorGrade.
    try {
      let source: EffectSource = videoEl;

      for (const effect of EFFECT_REGISTRY) {
        if (effect.preview.isActive(clip, track, context) && effect.preview.applyRender) {
          const result = effect.preview.applyRender(ctx, source, bounds, clip, track, context);
          if (result !== null) {
            source = result;
          }
        }
      }

      // Draw the final source to the canvas.
      // If no Phase 2 effect was active, this draws the raw video element.
      ctx.drawImage(source, bounds.x, bounds.y, bounds.w, bounds.h);
    } catch (err) {
      console.error('[VideoClip] Failed to render video clip:', err);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(bounds.x, bounds.y, bounds.w, bounds.h);
    }

    ctx.restore();
  },

  getBounds(
    clip: Clip,
    _track: Track,
    transform: Transform,
    context: { W: number; H: number; ctx: CanvasRenderingContext2D }
  ): Bounds | null {
    const videoEl = videoElementCache.get(clip.assetId) ?? null;
    return getVideoBounds(transform, videoEl, context.W, context.H);
  },
};

// ─── Export implementation ────────────────────────────────────────────────────

const videoClipExport: ClipExportApi = {
  buildFilter(
    prevPad: string,
    clip: Clip,
    track: Track,
    filterIdx: number,
    context: ExportFilterContext
  ): ClipFilterResult | null {
    const { W, H, assetInputIdxMap } = context;

    const inputIdx = assetInputIdxMap.get(clip.assetId);
    if (inputIdx === undefined) return null;

    const srcDuration = clip.sourceEnd - clip.sourceStart;
    if (srcDuration <= 0) return null;

    const outDuration = clip.timelineEnd - clip.timelineStart;
    if (outDuration <= 0) return null;

    const transform = clip.transform ?? { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 };
    const scale = Math.max(0.01, transform.scale);
    const tx = Math.round(transform.x);
    const ty = Math.round(transform.y);

    // Scale to fill canvas with aspect-aware scaling
    const scaledW = Math.round(W * scale);
    const scaledH = Math.round(H * scale);
    const posX = Math.round((W - scaledW) / 2 + tx);
    const posY = Math.round((H - scaledH) / 2 + ty);

    const scaleFilter = `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase,crop=${scaledW}:${scaledH}`;

    // Timeline-aligned PTS: makes `t` variable in subsequent filter expressions
    // equal to absolute timeline time, enabling correct overlay enable expressions
    // and beat-zoom crop filter evaluation.
    const trimFilter = `trim=start=${clip.sourceStart.toFixed(4)}:end=${clip.sourceEnd.toFixed(4)},setpts=PTS-STARTPTS+${clip.timelineStart.toFixed(4)}/TB`;

    // ── Base modifier loop: collect inline filter fragments ──────────────────
    // Effects that modify the base clip chain (e.g., BeatZoom crop) are collected
    // here and inlined directly into the trim+setpts+scale filter chain.
    let baseModifierFragment = '';
    for (const effect of EFFECT_REGISTRY) {
      if (effect.export.isActive(clip, track, context) && effect.export.buildBaseModifier) {
        const modifier = effect.export.buildBaseModifier(clip, track, context);
        if (modifier) baseModifierFragment += modifier;
      }
    }

    const allFilters: string[] = [];

    // Base clip chain: trim → [base modifiers] → scale → format
    const baseClipPad = `clip${filterIdx}`;
    allFilters.push(
      `[${inputIdx}:v]${trimFilter}${baseModifierFragment},${scaleFilter},format=yuv420p[${baseClipPad}]`
    );

    let clipPad = baseClipPad;

    // ── Filter chain loop: apply effect filter nodes in registry order ────────
    // Effects that add separate filter nodes (Cutout, Cartoon, ColorGrade) are
    // chained here. Each effect receives the current pad and returns a new pad.
    for (const effect of EFFECT_REGISTRY) {
      if (effect.export.isActive(clip, track, context) && effect.export.buildFilter) {
        const result = effect.export.buildFilter(clipPad, clip, track, filterIdx, context);
        if (result) {
          allFilters.push(...result.filters);
          clipPad = result.outputPad;
        }
      }
    }

    // ── Overlay clip onto the accumulated video pad ───────────────────────────
    const delay = clip.timelineStart;
    const overlayPad = `ov${filterIdx}`;
    allFilters.push(
      `[${prevPad}][${clipPad}]overlay=${posX}:${posY}:enable='between(t,${delay.toFixed(4)},${(delay + outDuration).toFixed(4)})'[${overlayPad}]`
    );

    return {
      filters: allFilters,
      outputPad: overlayPad,
      nextFilterIdx: filterIdx + 1,
    };
  },
};

// ─── Unified ClipElementDefinition ───────────────────────────────────────────

/**
 * Unified video clip element definition.
 *
 * Handles all video clips that have an assetId and are on video tracks
 * (but NOT text clips or rectangle clips which live on the same tracks).
 *
 * When video clips don't look right → start here, then check EFFECT_REGISTRY.
 */
export const VideoClipElement: ClipElementDefinition = {
  clipType: 'video',

  canHandle(clip: Clip, track: Track): boolean {
    // Video clips on video tracks that are not text or rectangle overlays
    return track.type === 'video' && !clip.textContent && !clip.rectangleStyle;
  },

  preview: videoClipPreview,
  export: videoClipExport,
};
