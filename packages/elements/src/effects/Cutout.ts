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
 *   cutoutMode    — 'removeBg' | 'removePerson'
 *   background    — { type: 'solid', color: '#rrggbb' }
 *   maskThreshold — 0-255 luminance threshold for mask binarization (default 128)
 *   maskExpand    — -10..10 expand/contract mask edges in px (default 0)
 *   maskBlur      — 0-20 edge smoothing / feathering radius (default 0)
 *
 * Export implementation converts to planar RGB (gbrp) for the multiply + addition
 * blend operations, then converts back to yuv420p. This is necessary because
 * the grayscale mask has U=128, V=128 in YUV — multiplying in YUV space would
 * halve the chroma channels, causing severe color desaturation. In gbrp, the
 * mask's grayscale values are replicated across R=G=B, so multiply works correctly.
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
let _cutoutTempCanvas: HTMLCanvasElement | null = null;

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
  if (!_cutoutTempCanvas || _cutoutTempCanvas.width !== iw || _cutoutTempCanvas.height !== ih) {
    _cutoutTempCanvas = document.createElement('canvas');
    _cutoutTempCanvas.width = iw;
    _cutoutTempCanvas.height = ih;
  }
  return { videoCanvas: _cutoutVideoCanvas, maskCanvas: _cutoutMaskCanvas, tempCanvas: _cutoutTempCanvas };
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

/** Mask adjustment parameters for live preview tuning. */
export interface MaskAdjustParams {
  /** Luminance threshold for mask binarization (0-255, default 128). */
  threshold: number;
  /** Expand (+) or contract (-) mask edges in px (-10 to 10, default 0). */
  expand: number;
  /** Gaussian blur radius for edge smoothing in px (0-20, default 0). */
  blur: number;
}

export const DEFAULT_MASK_ADJUST: MaskAdjustParams = {
  threshold: 128,
  expand: 0,
  blur: 0,
};

/**
 * Apply cutout compositing to the canvas.
 *
 * Steps:
 *   1. Draw solid background onto ctx
 *   2. Draw video to offscreen canvas A
 *   3. Draw mask to offscreen canvas B
 *   4. Process mask: threshold → expand/contract → blur (user-adjustable)
 *   5. Convert processed mask luminance to alpha
 *   6. Apply mask canvas as alpha via destination-in
 *   7. Return the masked video canvas (pipeline draws it over the background)
 *
 * Returns the masked video canvas for chaining, or null on failure.
 */
export function applyCutoutPreview(
  ctx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement,
  maskEl: HTMLVideoElement,
  bounds: Bounds,
  mode: 'removeBg' | 'removePerson',
  bgColor: string,
  maskAdjust: MaskAdjustParams = DEFAULT_MASK_ADJUST,
): HTMLCanvasElement | null {
  const { x, y, w, h } = bounds;
  const iw = Math.max(2, Math.round(w));
  const ih = Math.max(2, Math.round(h));

  // 1. Draw solid background
  ctx.fillStyle = bgColor;
  ctx.fillRect(x, y, w, h);

  const { videoCanvas, maskCanvas, tempCanvas } = getCutoutCanvases(iw, ih);
  const videoCtx = videoCanvas.getContext('2d');
  const maskCtx = maskCanvas.getContext('2d');
  const tempCtx = tempCanvas.getContext('2d');
  if (!videoCtx || !maskCtx || !tempCtx) return null;

  // 2. Draw video frame to offscreen canvas
  videoCtx.clearRect(0, 0, iw, ih);
  videoCtx.drawImage(videoEl, 0, 0, iw, ih);

  try {
    // 3. Draw raw mask
    maskCtx.filter = 'none';
    maskCtx.globalCompositeOperation = 'source-over';
    maskCtx.clearRect(0, 0, iw, ih);
    maskCtx.drawImage(maskEl, 0, 0, iw, ih);

    // 4a. Apply threshold — binarize the grayscale mask
    const threshold = maskAdjust.threshold;
    const maskData = maskCtx.getImageData(0, 0, iw, ih);
    for (let i = 0; i < maskData.data.length; i += 4) {
      const lum =
        maskData.data[i] * 0.299 +
        maskData.data[i + 1] * 0.587 +
        maskData.data[i + 2] * 0.114;
      const val = lum >= threshold ? 255 : 0;
      maskData.data[i] = maskData.data[i + 1] = maskData.data[i + 2] = val;
      maskData.data[i + 3] = 255;
    }
    maskCtx.putImageData(maskData, 0, 0);

    // 4b. Apply expand/contract via blur + re-threshold
    //     Dilate: blur the binary mask, then re-threshold at a low value (grows white)
    //     Erode:  blur the binary mask, then re-threshold at a high value (shrinks white)
    const expand = maskAdjust.expand;
    if (expand !== 0) {
      const blurRadius = Math.abs(expand) * 1.5;
      // Draw blurred mask to temp canvas
      tempCtx.filter = `blur(${blurRadius}px)`;
      tempCtx.clearRect(0, 0, iw, ih);
      tempCtx.drawImage(maskCanvas, 0, 0);
      tempCtx.filter = 'none';

      // Re-threshold the blurred result
      const expandThreshold = expand > 0
        ? Math.max(1, 128 - expand * 12)   // lower threshold → grow mask
        : Math.min(254, 128 + Math.abs(expand) * 12); // higher threshold → shrink mask
      const blurredData = tempCtx.getImageData(0, 0, iw, ih);
      for (let i = 0; i < blurredData.data.length; i += 4) {
        const lum =
          blurredData.data[i] * 0.299 +
          blurredData.data[i + 1] * 0.587 +
          blurredData.data[i + 2] * 0.114;
        const val = lum >= expandThreshold ? 255 : 0;
        blurredData.data[i] = blurredData.data[i + 1] = blurredData.data[i + 2] = val;
        blurredData.data[i + 3] = 255;
      }
      // Write result back to maskCanvas
      maskCtx.putImageData(blurredData, 0, 0);
    }

    // 4c. Apply edge blur (feathering)
    const blur = maskAdjust.blur;
    if (blur > 0) {
      tempCtx.filter = `blur(${blur}px)`;
      tempCtx.clearRect(0, 0, iw, ih);
      tempCtx.drawImage(maskCanvas, 0, 0);
      tempCtx.filter = 'none';
      // Copy blurred result back to maskCanvas
      maskCtx.clearRect(0, 0, iw, ih);
      maskCtx.drawImage(tempCanvas, 0, 0);
    }

    // 5. Convert processed mask luminance → alpha
    const invert = mode === 'removePerson';
    const finalData = maskCtx.getImageData(0, 0, iw, ih);
    for (let i = 0; i < finalData.data.length; i += 4) {
      const lum =
        finalData.data[i] * 0.299 +
        finalData.data[i + 1] * 0.587 +
        finalData.data[i + 2] * 0.114;
      finalData.data[i + 3] = invert ? Math.round(255 - lum) : Math.round(lum);
      finalData.data[i] = finalData.data[i + 1] = finalData.data[i + 2] = 255;
    }
    maskCtx.putImageData(finalData, 0, 0);

    // 6. Apply mask as alpha (keep pixels where mask is opaque)
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
    const maskAdjust: MaskAdjustParams = {
      threshold: cfg.maskThreshold ?? DEFAULT_MASK_ADJUST.threshold,
      expand: cfg.maskExpand ?? DEFAULT_MASK_ADJUST.expand,
      blur: cfg.maskBlur ?? DEFAULT_MASK_ADJUST.blur,
    };

    return applyCutoutPreview(ctx, source, maskEl, bounds, mode, bgColor, maskAdjust);
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
   * Builds an FFmpeg filter chain for cutout compositing.
   *
   * Uses multiply + addition blend in planar RGB (gbrp) color space:
   *
   *   For removeBg mode:
   *     subject_pixels = clip_rgb * mask_rgb / 255   (clip where mask is white)
   *     background_pixels = bg_rgb * inv_mask_rgb / 255  (bg where mask is black)
   *     result = subject + background                (composite)
   *
   *   For removePerson mode: swap mask and inv_mask roles
   *
   * The blending MUST be done in RGB, not YUV. In YUV420p, the grayscale mask
   * has Y=0/255 but U=128, V=128 (neutral chroma). Multiplying in YUV would
   * halve the chroma channels (U_clip * 128/255 ≈ 0.5 * U_clip), causing
   * severe color desaturation. In gbrp, the mask converts to R=G=B=Y_mask
   * (all 0 or 255), so multiply preserves all channels correctly.
   *
   * After composition, the result is converted back to yuv420p so that
   * downstream effects (Cartoon, ColorGrade) receive the expected format.
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
    // Round to nearest even number — required for yuv420p format and libx264 encoding
    const scaledW = Math.round(W * scale / 2) * 2 || 2;
    const scaledH = Math.round(H * scale / 2) * 2 || 2;

    const mode = cfg.cutoutMode ?? 'removeBg';
    const bgColor = (cfg.background?.color ?? '#000000').replace('#', '0x');
    const clipDuration = clip.timelineEnd - clip.timelineStart;

    // Mask adjustment parameters
    const maskThreshold = cfg.maskThreshold ?? DEFAULT_MASK_ADJUST.threshold;
    const maskExpand = cfg.maskExpand ?? DEFAULT_MASK_ADJUST.expand;
    const maskBlur = cfg.maskBlur ?? DEFAULT_MASK_ADJUST.blur;

    // Pad names
    const maskTrimmed = `cut_maskt_${filterIdx}`;
    const maskProcessed = `cut_maskp_${filterIdx}`;
    const maskRgb = `cut_maskrgb_${filterIdx}`;
    const maskA = `cut_maska_${filterIdx}`;  // split output A → negate → maskInv
    const maskB = `cut_maskb_${filterIdx}`;  // split output B → multiply blend
    const maskInv = `cut_minv_${filterIdx}`;
    const clipRgb = `cut_cliprgb_${filterIdx}`;
    const bgPad = `cut_bg_${filterIdx}`;
    const bgMasked = `cut_bgm_${filterIdx}`;
    const subjMasked = `cut_subj_${filterIdx}`;
    const compositeRgb = `cut_comp_${filterIdx}`;
    const outPad = `cut_out_${filterIdx}`;

    const trimFilter = [
      `trim=start=${clip.sourceStart.toFixed(4)}:end=${clip.sourceEnd.toFixed(4)}`,
      `setpts=PTS-STARTPTS+${clip.timelineStart.toFixed(4)}/TB`,
      `scale=${scaledW}:${scaledH}:force_original_aspect_ratio=increase`,
      `crop=${scaledW}:${scaledH}`,
      `format=yuv420p`,
    ].join(',');

    // Build mask processing filter chain: threshold → expand/contract → blur
    // These operate on YUV (Y channel only) which is correct for mask processing
    const maskProcessingSteps: string[] = [];
    // Threshold: binarize the mask using lut on Y channel
    maskProcessingSteps.push(`lutyuv=y='if(gte(val,${maskThreshold}),255,0)'`);
    // Expand/contract: use maximum (dilate) or minimum (erode) morphological filters
    if (maskExpand > 0) {
      const radius = Math.min(Math.round(maskExpand), 10);
      for (let i = 0; i < radius; i++) {
        maskProcessingSteps.push('maximum=radius=1');
      }
    } else if (maskExpand < 0) {
      const radius = Math.min(Math.round(Math.abs(maskExpand)), 10);
      for (let i = 0; i < radius; i++) {
        maskProcessingSteps.push('minimum=radius=1');
      }
    }
    // Edge blur (feathering)
    if (maskBlur > 0) {
      maskProcessingSteps.push(`gblur=sigma=${maskBlur.toFixed(1)}`);
    }

    const filters: string[] = [
      // Trim and scale the mask to match the clip's output dimensions
      `[${maskInputIdx}:v]${trimFilter}[${maskTrimmed}]`,
      // Apply mask processing in YUV (threshold, expand, blur operate on Y channel)
      `[${maskTrimmed}]${maskProcessingSteps.join(',')}[${maskProcessed}]`,
      // Convert processed mask to planar RGB for correct blending.
      // In gbrp, the grayscale mask becomes R=G=B=Y_mask (0 or 255 on all channels).
      `[${maskProcessed}]format=gbrp[${maskRgb}]`,
      // Split the RGB mask into two copies for negate and blend
      `[${maskRgb}]split[${maskA}][${maskB}]`,
      // Create inverted mask (for the background region) — negate in gbrp is correct
      `[${maskA}]negate[${maskInv}]`,
      // Convert clip to gbrp for blending
      `[${inputPad}]format=gbrp[${clipRgb}]`,
      // Create background fill at clip dimensions in gbrp.
      // setpts aligns PTS with the clip's timeline position so the blend filter
      // receives time-synchronized frames (prevents frame count mismatch).
      `color=c=${bgColor}:s=${scaledW}x${scaledH}:r=30:d=${clipDuration.toFixed(4)},setpts=PTS-STARTPTS+${clip.timelineStart.toFixed(4)}/TB,format=gbrp[${bgPad}]`,
    ];

    if (mode === 'removeBg') {
      // Keep person (subject), replace background
      // subject = clip_rgb × mask_rgb / 255  (pixels where mask is white = R=G=B=255)
      // bg_area = bg_rgb × inv_mask_rgb / 255  (pixels where mask is black = R=G=B=0)
      filters.push(`[${clipRgb}][${maskB}]blend=all_mode=multiply[${subjMasked}]`);
      filters.push(`[${bgPad}][${maskInv}]blend=all_mode=multiply[${bgMasked}]`);
    } else {
      // removePerson: keep background, replace person
      // bg_area = clip_rgb × inv_mask_rgb / 255  (bg region)
      // subject_area = bg_rgb × mask_rgb / 255  (person region replaced with bg)
      filters.push(`[${clipRgb}][${maskInv}]blend=all_mode=multiply[${subjMasked}]`);
      filters.push(`[${bgPad}][${maskB}]blend=all_mode=multiply[${bgMasked}]`);
    }

    // Composite: add the two masked regions together, then convert back to yuv420p
    filters.push(`[${subjMasked}][${bgMasked}]blend=all_mode=addition,format=yuv420p[${outPad}]`);

    return { filters, outputPad: outPad };
  },
};

// ─── Effect Definition (exported) ─────────────────────────────────────────────

export const CutoutEffect: EffectDefinition = {
  type: 'cutout',
  preview: cutoutPreview,
  export: cutoutExport,
};
