/**
 * Cartoon Effect
 *
 * Stylizes video with two modes:
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │  MODE: classic — edge-detection cartoon                                    │
 * │    PREVIEW: Canvas 2D — blur + posterize + Sobel edges + multiply blend   │
 * │    EXPORT:  FFmpeg — smartblur + lutrgb + edgedetect(wires) + negate      │
 * │                       + blend multiply + eq saturation                     │
 * ├────────────────────────────────────────────────────────────────────────────┤
 * │  MODE: aiStyle — painterly stylization (EbSynth-like)                      │
 * │    PREVIEW: Canvas 2D — blur + posterize + warm tones (approximation)      │
 * │    EXPORT:  FFmpeg — blend original with pre-processed AI-stylized video   │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Classic mode params (from EffectClipConfig):
 *   colorSimplification — 0..1: how much to flatten/blur colors
 *   edgeStrength        — 0..1: prominence of the cartoon edge lines
 *   saturation          — 0..2: color saturation (1 = normal)
 *
 * AI Style mode params (from EffectClipConfig):
 *   styleStrength  — 0..1: blend weight between original and stylized
 *   brushSize      — 0..1: controls brush stroke coarseness
 *   colorVibrance  — 0..2: color vibrancy of painterly output
 *
 * The AI-stylized video is pre-computed by scripts/ai_style.py and stored
 * at asset.aiStylePath. During export, the Cartoon effect in aiStyle mode
 * blends the original with the stylized video using FFmpeg's blend filter.
 *
 * Export blending is performed in planar RGB (gbrp) to avoid YUV chroma
 * corruption. See classic mode notes below for details.
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
// Reuse offscreen canvases across frames to avoid GC pressure.

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

// ─── AI Style: preview canvas cache ─────────────────────────────────────────────
let _aiStyleCanvas: HTMLCanvasElement | null = null;

function getAiStyleCanvas(iw: number, ih: number): HTMLCanvasElement {
  if (!_aiStyleCanvas || _aiStyleCanvas.width !== iw || _aiStyleCanvas.height !== ih) {
    _aiStyleCanvas = document.createElement('canvas');
    _aiStyleCanvas.width = iw;
    _aiStyleCanvas.height = ih;
  }
  return _aiStyleCanvas;
}

// ─── Preview: classic cartoon processing ─────────────────────────────────────────

/**
 * Process a source image through the classic cartoon pipeline and return the result canvas.
 * Accepts any EffectSource so it can chain after Cutout or other effects.
 * Returns null if the offscreen context cannot be obtained (extremely rare).
 *
 * Pipeline:
 *   1. Smooth colors with CSS blur (GPU-accelerated bilateral approximation)
 *   2. Posterize: quantize colors to flat levels for a cartoon/cel-shaded look
 *   3. Boost saturation (cartoons are more colorful)
 *   4. Sobel edge detection at half-res for bold black outlines
 *   5. Multiply-blend edges onto the posterized base
 */
export function processCartoonFrame(
  source: EffectSource,
  bounds: Bounds,
  cfg: EffectClipConfig
): HTMLCanvasElement | null {
  const iw = Math.max(2, Math.round(bounds.w));
  const ih = Math.max(2, Math.round(bounds.h));

  const { base, edge, ew, eh } = getCartoonCanvases(iw, ih);
  const baseCtx = base.getContext('2d');
  const edgeCtx = edge.getContext('2d');
  if (!baseCtx || !edgeCtx) return null;

  const colorSimplification = cfg.colorSimplification ?? 0.3;
  const saturation = cfg.saturation ?? 1.4;
  const edgeStrengthVal = cfg.edgeStrength ?? 0.5;
  // Scale blur: 1–8 px based on simplification (enough to flatten gradients)
  const blurPx = 1 + colorSimplification * 7;

  // 1. Color-simplified base: blur (flattens gradients within regions)
  baseCtx.clearRect(0, 0, iw, ih);
  baseCtx.filter = `blur(${blurPx.toFixed(1)}px)`;
  baseCtx.drawImage(source, 0, 0, iw, ih);
  baseCtx.filter = 'none';

  // 2. Posterize + saturate via pixel manipulation
  //    This is the key step that creates the "cartoon" look — flat color regions
  //    instead of smooth gradients.
  try {
    const imgData = baseCtx.getImageData(0, 0, iw, ih);
    const data = imgData.data;
    // Number of color levels: fewer levels = more cartoon-like.
    // Range: 6 levels (heavy simplification) to 32 levels (subtle).
    const levels = Math.max(4, Math.round(32 - colorSimplification * 26));
    const step = 256 / levels;

    // Saturation is applied per-pixel in HSL-like space for accuracy
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];

      // Posterize: quantize each channel to N levels, centering within each step
      r = Math.min(255, Math.floor(r / step) * step + step * 0.5);
      g = Math.min(255, Math.floor(g / step) * step + step * 0.5);
      b = Math.min(255, Math.floor(b / step) * step + step * 0.5);

      // Saturation boost: scale deviation from luminance
      if (saturation !== 1) {
        const lum = 0.299 * r + 0.587 * g + 0.114 * b;
        r = Math.max(0, Math.min(255, lum + (r - lum) * saturation));
        g = Math.max(0, Math.min(255, lum + (g - lum) * saturation));
        b = Math.max(0, Math.min(255, lum + (b - lum) * saturation));
      }

      data[i] = Math.round(r);
      data[i + 1] = Math.round(g);
      data[i + 2] = Math.round(b);
    }
    baseCtx.putImageData(imgData, 0, 0);
  } catch (err) {
    // Fallback: apply saturation via CSS filter if pixel access fails (e.g. tainted canvas)
    console.warn('[CartoonEffect] Posterization failed, applying CSS saturate fallback:', err);
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = iw;
    tmpCanvas.height = ih;
    const tmpCtx = tmpCanvas.getContext('2d');
    if (tmpCtx) {
      tmpCtx.drawImage(base, 0, 0);
      baseCtx.clearRect(0, 0, iw, ih);
      baseCtx.filter = `saturate(${saturation.toFixed(2)})`;
      baseCtx.drawImage(tmpCanvas, 0, 0);
      baseCtx.filter = 'none';
    }
  }

  // 3. Edge detection at half resolution (Sobel kernel) for bold cartoon outlines
  try {
    edgeCtx.clearRect(0, 0, ew, eh);
    edgeCtx.drawImage(source, 0, 0, ew, eh);

    const { data: srcData } = edgeCtx.getImageData(0, 0, ew, eh);
    const edgeImageData = edgeCtx.createImageData(ew, eh);
    const dst = edgeImageData.data;

    // Convert to grayscale
    const gray = new Float32Array(ew * eh);
    for (let i = 0; i < ew * eh; i++) {
      const p = i * 4;
      gray[i] = 0.299 * srcData[p] + 0.587 * srcData[p + 1] + 0.114 * srcData[p + 2];
    }

    // Lower threshold = more edges detected (bolder outlines)
    // Range: edgeStrength=0 → threshold=120 (few edges), edgeStrength=1 → threshold=15 (many edges)
    const rawThreshold = 15 + (1 - edgeStrengthVal) * 105;
    // Transition zone: how quickly edge fades from full black to nothing
    const transitionWidth = rawThreshold * 0.4;

    // Sobel operator
    for (let y = 0; y < eh; y++) {
      for (let x = 0; x < ew; x++) {
        let edgeVal = 255;
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
            // Sharp transition: quickly goes to black for a bold cartoon outline
            const t = Math.min(1, (mag - rawThreshold) / transitionWidth);
            edgeVal = Math.round(255 * (1 - t));
          }
        }
        const idx = (y * ew + x) * 4;
        dst[idx] = dst[idx + 1] = dst[idx + 2] = edgeVal;
        dst[idx + 3] = 255;
      }
    }
    edgeCtx.putImageData(edgeImageData, 0, 0);

    // 4. Multiply edges onto the posterized base (darkens where edges are black → cartoon outlines)
    baseCtx.save();
    baseCtx.globalCompositeOperation = 'multiply';
    baseCtx.drawImage(edge, 0, 0, ew, eh, 0, 0, iw, ih);
    baseCtx.restore();
  } catch (err) {
    console.warn('[CartoonEffect] Edge detection failed (returning posterized base):', err);
  }

  return base;
}

// ─── Preview: AI Style processing (approximation) ─────────────────────────────

/**
 * Process a source image through the AI Style preview pipeline.
 * This is a Canvas 2D approximation of the painterly look — the actual
 * AI-processed video is computed offline by the Python script.
 *
 * Approximation pipeline:
 *   1. Large blur for smooth, flat color regions (simulates bilateral filter)
 *   2. Saturation/vibrance boost for painterly warmth
 *   3. Soft warm tone overlay for "hand-painted" feel
 *   4. Subtle edge darkening via multiply blend
 */
export function processAiStyleFrame(
  source: EffectSource,
  bounds: Bounds,
  cfg: EffectClipConfig
): HTMLCanvasElement | null {
  const iw = Math.max(2, Math.round(bounds.w));
  const ih = Math.max(2, Math.round(bounds.h));

  const canvas = getAiStyleCanvas(iw, ih);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const strength = cfg.styleStrength ?? 0.8;
  const brush = cfg.brushSize ?? 0.5;
  const vibrance = cfg.colorVibrance ?? 1.3;

  // 1. Draw the original
  ctx.clearRect(0, 0, iw, ih);
  ctx.drawImage(source, 0, 0, iw, ih);

  // Get original image data (for blending at the end)
  const originalData = ctx.getImageData(0, 0, iw, ih);

  // 2. Apply blur for flat color regions (simulates bilateral filter)
  const blurPx = 2 + brush * 6; // 2–8 px blur
  ctx.clearRect(0, 0, iw, ih);
  ctx.filter = `blur(${blurPx.toFixed(1)}px) saturate(${vibrance.toFixed(2)})`;
  ctx.drawImage(source, 0, 0, iw, ih);
  ctx.filter = 'none';

  // 3. Apply warm-tone overlay for painterly warmth
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.08 * strength;
  ctx.fillStyle = '#d4956b'; // warm amber tone
  ctx.fillRect(0, 0, iw, ih);
  ctx.restore();

  // 4. Posterize: reduce color levels for a painted look
  try {
    const imgData = ctx.getImageData(0, 0, iw, ih);
    const data = imgData.data;
    const levels = Math.max(4, Math.round(24 - brush * 16)); // 8–24 levels

    for (let i = 0; i < data.length; i += 4) {
      data[i]     = Math.round(data[i] / (256 / levels)) * (256 / levels);
      data[i + 1] = Math.round(data[i + 1] / (256 / levels)) * (256 / levels);
      data[i + 2] = Math.round(data[i + 2] / (256 / levels)) * (256 / levels);
    }

    // 5. Blend with original based on strength
    const orig = originalData.data;
    for (let i = 0; i < data.length; i += 4) {
      data[i]     = Math.round(data[i] * strength + orig[i] * (1 - strength));
      data[i + 1] = Math.round(data[i + 1] * strength + orig[i + 1] * (1 - strength));
      data[i + 2] = Math.round(data[i + 2] * strength + orig[i + 2] * (1 - strength));
    }

    ctx.putImageData(imgData, 0, 0);
  } catch (err) {
    console.warn('[CartoonEffect/AI Style] Preview processing failed:', err);
  }

  return canvas;
}

// ─── Preview implementation ───────────────────────────────────────────────────

const cartoonPreview: EffectPreviewApi = {
  isActive(clip: Clip, track: Track, context: PreviewRenderContextWithAssets): boolean {
    const cfg = getActiveEffectConfig(context.project, track, 'cartoon', context.currentTime);
    return !!(cfg?.enabled);
  },

  /**
   * Phase 2: Apply cartoon stylization to the source image.
   * Dispatches to classic or AI style based on cartoonMode.
   * Returns the processed canvas for chaining with subsequent effects.
   */
  applyRender(
    _ctx: CanvasRenderingContext2D,
    source: EffectSource,
    bounds: Bounds,
    clip: Clip,
    track: Track,
    context: PreviewRenderContextWithAssets
  ): EffectSource | null {
    const cfg = getActiveEffectConfig(context.project, track, 'cartoon', context.currentTime);
    if (!cfg) return null;

    if (cfg.cartoonMode === 'aiStyle') {
      return processAiStyleFrame(source, bounds, cfg);
    }
    return processCartoonFrame(source, bounds, cfg);
  },
};

// ─── Export: classic cartoon filter chain builder ────────────────────────────────

/**
 * Builds FFmpeg filter chain for classic cartoon effect.
 *
 * Pipeline:
 *   [input] → split → [path A: smooth + posterize (lutrgb)] → format=gbrp
 *                    → [path B: edgedetect(wires) + negate] → format=gbrp
 *             → blend=multiply (dark outlines on posterized colors)
 *             → format=yuv420p → eq=saturation
 *
 * Key design decisions:
 * - smartblur for edge-preserving smoothing (better than hqdn3d which is a denoiser)
 * - lutrgb for color quantization/posterization (the essential cartoon look)
 * - edgedetect mode=wires + negate → black edges on white background
 *   so multiply blend darkens exactly where edges are (cartoon outlines)
 * - Blending in gbrp (planar RGB) avoids YUV chroma corruption artifacts
 */
function buildClassicFilter(
  inputPad: string,
  cfg: EffectClipConfig,
  filterIdx: number,
): EffectFilterResult {
  const cs = cfg.colorSimplification ?? 0.5;
  const es = cfg.edgeStrength ?? 0.6;
  const sat = Math.max(0, Math.min(3, cfg.saturation ?? 1.5)).toFixed(2);

  // smartblur: edge-adaptive blur (flattens gradients while keeping edges)
  // lr=1.5–5.0 based on color simplification
  const blurRadius = (1.5 + cs * 3.5).toFixed(2);
  // ls=0.5–1.0: positive = blur (not sharpen)
  const blurStrength = (0.5 + cs * 0.5).toFixed(2);

  // lutrgb: color posterization — quantize each channel to N levels
  // step=10 (many levels, subtle) to step=48 (few levels, heavy cartoon)
  const lutStep = Math.max(8, Math.round(10 + cs * 38));
  // Center each quantized value in its bucket for better color reproduction
  const halfStep = Math.round(lutStep / 2);
  const lutExpr = `'clip(trunc(val/${lutStep})*${lutStep}+${halfStep},0,255)'`;

  // edgedetect: mode=wires produces white edges on black background
  // After negate: black edges on white → multiply darkens where edges are
  const edgeLow = (0.02 + es * 0.08).toFixed(3);   // 0.02–0.10
  const edgeHigh = (0.05 + es * 0.25).toFixed(3);   // 0.05–0.30

  const split1 = `czs1_${filterIdx}`;
  const split2 = `czs2_${filterIdx}`;
  const flatRgb = `czf_rgb_${filterIdx}`;
  const edgeRgb = `cze_rgb_${filterIdx}`;
  const blendYuv = `czbd_${filterIdx}`;
  const out = `cz_${filterIdx}`;

  return {
    filters: [
      `[${inputPad}]split[${split1}][${split2}]`,
      // Path A: smooth + posterize → flat cartoon colors
      `[${split1}]smartblur=lr=${blurRadius}:ls=${blurStrength}:cr=${blurRadius}:cs=${blurStrength},lutrgb=r=${lutExpr}:g=${lutExpr}:b=${lutExpr},format=gbrp[${flatRgb}]`,
      // Path B: edge detection → black outlines on white
      `[${split2}]edgedetect=low=${edgeLow}:high=${edgeHigh}:mode=wires,negate,format=gbrp[${edgeRgb}]`,
      // Multiply: where edges are black (0), result is black (dark outlines);
      //           where edges are white (255), posterized colors are preserved
      `[${flatRgb}][${edgeRgb}]blend=all_mode=multiply,format=yuv420p[${blendYuv}]`,
      `[${blendYuv}]eq=saturation=${sat}[${out}]`,
    ],
    outputPad: out,
  };
}

// ─── Export: AI style filter chain builder ────────────────────────────────────────

/**
 * Builds FFmpeg filter for AI style mode.
 * Blends the original video with the pre-processed AI-stylized video using:
 *   [original][stylized] → blend with configurable strength
 *
 * When no stylized video is available (not yet processed), falls back to an
 * FFmpeg-based approximation using smartblur + eq for a painterly look.
 */
function buildAiStyleFilter(
  inputPad: string,
  cfg: EffectClipConfig,
  clip: Clip,
  filterIdx: number,
  context: ExportFilterContext,
): EffectFilterResult {
  const strength = cfg.styleStrength ?? 0.8;
  const vibrance = cfg.colorVibrance ?? 1.3;
  const brush = cfg.brushSize ?? 0.5;
  const out = `cz_${filterIdx}`;

  // Check if we have a pre-processed AI style video
  const aiStyleIdx = context.assetAiStyleInputIdxMap?.get(clip.assetId);
  if (aiStyleIdx !== undefined) {
    // Use pre-processed stylized video: blend [original] with [stylized]
    const styledTrimmed = `aist_${filterIdx}`;
    const styledScaled = `aiss_${filterIdx}`;

    // Trim and scale the stylized video to match the clip
    const trimFilter = `trim=start=${clip.sourceStart.toFixed(4)}:end=${clip.sourceEnd.toFixed(4)},setpts=PTS-STARTPTS+${clip.timelineStart.toFixed(4)}/TB`;

    return {
      filters: [
        `[${aiStyleIdx}:v]${trimFilter}[${styledTrimmed}]`,
        // Scale stylized to match input dimensions and format
        `[${styledTrimmed}]scale=iw:ih,format=yuv420p[${styledScaled}]`,
        // Blend: strength=1 → full stylized, strength=0 → full original
        `[${inputPad}][${styledScaled}]blend=all_expr='A*(1-${strength.toFixed(3)})+B*${strength.toFixed(3)}'[${out}]`,
      ],
      outputPad: out,
    };
  }

  // Fallback: FFmpeg-based painterly approximation (no pre-processed video)
  // Uses smartblur + hue saturation shift + eq for a quick painterly look
  const blurStr = (1.0 + brush * 3.0).toFixed(2);  // 1.0–4.0 luma radius
  const sat = Math.max(0, Math.min(3, vibrance)).toFixed(2);
  const approxPad = `czap_${filterIdx}`;
  const blendedPad = `czab_${filterIdx}`;

  // Strength = 1.0 means full effect, 0.0 means passthrough
  if (strength < 0.01) {
    return { filters: [], outputPad: inputPad };
  }

  return {
    filters: [
      `[${inputPad}]split[czao_${filterIdx}][czas_${filterIdx}]`,
      `[czas_${filterIdx}]smartblur=lr=${blurStr}:ls=1.0:cr=${blurStr}:cs=1.0,eq=saturation=${sat}[${approxPad}]`,
      `[czao_${filterIdx}][${approxPad}]blend=all_expr='A*(1-${strength.toFixed(3)})+B*${strength.toFixed(3)}'[${out}]`,
    ],
    outputPad: out,
  };
}

// ─── Export implementation ────────────────────────────────────────────────────

const cartoonExport: EffectExportApi = {
  isActive(clip: Clip, track: Track, context: ExportFilterContext): boolean {
    return !!(getOverlappingEffectConfig(context.project, track, 'cartoon', clip)?.enabled);
  },

  /**
   * Builds FFmpeg filter chain for cartoon effect.
   * Dispatches to classic or AI style based on cartoonMode.
   */
  buildFilter(
    inputPad: string,
    clip: Clip,
    track: Track,
    filterIdx: number,
    context: ExportFilterContext
  ): EffectFilterResult | null {
    const cfg = getOverlappingEffectConfig(context.project, track, 'cartoon', clip);
    if (!cfg) return null;

    if (cfg.cartoonMode === 'aiStyle') {
      return buildAiStyleFilter(inputPad, cfg, clip, filterIdx, context);
    }
    return buildClassicFilter(inputPad, cfg, filterIdx);
  },
};

// ─── Effect Definition (exported) ─────────────────────────────────────────────

export const CartoonEffect: EffectDefinition = {
  type: 'cartoon',
  preview: cartoonPreview,
  export: cartoonExport,
};
