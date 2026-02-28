/**
 * Cartoon Effect
 *
 * Stylizes video to look like a cartoon by simplifying colors and adding edge lines.
 *
 * ┌────────────────────────────────────────────────────────────────────┐
 * │  PREVIEW: Canvas 2D — blur + Sobel edge detection + multiply blend │
 * │  EXPORT:  FFmpeg — hqdn3d + edgedetect + blend multiply + eq sat  │
 * └────────────────────────────────────────────────────────────────────┘
 *
 * Both implementations map these config params (from EffectClipConfig):
 *   colorSimplification — 0..1: how much to flatten/blur colors
 *   edgeStrength        — 0..1: prominence of the cartoon edge lines
 *   saturation          — 0..2: color saturation (1 = normal)
 *
 * Implementation note: Preview uses Sobel kernel at half resolution for
 * performance. Export uses FFmpeg's edgedetect filter which produces similar
 * results via Canny. Both use multiply blend mode to darken edges on the base.
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

// ─── Preview: core cartoon processing ─────────────────────────────────────────

/**
 * Process a source image through the cartoon pipeline and return the result canvas.
 * Accepts any EffectSource so it can chain after Cutout or other effects.
 * Returns null if the offscreen context cannot be obtained (extremely rare).
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
  const blurPx = colorSimplification * 5;

  // 1. Color-simplified base: blur + saturation boost
  baseCtx.clearRect(0, 0, iw, ih);
  baseCtx.filter = blurPx > 0.1
    ? `blur(${blurPx.toFixed(1)}px) saturate(${saturation.toFixed(2)})`
    : `saturate(${saturation.toFixed(2)})`;
  baseCtx.drawImage(source, 0, 0, iw, ih);
  baseCtx.filter = 'none';

  // 2. Edge detection at half resolution (Sobel kernel)
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

    const rawThreshold = (1 - edgeStrengthVal) * 200;

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
            edgeVal = Math.max(0, 255 - (mag - rawThreshold) * edgeStrengthVal * 4);
          }
        }
        const idx = (y * ew + x) * 4;
        dst[idx] = dst[idx + 1] = dst[idx + 2] = Math.round(edgeVal);
        dst[idx + 3] = 255;
      }
    }
    edgeCtx.putImageData(edgeImageData, 0, 0);

    // 3. Multiply edges onto the base (darkens edges, creates cartoon lines)
    baseCtx.save();
    baseCtx.globalCompositeOperation = 'multiply';
    baseCtx.drawImage(edge, 0, 0, ew, eh, 0, 0, iw, ih);
    baseCtx.restore();
  } catch (err) {
    console.warn('[CartoonEffect] Edge detection failed (falling back to blur/saturation):', err);
  }

  return base;
}

// ─── Preview implementation ───────────────────────────────────────────────────

const cartoonPreview: EffectPreviewApi = {
  isActive(clip: Clip, track: Track, context: PreviewRenderContextWithAssets): boolean {
    const cfg = getActiveEffectConfig(context.project, track, 'cartoon', context.currentTime);
    return !!(cfg?.enabled);
  },

  /**
   * Phase 2: Apply cartoon stylization to the source image.
   * Returns the cartoon-processed canvas for chaining with subsequent effects.
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
    return processCartoonFrame(source, bounds, cfg);
  },
};

// ─── Export implementation ────────────────────────────────────────────────────

const cartoonExport: EffectExportApi = {
  isActive(clip: Clip, track: Track, context: ExportFilterContext): boolean {
    return !!(getOverlappingEffectConfig(context.project, track, 'cartoon', clip)?.enabled);
  },

  /**
   * Builds an FFmpeg filter chain that approximates the cartoon look:
   *   split → [hqdn3d blur + eq saturate] + [edgedetect] → blend multiply
   *
   * Maps to preview params:
   *   colorSimplification → hqdn3d spatial/temporal strength
   *   edgeStrength        → edgedetect low/high thresholds
   *   saturation          → eq saturation
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

    const cs = cfg.colorSimplification ?? 0.5;
    const es = cfg.edgeStrength ?? 0.6;
    const sat = Math.max(0, Math.min(3, cfg.saturation ?? 1.5)).toFixed(2);

    // hqdn3d: luma_spatial, chroma_spatial, luma_tmp, chroma_tmp
    const ls = (1 + cs * 8).toFixed(1);
    const chs = (1 + cs * 6).toFixed(1);
    const lt = (2 + cs * 6).toFixed(1);
    const ct = (2 + cs * 6).toFixed(1);

    // edgedetect thresholds
    const edgeLow = (es * 0.06).toFixed(3);
    const edgeHigh = (0.05 + es * 0.20).toFixed(3);

    const split1 = `czs1_${filterIdx}`;
    const split2 = `czs2_${filterIdx}`;
    const blur = `czb_${filterIdx}`;
    const edge = `cze_${filterIdx}`;
    const blend = `czbd_${filterIdx}`;
    const out = `cz_${filterIdx}`;

    return {
      filters: [
        `[${inputPad}]split[${split1}][${split2}]`,
        `[${split1}]hqdn3d=${ls}:${chs}:${lt}:${ct}[${blur}]`,
        `[${split2}]edgedetect=low=${edgeLow}:high=${edgeHigh}:mode=colormix[${edge}]`,
        `[${blur}][${edge}]blend=all_mode=multiply[${blend}]`,
        `[${blend}]eq=saturation=${sat}[${out}]`,
      ],
      outputPad: out,
    };
  },
};

// ─── Effect Definition (exported) ─────────────────────────────────────────────

export const CartoonEffect: EffectDefinition = {
  type: 'cartoon',
  preview: cartoonPreview,
  export: cartoonExport,
};
