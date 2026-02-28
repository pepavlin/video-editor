/**
 * Rectangle Clip Element — Unified Preview + Export
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  PREVIEW: Canvas 2D path with fill, border, border radius, rotation      │
 * │  EXPORT:  FFmpeg drawbox filter (fill + border, rounded corners approx.) │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * This is the single source of truth for how rectangle clips are rendered.
 *
 * ## Dimension scaling
 * Rectangle dimensions in RectangleStyle are relative to a 1920px height reference.
 * Both preview and export scale proportionally: dimension * (H / 1920) * scale.
 *
 * ## Known limitations
 * - Border radius (rounded corners): Canvas 2D supports arcs natively.
 *   FFmpeg drawbox does not support rounded corners — export will use sharp corners.
 *   Consider using a PNG overlay approach for rounded corners if needed in the future.
 * - Rotation: preview applies canvas transform; export applies rotate filter to full frame.
 *
 * ## When rectangles don't show in export:
 *   → Look at RectangleClip.export below (this file)
 *
 * ## When rectangles look different between preview and export:
 *   → Compare RectangleClip.preview and RectangleClip.export in this file
 */

import type { Clip, Track, Transform, RectangleStyle } from '@video-editor/shared';
import type {
  ClipElementDefinition,
  ClipPreviewApi,
  ClipExportApi,
  ClipFilterResult,
  Bounds,
  PreviewRenderContextWithAssets,
  ExportFilterContext,
} from '../types';

// ─── Shared: bounds calculation ───────────────────────────────────────────────

export function getRectangleBounds(
  clip: Clip,
  transform: Transform,
  W: number,
  H: number
): Bounds {
  const style = clip.rectangleStyle as RectangleStyle;
  const scale = transform.scale * (H / 1920);
  const rw = style.width * scale;
  const rh = style.height * scale;
  const cx = W / 2 + transform.x;
  const cy = H / 2 + transform.y;
  return { x: cx - rw / 2, y: cy - rh / 2, w: rw, h: rh };
}

// ─── Shared: color conversion for FFmpeg ─────────────────────────────────────

function hexToFFmpegColor(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length === 6) return `0x${clean}`;
  if (clean.length === 3) {
    return `0x${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`;
  }
  return '0x000000';
}

// ─── Preview implementation ───────────────────────────────────────────────────

const rectangleClipPreview: ClipPreviewApi = {
  render(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    _track: Track,
    transform: Transform,
    context: PreviewRenderContextWithAssets
  ): void {
    const style = clip.rectangleStyle as RectangleStyle;
    const scale = transform.scale * (context.H / 1920);
    const rw = style.width * scale;
    const rh = style.height * scale;
    const cx = context.W / 2 + transform.x;
    const cy = context.H / 2 + transform.y;
    const rx = cx - rw / 2;
    const ry = cy - rh / 2;
    const radius = (style.borderRadius ?? 0) * scale;

    ctx.save();
    ctx.globalAlpha = transform.opacity * (style.fillOpacity ?? 1);

    if (transform.rotation !== 0) {
      ctx.translate(cx, cy);
      ctx.rotate((transform.rotation * Math.PI) / 180);
      ctx.translate(-cx, -cy);
    }

    // Draw rounded rect (or regular rect if radius=0)
    ctx.beginPath();
    if (radius > 0) {
      ctx.moveTo(rx + radius, ry);
      ctx.lineTo(rx + rw - radius, ry);
      ctx.arcTo(rx + rw, ry, rx + rw, ry + radius, radius);
      ctx.lineTo(rx + rw, ry + rh - radius);
      ctx.arcTo(rx + rw, ry + rh, rx + rw - radius, ry + rh, radius);
      ctx.lineTo(rx + radius, ry + rh);
      ctx.arcTo(rx, ry + rh, rx, ry + rh - radius, radius);
      ctx.lineTo(rx, ry + radius);
      ctx.arcTo(rx, ry, rx + radius, ry, radius);
      ctx.closePath();
    } else {
      ctx.rect(rx, ry, rw, rh);
    }
    ctx.fillStyle = style.color;
    ctx.fill();

    // Optional border
    if (style.borderColor && style.borderWidth && style.borderWidth > 0) {
      ctx.globalAlpha = transform.opacity;
      ctx.strokeStyle = style.borderColor;
      ctx.lineWidth = style.borderWidth * scale;
      ctx.stroke();
    }

    ctx.restore();
  },

  getBounds(
    clip: Clip,
    _track: Track,
    transform: Transform,
    context: { W: number; H: number; ctx: CanvasRenderingContext2D }
  ): Bounds {
    return getRectangleBounds(clip, transform, context.W, context.H);
  },
};

// ─── Export implementation ────────────────────────────────────────────────────

const rectangleClipExport: ClipExportApi = {
  buildFilter(
    prevPad: string,
    clip: Clip,
    _track: Track,
    filterIdx: number,
    context: ExportFilterContext
  ): ClipFilterResult | null {
    if (!clip.rectangleStyle) return null;

    const { W, H } = context;
    const style = clip.rectangleStyle as RectangleStyle;
    const transform = clip.transform ?? { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 };

    const scale = transform.scale * (H / 1920);
    const rw = Math.round(style.width * scale);
    const rh = Math.round(style.height * scale);
    const cx = W / 2 + transform.x;
    const cy = H / 2 + transform.y;
    const rx = Math.round(cx - rw / 2);
    const ry = Math.round(cy - rh / 2);

    const fillOpacity = (style.fillOpacity ?? 1) * transform.opacity;
    const fillColor = hexToFFmpegColor(style.color);

    const delay = clip.timelineStart;
    const duration = clip.timelineEnd - clip.timelineStart;
    const enableExpr = `between(t,${delay.toFixed(4)},${(delay + duration).toFixed(4)})`;

    // Determine which optional steps are needed upfront so pad names can be set correctly
    const hasBorder = !!(style.borderColor && style.borderWidth && style.borderWidth > 0);
    const hasRotation = transform.rotation !== 0 && Math.abs(transform.rotation) > 0.01;

    const allFilters: string[] = [];
    let currentPad = prevPad;

    // ── Fill rectangle ────────────────────────────────────────────────────────
    // Note: FFmpeg drawbox does NOT support border-radius (rounded corners).
    // Rounded corners are visible in preview but will appear as sharp corners in export.
    // For rounded corner support in export, a PNG overlay approach would be needed.
    const fillPad = hasBorder || hasRotation ? `rect_f${filterIdx}` : `recto${filterIdx}`;
    allFilters.push(
      `[${currentPad}]drawbox=x=${rx}:y=${ry}:w=${rw}:h=${rh}:color=${fillColor}@${fillOpacity.toFixed(3)}:t=fill:enable='${enableExpr}'[${fillPad}]`
    );
    currentPad = fillPad;

    // ── Optional border ───────────────────────────────────────────────────────
    if (hasBorder) {
      const borderWidth = Math.max(1, Math.round(style.borderWidth! * scale));
      const borderColor = hexToFFmpegColor(style.borderColor!);
      const borderPad = hasRotation ? `rect_b${filterIdx}` : `recto${filterIdx}`;
      allFilters.push(
        `[${currentPad}]drawbox=x=${rx}:y=${ry}:w=${rw}:h=${rh}:color=${borderColor}@${transform.opacity.toFixed(3)}:t=${borderWidth}:enable='${enableExpr}'[${borderPad}]`
      );
      currentPad = borderPad;
    }

    // ── Optional rotation ─────────────────────────────────────────────────────
    if (hasRotation) {
      const rad = (transform.rotation * Math.PI) / 180;
      allFilters.push(
        `[${currentPad}]rotate=${rad.toFixed(6)}:fillcolor=none:enable='${enableExpr}'[recto${filterIdx}]`
      );
    }

    return {
      filters: allFilters,
      outputPad: `recto${filterIdx}`,
      nextFilterIdx: filterIdx + 1,
    };
  },
};

// ─── Unified ClipElementDefinition ───────────────────────────────────────────

/**
 * Unified rectangle clip element definition.
 *
 * Handles all clips with rectangleStyle set.
 * Must be registered BEFORE VideoClipElement in CLIP_REGISTRY since rectangle
 * clips can live on video tracks and share the same Clip type.
 *
 * When rectangle clips don't show in export → start here (RectangleClip.export).
 * When rectangles look different preview vs export → compare preview vs export in this file.
 */
export const RectangleClipElement: ClipElementDefinition = {
  clipType: 'rectangle',

  canHandle(clip: Clip, _track: Track): boolean {
    return !!clip.rectangleStyle;
  },

  preview: rectangleClipPreview,
  export: rectangleClipExport,
};
