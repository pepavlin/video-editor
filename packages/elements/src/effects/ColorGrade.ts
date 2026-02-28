/**
 * Color Grade Effect
 *
 * Applies color correction: contrast, brightness, saturation, hue, shadows, highlights.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  PREVIEW: Canvas 2D — CSS filter (fast) + optional pixel manipulation   │
 * │  EXPORT:  FFmpeg — eq + hue + geq (shadows/highlights) filters          │
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
 * ## Export filter chain
 *
 * The export builds up to three chained filters depending on active params:
 *   1. eq=contrast:brightness:saturation  — basic adjustments (FFmpeg eq filter)
 *   2. hue=h=<degrees>                   — hue rotation (FFmpeg hue filter)
 *   3. format=rgb24,geq=r/g/b,format=yuv420p — shadows/highlights (FFmpeg geq)
 *
 * The shadows/highlights formula is IDENTICAL to the preview Canvas 2D implementation:
 *   v_out = clamp(v + shadows*(1-v)^2 + highlights*v^2, 0, 1)
 *
 * The geq filter requires format=rgb24 for per-channel RGB access, then converts back.
 * This ensures pixel-accurate match between preview and export for shadows/highlights.
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

// ─── Export: per-channel geq expression for shadows/highlights ────────────────

/**
 * Build the per-channel FFmpeg geq expression for shadows/highlights.
 *
 * Matches the preview Canvas 2D formula exactly:
 *   v_out = clamp(v + shadows*(1-v)^2 + highlights*v^2, 0, 1)
 *
 * The channel functions r(X,Y), g(X,Y), b(X,Y) return 0–255 in rgb24 format.
 */
function buildShadowsHighlightsExpr(channel: string, shadows: number, highlights: number): string {
  const s = shadows.toFixed(6);
  const h = highlights.toFixed(6);
  const v = `${channel}(X,Y)/255`;
  return `clip(${v}+${s}*(1-${v})*(1-${v})+${h}*${v}*${v},0,1)*255`;
}

// ─── Export implementation ────────────────────────────────────────────────────

const colorGradeExport: EffectExportApi = {
  isActive(clip: Clip, track: Track, context: ExportFilterContext): boolean {
    return !!(getOverlappingEffectConfig(context.project, track, 'colorGrade', clip)?.enabled);
  },

  /**
   * Builds the FFmpeg filter chain for color grading.
   *
   * Chains up to three filters in sequence (each only added when non-default):
   *   1. eq=contrast:brightness:saturation  — basic color adjustments
   *   2. hue=h=<degrees>                   — hue rotation
   *   3. format=rgb24,geq=r/g/b,format=yuv420p — shadows/highlights
   *
   * The shadows/highlights step converts to RGB, applies the quadratic formula
   * (identical to the preview Canvas 2D path), then converts back to yuv420p.
   *
   * When this effect doesn't look right in export:
   *   → Every ColorGrade parameter is handled here — no need to look elsewhere.
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
    const shadows = cfg.shadows ?? 0;
    const highlights = cfg.highlights ?? 0;

    const filters: string[] = [];
    let pad = inputPad;
    let nodeIdx = 0;

    // ── Step 1: eq (contrast, brightness, saturation) ──────────────────────────
    const eqParts: string[] = [];
    if (contrast !== 1) eqParts.push(`contrast=${contrast.toFixed(4)}`);
    if (brightness !== 1) eqParts.push(`brightness=${(brightness - 1).toFixed(4)}`);
    if (colorSaturation !== 1) eqParts.push(`saturation=${colorSaturation.toFixed(4)}`);

    if (eqParts.length > 0) {
      const outPad = `cg${nodeIdx}_${filterIdx}`;
      filters.push(`[${pad}]eq=${eqParts.join(':')}[${outPad}]`);
      pad = outPad;
      nodeIdx++;
    }

    // ── Step 2: hue rotation ──────────────────────────────────────────────────
    if (hue !== 0) {
      const outPad = `cg${nodeIdx}_${filterIdx}`;
      filters.push(`[${pad}]hue=h=${hue.toFixed(2)}[${outPad}]`);
      pad = outPad;
      nodeIdx++;
    }

    // ── Step 3: shadows/highlights via geq ────────────────────────────────────
    // Converts to RGB for per-channel access, applies the formula, converts back.
    // Formula: v_out = clamp(v + shadows*(1-v)^2 + highlights*v^2, 0, 1)
    if (shadows !== 0 || highlights !== 0) {
      const rExpr = buildShadowsHighlightsExpr('r', shadows, highlights);
      const gExpr = buildShadowsHighlightsExpr('g', shadows, highlights);
      const bExpr = buildShadowsHighlightsExpr('b', shadows, highlights);
      const outPad = `cg${nodeIdx}_${filterIdx}`;
      filters.push(
        `[${pad}]format=rgb24,` +
        `geq=r='${rExpr}':g='${gExpr}':b='${bExpr}',` +
        `format=yuv420p[${outPad}]`
      );
      pad = outPad;
      nodeIdx++;
    }

    // All params at neutral — passthrough
    if (filters.length === 0) {
      return { filters: [], outputPad: inputPad };
    }

    return { filters, outputPad: pad };
  },
};

// ─── Effect Definition (exported) ─────────────────────────────────────────────

export const ColorGradeEffect: EffectDefinition = {
  type: 'colorGrade',
  preview: colorGradePreview,
  export: colorGradeExport,
};
