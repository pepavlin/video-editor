/**
 * Color Grade Effect
 *
 * Applies color correction: contrast, brightness, saturation, hue, shadows, highlights.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  PREVIEW: Canvas 2D — CSS filter (fast) + optional pixel manipulation   │
 * │  EXPORT:  FFmpeg — eq filter + optional hue filter                      │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Config params (from EffectClipConfig):
 *   contrast        — 0..2 (1 = no change)
 *   brightness      — 0..2 (1 = no change)
 *   colorSaturation — 0..2 (1 = no change)
 *   hue             — -180..180 degrees (0 = no change)
 *   shadows         — -1..1 (0 = no change) — lifts/crushes dark pixels
 *   highlights      — -1..1 (0 = no change) — boosts/reduces bright pixels
 *
 * Known limitation: shadows/highlights are preview-only.
 * The FFmpeg eq filter does not support shadow/highlight lifting.
 * To add export support, implement curves or LUT-based approach in buildFilter.
 */

import type { Clip, Track, EffectClipConfig } from '@video-editor/shared';
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

let _colorGradeCanvas: HTMLCanvasElement | null = null;

function getColorGradeCanvas(iw: number, ih: number): HTMLCanvasElement {
  if (!_colorGradeCanvas || _colorGradeCanvas.width !== iw || _colorGradeCanvas.height !== ih) {
    _colorGradeCanvas = document.createElement('canvas');
    _colorGradeCanvas.width = iw;
    _colorGradeCanvas.height = ih;
  }
  return _colorGradeCanvas;
}

// ─── Preview: CSS filter helper ───────────────────────────────────────────────

/**
 * Build a CSS filter string for the basic color-grade adjustments.
 * Returns an empty string when all params are at neutral values.
 */
export function buildColorGradeCssFilter(
  contrast: number,
  brightness: number,
  colorSaturation: number,
  hue: number
): string {
  const parts: string[] = [];
  if (contrast !== 1) parts.push(`contrast(${contrast})`);
  if (brightness !== 1) parts.push(`brightness(${brightness})`);
  if (colorSaturation !== 1) parts.push(`saturate(${colorSaturation})`);
  if (hue !== 0) parts.push(`hue-rotate(${hue}deg)`);
  return parts.join(' ');
}

// ─── Preview: core color grade processing ─────────────────────────────────────

/**
 * Apply color grading to a source image and return the result canvas.
 * Uses CSS filter for the fast path (no shadows/highlights).
 * Uses pixel manipulation for shadows/highlights (slow path).
 *
 * Returns an offscreen canvas so this effect can chain with subsequent effects.
 * Returns null if context cannot be obtained (extremely rare).
 */
export function processColorGradeFrame(
  source: EffectSource,
  bounds: Bounds,
  cfg: EffectClipConfig
): HTMLCanvasElement | null {
  const contrast = cfg.contrast ?? 1;
  const brightness = cfg.brightness ?? 1;
  const colorSaturation = cfg.colorSaturation ?? 1;
  const hue = cfg.hue ?? 0;
  const shadows = cfg.shadows ?? 0;
  const highlights = cfg.highlights ?? 0;

  const iw = Math.max(2, Math.round(bounds.w));
  const ih = Math.max(2, Math.round(bounds.h));
  const offCanvas = getColorGradeCanvas(iw, ih);
  const offCtx = offCanvas.getContext('2d');
  if (!offCtx) return null;

  const cssFilter = buildColorGradeCssFilter(contrast, brightness, colorSaturation, hue);
  const needsPixels = shadows !== 0 || highlights !== 0;

  // Draw source with CSS filter to the offscreen canvas
  offCtx.clearRect(0, 0, iw, ih);
  if (cssFilter) offCtx.filter = cssFilter;
  offCtx.drawImage(source, 0, 0, iw, ih);
  offCtx.filter = 'none';

  if (needsPixels) {
    // Slow path: per-pixel shadows/highlights manipulation
    // shadows > 0  → lift darks (dark pixels get brighter)
    // shadows < 0  → crush darks (dark pixels get darker)
    // highlights > 0 → boost brights (bright pixels get brighter)
    // highlights < 0 → reduce brights (bright pixels get darker)
    // Quadratic weight: strongest effect at extremes, falls off toward midtones
    try {
      const imageData = offCtx.getImageData(0, 0, iw, ih);
      const data = imageData.data;
      for (let i = 0; i < data.length; i += 4) {
        for (let c = 0; c < 3; c++) {
          let v = data[i + c] / 255;
          if (shadows !== 0) v += shadows * (1 - v) * (1 - v);
          if (highlights !== 0) v += highlights * v * v;
          data[i + c] = Math.max(0, Math.min(255, Math.round(v * 255)));
        }
      }
      offCtx.putImageData(imageData, 0, 0);
    } catch (err) {
      console.warn('[ColorGradeEffect] Pixel manipulation failed (CORS?):', err);
    }
  }

  return offCanvas;
}

// ─── Preview implementation ───────────────────────────────────────────────────

const colorGradePreview: EffectPreviewApi = {
  isActive(clip: Clip, track: Track, context: PreviewRenderContextWithAssets): boolean {
    const cfg = getActiveEffectConfig(context.project, track, 'colorGrade', context.currentTime);
    return !!(cfg?.enabled);
  },

  /**
   * Phase 2: Apply color grading to the source image.
   * Returns an offscreen canvas with the color grade applied.
   * Uses CSS filter (fast) when no shadows/highlights; pixel manipulation otherwise.
   */
  applyRender(
    _ctx: CanvasRenderingContext2D,
    source: EffectSource,
    bounds: Bounds,
    clip: Clip,
    track: Track,
    context: PreviewRenderContextWithAssets
  ): EffectSource | null {
    const cfg = getActiveEffectConfig(context.project, track, 'colorGrade', context.currentTime);
    if (!cfg) return null;
    return processColorGradeFrame(source, bounds, cfg);
  },
};

// ─── Export implementation ────────────────────────────────────────────────────

const colorGradeExport: EffectExportApi = {
  isActive(clip: Clip, track: Track, context: ExportFilterContext): boolean {
    return !!(getOverlappingEffectConfig(context.project, track, 'colorGrade', clip)?.enabled);
  },

  /**
   * Builds FFmpeg eq + hue filters for color grading.
   *
   * Note: shadows and highlights are not supported in export.
   * The FFmpeg eq filter doesn't support shadow/highlight lifting.
   * To add support, implement using the curves or LUT filter.
   */
  buildFilter(
    inputPad: string,
    clip: Clip,
    track: Track,
    filterIdx: number,
    context: ExportFilterContext
  ): EffectFilterResult | null {
    const cfg = getOverlappingEffectConfig(context.project, track, 'colorGrade', clip);
    if (!cfg) return null;

    const contrast = cfg.contrast ?? 1;
    const brightness = cfg.brightness ?? 1;
    const colorSaturation = cfg.colorSaturation ?? 1;
    const hue = cfg.hue ?? 0;

    const outPad = `cg_${filterIdx}`;

    const eqParts: string[] = [];
    if (contrast !== 1) eqParts.push(`contrast=${contrast.toFixed(4)}`);
    if (brightness !== 1) eqParts.push(`brightness=${(brightness - 1).toFixed(4)}`);
    if (colorSaturation !== 1) eqParts.push(`saturation=${colorSaturation.toFixed(4)}`);

    const filters: string[] = [];

    if (eqParts.length > 0 && hue !== 0) {
      const eqPad = `cgeq_${filterIdx}`;
      filters.push(`[${inputPad}]eq=${eqParts.join(':')}[${eqPad}]`);
      filters.push(`[${eqPad}]hue=h=${hue.toFixed(2)}[${outPad}]`);
    } else if (eqParts.length > 0) {
      filters.push(`[${inputPad}]eq=${eqParts.join(':')}[${outPad}]`);
    } else if (hue !== 0) {
      filters.push(`[${inputPad}]hue=h=${hue.toFixed(2)}[${outPad}]`);
    } else {
      // All params at neutral — isActive() should have caught this, but be safe
      return { filters: [], outputPad: inputPad };
    }

    return { filters, outputPad: outPad };
  },
};

// ─── Effect Definition (exported) ─────────────────────────────────────────────

export const ColorGradeEffect: EffectDefinition = {
  type: 'colorGrade',
  preview: colorGradePreview,
  export: colorGradeExport,
};
