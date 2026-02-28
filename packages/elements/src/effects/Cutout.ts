/**
 * Cutout Effect
 *
 * Composites a cutout subject over a background by using a pre-baked mask video.
 * The mask is grayscale yuv420p: white = subject/foreground, black = background.
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │  PREVIEW: Canvas 2D — luminance-to-alpha mask + destination-in composite  │
 * │  EXPORT:  FFmpeg — multiply blend + addition blend (no alpha channel)     │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Modes:
 *   removeBg     — keep person/subject, replace background (default)
 *   removePerson — keep background, remove person/subject
 *
 * Config params (from EffectClipConfig):
 *   cutoutMode — 'removeBg' | 'removePerson'
 *   background — { type: 'solid', color: '#rrggbb' }
 *
 * Export implementation uses yuv math (multiply + addition blend) instead of
 * alpha channels to avoid format conversion issues when Cartoon/ColorGrade
 * are also active. This approach keeps the output in yuv420p throughout.
 *
 * The mask video is collected by ExportPipeline from asset.maskPath and made
 * available via context.assetMaskInputIdxMap. If no mask is available for a clip,
 * the effect is silently skipped (same behavior as preview when maskPath is absent).
 */

import type { Clip, Track } from '@video-editor/shared';
import { getActiveEffectConfig, getOverlappingEffectConfig } from '@video-editor/shared';
import type {
  EffectDefinition,
  EffectPreviewApi,
  EffectExportApi,
  EffectSource,
  Bounds,
  PreviewRenderContextWithAssets,
  ExportFilterContext,
  EffectFilterResult,
} from '../types';

// ─── Preview: canvas cache ─────────────────────────────────────────────────────

let _cutoutVideoCanvas: HTMLCanvasElement | null = null;
let _cutoutMaskCanvas: HTMLCanvasElement | null = null;

function getCutoutCanvases(w: number, h: number) {
  const iw = Math.max(2, Math.round(w));
  const ih = Math.max(2, Math.round(h));
  if (!_cutoutVideoCanvas || _cutoutVideoCanvas.width !== iw || _cutoutVideoCanvas.height !== ih) {
    _cutoutVideoCanvas = document.createElement('canvas');
    _cutoutVideoCanvas.width = iw;
    _cutoutVideoCanvas.height = ih;
  }
  if (!_cutoutMaskCanvas || _cutoutMaskCanvas.width !== iw || _cutoutMaskCanvas.height !== ih) {
    _cutoutMaskCanvas = document.createElement('canvas');
    _cutoutMaskCanvas.width = iw;
    _cutoutMaskCanvas.height = ih;
  }
  return { videoCanvas: _cutoutVideoCanvas, maskCanvas: _cutoutMaskCanvas };
}

// ─── Preview: mask video element cache ────────────────────────────────────────

export const maskVideoCache = new Map<string, HTMLVideoElement>();

export function getOrCreateMaskVideoEl(assetId: string, src: string): HTMLVideoElement {
  const key = `mask-${assetId}`;
  if (!maskVideoCache.has(key)) {
    const el = document.createElement('video');
    el.crossOrigin = 'anonymous';
    el.src = src;
    el.preload = 'auto';
    el.muted = true;
    el.style.display = 'none';
    document.body.appendChild(el);
    maskVideoCache.set(key, el);
  }
  return maskVideoCache.get(key)!;
}

// ─── Preview: core cutout processing ──────────────────────────────────────────

/**
 * Apply cutout compositing to the canvas.
 *
 * Steps:
 *   1. Draw solid background onto ctx
 *   2. Draw video to offscreen canvas A
 *   3. Draw mask to offscreen canvas B → convert luminance to alpha
 *   4. Apply mask canvas as alpha via destination-in
 *   5. Return the masked video canvas (pipeline draws it over the background)
 *
 * Returns the masked video canvas for chaining, or null on failure.
 */
export function applyCutoutPreview(
  ctx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement,
  maskEl: HTMLVideoElement,
  bounds: Bounds,
  mode: 'removeBg' | 'removePerson',
  bgColor: string
): HTMLCanvasElement | null {
  const { x, y, w, h } = bounds;
  const iw = Math.max(2, Math.round(w));
  const ih = Math.max(2, Math.round(h));

  // 1. Draw solid background
  ctx.fillStyle = bgColor;
  ctx.fillRect(x, y, w, h);

  const { videoCanvas, maskCanvas } = getCutoutCanvases(iw, ih);
  const videoCtx = videoCanvas.getContext('2d');
  const maskCtx = maskCanvas.getContext('2d');
  if (!videoCtx || !maskCtx) return null;

  // 2. Draw video frame to offscreen canvas
  videoCtx.clearRect(0, 0, iw, ih);
  videoCtx.drawImage(videoEl, 0, 0, iw, ih);

  // 3. Draw mask, convert luminance → alpha
  //    removeBg:     alpha = lum       (white subject = opaque)
  //    removePerson: alpha = 255 - lum (white subject = transparent)
  try {
    maskCtx.clearRect(0, 0, iw, ih);
    maskCtx.drawImage(maskEl, 0, 0, iw, ih);
    const maskData = maskCtx.getImageData(0, 0, iw, ih);
    const invert = mode === 'removePerson';
    for (let i = 0; i < maskData.data.length; i += 4) {
      const lum =
        maskData.data[i] * 0.299 +
        maskData.data[i + 1] * 0.587 +
        maskData.data[i + 2] * 0.114;
      maskData.data[i + 3] = invert ? Math.round(255 - lum) : Math.round(lum);
      maskData.data[i] = maskData.data[i + 1] = maskData.data[i + 2] = 255;
    }
    maskCtx.putImageData(maskData, 0, 0);

    // 4. Apply mask as alpha (keep pixels where mask is opaque)
    videoCtx.globalCompositeOperation = 'destination-in';
    videoCtx.drawImage(maskCanvas, 0, 0);
    videoCtx.globalCompositeOperation = 'source-over';
  } catch (err) {
    console.warn('[CutoutEffect] Mask pixel manipulation failed (CORS?):', err);
    return null;
  }

  // Return masked canvas — pipeline will draw it over the background
  return videoCanvas;
}

// ─── Preview implementation ───────────────────────────────────────────────────

const cutoutPreview: EffectPreviewApi = {
  isActive(clip: Clip, track: Track, context: PreviewRenderContextWithAssets): boolean {
    const cfg = getActiveEffectConfig(context.project, track, 'cutout', context.currentTime);
    if (!cfg?.enabled) return false;
    // Need a mask video to be available
    return !!context._maskPaths.get(clip.assetId);
  },

  /**
   * Phase 2: Apply cutout compositing.
   * Draws the background to ctx as a side effect.
   * Returns the masked video canvas for subsequent effects to process.
   */
  applyRender(
    ctx: CanvasRenderingContext2D,
    source: EffectSource,
    bounds: Bounds,
    clip: Clip,
    track: Track,
    context: PreviewRenderContextWithAssets
  ): EffectSource | null {
    const cfg = getActiveEffectConfig(context.project, track, 'cutout', context.currentTime);
    if (!cfg) return null;

    const maskPath = context._maskPaths.get(clip.assetId);
    if (!maskPath) return null;

    // Source must be a video element for cutout (we need the raw video for masking)
    if (!(source instanceof HTMLVideoElement)) return null;

    const maskEl = getOrCreateMaskVideoEl(clip.assetId, `/files/${maskPath}`);
    const mode = cfg.cutoutMode ?? 'removeBg';
    const bgColor = cfg.background?.color ?? '#000000';

    return applyCutoutPreview(ctx, source, maskEl, bounds, mode, bgColor);
  },
};

// ─── Export implementation ────────────────────────────────────────────────────

const cutoutExport: EffectExportApi = {
  isActive(clip: Clip, track: Track, context: ExportFilterContext): boolean {
    const cfg = getOverlappingEffectConfig(context.project, track, 'cutout', clip);
    if (!cfg?.enabled) return false;
    // Need a mask input to have been registered for this asset
    return context.assetMaskInputIdxMap.has(clip.assetId);
  },

  /**
   * Builds an FFmpeg filter chain for cutout compositing using yuv math.
   *
   * The approach avoids alpha channels entirely (keeping yuv420p throughout)
   * by using multiply + addition blend:
   *
   *   For removeBg mode:
   *     subject_pixels = clip * mask / 255          (clip where mask is white)
   *     background_pixels = bg * inv_mask / 255     (bg where mask is black)
   *     result = subject + background               (composite)
   *
   *   For removePerson mode: swap mask and inv_mask roles
   *
   * This composites cleanly without format conversion, allowing Cartoon and
   * ColorGrade to chain after this filter without issues.
   */
  buildFilter(
    inputPad: string,
    clip: Clip,
    track: Track,
    filterIdx: number,
    context: ExportFilterContext
  ): EffectFilterResult | null {
    const cfg = getOverlappingEffectConfig(context.project, track, 'cutout', clip);
    if (!cfg) return null;

    const maskInputIdx = context.assetMaskInputIdxMap.get(clip.assetId);
    if (maskInputIdx === undefined) {
      console.warn(`[CutoutEffect export] No mask input for assetId=${clip.assetId}`);
      return null;
    }

    const { W, H } = context;
    const transform = clip.transform ?? { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 };
    const scale = Math.max(0.01, transform.scale);
    const scaledW = Math.round(W * scale);
    const scaledH = Math.round(H * scale);

    const mode = cfg.cutoutMode ?? 'removeBg';
    const bgColor = (cfg.background?.color ?? '#000000').replace('#', '0x');
    const clipDuration = clip.timelineEnd - clip.timelineStart;

    // Pad names
    const maskTrimmed = `cut_maskt_${filterIdx}`;
    const maskA = `cut_maska_${filterIdx}`;  // split output A → negate → maskInv
    const maskB = `cut_maskb_${filterIdx}`;  // split output B → multiply blend
    const maskInv = `cut_minv_${filterIdx}`;
    const bgPad = `cut_bg_${filterIdx}`;
    const bgMasked = `cut_bgm_${filterIdx}`;
    const subjMasked = `cut_subj_${filterIdx}`;
    const outPad = `cut_out_${filterIdx}`;

    const trimFilter = [
      `trim=start=${clip.sourceStart.toFixed(4)}:end=${clip.sourceEnd.toFixed(4)}`,
      `setpts=PTS-STARTPTS+${clip.timelineStart.toFixed(4)}/TB`,
      `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase`,
      `crop=${scaledW}:${scaledH}`,
      `format=yuv420p`,
    ].join(',');

    const filters: string[] = [
      // Trim and scale the mask to match the clip's output dimensions
      `[${maskInputIdx}:v]${trimFilter}[${maskTrimmed}]`,
      // Split the mask into two copies — FFmpeg requires split because a labeled pad
      // can only be consumed by a single filter. We need the mask twice:
      // once for negate (→ inverted mask for background) and once for blend (→ subject).
      `[${maskTrimmed}]split[${maskA}][${maskB}]`,
      // Create inverted mask (for the background region)
      `[${maskA}]negate[${maskInv}]`,
      // Create background fill at clip dimensions
      `color=c=${bgColor}:s=${scaledW}x${scaledH}:r=30:d=${clipDuration.toFixed(4)}[${bgPad}]`,
    ];

    if (mode === 'removeBg') {
      // Keep person (subject), replace background
      // subject = clip × mask / 255  (pixels where mask is white)
      // bg_area = bg × inv_mask / 255  (pixels where mask is black)
      filters.push(`[${inputPad}][${maskB}]blend=all_mode=multiply[${subjMasked}]`);
      filters.push(`[${bgPad}][${maskInv}]blend=all_mode=multiply[${bgMasked}]`);
    } else {
      // removePerson: keep background, replace person
      // bg_area = clip × inv_mask / 255  (pixels where mask is black = bg region)
      // subject_area = bg × mask / 255  (pixels where mask is white = person region)
      filters.push(`[${inputPad}][${maskInv}]blend=all_mode=multiply[${subjMasked}]`);
      filters.push(`[${bgPad}][${maskB}]blend=all_mode=multiply[${bgMasked}]`);
    }

    // Composite: add the two masked regions together
    filters.push(`[${subjMasked}][${bgMasked}]blend=all_mode=addition[${outPad}]`);

    return { filters, outputPad: outPad };
  },
};

// ─── Effect Definition (exported) ─────────────────────────────────────────────

export const CutoutEffect: EffectDefinition = {
  type: 'cutout',
  preview: cutoutPreview,
  export: cutoutExport,
};
