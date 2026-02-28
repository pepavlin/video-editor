/**
 * Text Clip Element — Unified Preview + Export
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  PREVIEW: Canvas 2D text rendering with font, color, shadow, background  │
 * │  EXPORT:  FFmpeg drawtext filter with matching style properties           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * This is the single source of truth for how text clips are rendered.
 *
 * ## Font size scaling
 * fontSize in TextStyle is relative to a 1920px height reference.
 * Both preview and export scale proportionally: fontSize * (H / 1920) * scale.
 * At the default output H=1920, this equals fontSize * scale.
 *
 * ## Position
 * Text is centered (x=W/2, y=H/2) with transform.x/y offsets applied.
 * Preview uses ctx.textAlign='center' + transform offset.
 * Export uses FFmpeg drawtext x=(w-text_w)/2+offset, y=(h-text_h)/2+offset.
 *
 * ## Known limitations
 * - Font availability: export uses system fonts via drawtext `font=` option.
 *   The font must be installed on the export server to match the preview exactly.
 * - Bold/italic: export uses drawtext style string; visually matches for common fonts.
 * - Background box: preview draws a filled rect; export uses drawbox (approximate match).
 * - Rotation: preview applies canvas transform; export applies rotate filter.
 *
 * ## When text doesn't show in export:
 *   → Look at TextClip.export below (this file)
 *
 * ## When text looks different between preview and export:
 *   → Compare TextClip.preview and TextClip.export in this file
 */

import type { Clip, Track, Transform, TextStyle } from '@video-editor/shared';
import type {
  ClipElementDefinition,
  ClipPreviewApi,
  ClipExportApi,
  ClipFilterResult,
  Bounds,
  PreviewRenderContextWithAssets,
  ExportFilterContext,
} from '../types';

// ─── Shared defaults ──────────────────────────────────────────────────────────

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Arial',
  fontSize: 96,
  color: '#ffffff',
  bold: true,
  italic: false,
  align: 'center',
};

// ─── Shared: bounds calculation ───────────────────────────────────────────────

export function getTextBounds(
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
  const pad = Math.max(16, fontSize * 0.3);
  return { x: cx - tw / 2 - pad, y: cy - th / 2 - pad, w: tw + pad * 2, h: th + pad * 2 };
}

// ─── Shared: color conversion for FFmpeg ─────────────────────────────────────

function hexToFFmpegColor(hex: string): string {
  // FFmpeg accepts colors as 0xRRGGBB or named colors
  const clean = hex.replace('#', '');
  if (clean.length === 6) return `0x${clean}`;
  if (clean.length === 3) {
    // Expand #RGB to #RRGGBB
    return `0x${clean[0]}${clean[0]}${clean[1]}${clean[1]}${clean[2]}${clean[2]}`;
  }
  return '0xffffff';
}

function escapeDrawtextString(text: string): string {
  // FFmpeg drawtext text escaping: escape \, ', :, and newlines
  return text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/:/g, '\\:')
    .replace(/\n/g, '\\n');
}

// ─── Preview implementation ───────────────────────────────────────────────────

const textClipPreview: ClipPreviewApi = {
  render(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    _track: Track,
    transform: Transform,
    context: PreviewRenderContextWithAssets
  ): void {
    // Skip rendering when clip is being edited inline (textarea shows it instead)
    if (clip.id === context.editingClipId) return;

    const style = clip.textStyle ?? DEFAULT_TEXT_STYLE;
    const fontSize = Math.round((style.fontSize / 1920) * context.H * transform.scale);
    const font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${fontSize}px ${style.fontFamily}`;
    const text = clip.textContent ?? 'Text';
    const cx = context.W / 2 + transform.x;
    const cy = context.H / 2 + transform.y;

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

    // Optional background box
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

    // Text shadow for readability
    ctx.shadowColor = 'rgba(0,0,0,0.7)';
    ctx.shadowBlur = 6;
    ctx.fillStyle = style.color;
    ctx.fillText(text, cx, cy);

    ctx.restore();
  },

  getBounds(
    clip: Clip,
    _track: Track,
    transform: Transform,
    context: { W: number; H: number; ctx: CanvasRenderingContext2D }
  ): Bounds {
    return getTextBounds(clip, transform, context.ctx, context.W, context.H);
  },
};

// ─── Export implementation ────────────────────────────────────────────────────

const textClipExport: ClipExportApi = {
  buildFilter(
    prevPad: string,
    clip: Clip,
    _track: Track,
    filterIdx: number,
    context: ExportFilterContext
  ): ClipFilterResult | null {
    if (!clip.textContent) return null;

    const { W, H } = context;
    const transform = clip.transform ?? { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 };
    const style = clip.textStyle ?? DEFAULT_TEXT_STYLE;

    // Font size: same formula as preview, using output H
    const fontSize = Math.round((style.fontSize / 1920) * H * Math.max(0.01, transform.scale));

    // Escape text for FFmpeg drawtext
    const escapedText = escapeDrawtextString(clip.textContent);

    // Position: center with transform offset
    const tx = Math.round(transform.x);
    const ty = Math.round(transform.y);
    const xExpr = `(w-text_w)/2+${tx}`;
    const yExpr = `(h-text_h)/2+${ty}`;

    const fontColor = hexToFFmpegColor(style.color);
    const alpha = Math.max(0, Math.min(1, transform.opacity));

    const delay = clip.timelineStart;
    const duration = clip.timelineEnd - clip.timelineStart;
    const enableExpr = `between(t,${delay.toFixed(4)},${(delay + duration).toFixed(4)})`;

    // Build font style string for drawtext
    // FFmpeg drawtext uses fontstyle option: "Bold", "Italic", "Bold Italic"
    const fontStyle = [style.bold && 'Bold', style.italic && 'Italic'].filter(Boolean).join(' ');

    const outPad = `txt${filterIdx}`;
    const allFilters: string[] = [];

    // ── Optional background box ───────────────────────────────────────────────
    // Drawn as a separate drawbox filter BEFORE drawtext so text renders on top.
    let currentPad = prevPad;
    if (style.background) {
      const bgColor = hexToFFmpegColor(style.background);
      const bgAlpha = style.backgroundOpacity ?? 0.65;
      const padX = Math.round(fontSize * 0.3);
      const padY = Math.round(fontSize * 0.2);
      const bgPad = `txbg${filterIdx}`;
      // drawbox with fill: x/y/w/h use drawtext-like expressions
      // We approximate the box size since we don't know exact text_w at filter-build time.
      // Use a fixed-width estimate: fontSize * charCount * 0.6 is a rough approximation.
      const estTextW = Math.round(clip.textContent.length * fontSize * 0.6);
      const boxX = `(w-${estTextW + padX * 2})/2+${tx}`;
      const boxY = `(h-${fontSize + padY * 2})/2+${ty}`;
      allFilters.push(
        `[${currentPad}]drawbox=x=${boxX}:y=${boxY}:w=${estTextW + padX * 2}:h=${fontSize + padY * 2}:color=${bgColor}@${bgAlpha.toFixed(2)}:t=fill:enable='${enableExpr}'[${bgPad}]`
      );
      currentPad = bgPad;
    }

    // ── Drawtext filter ───────────────────────────────────────────────────────
    const drawtextOptions: string[] = [
      `text='${escapedText}'`,
      `x=${xExpr}`,
      `y=${yExpr}`,
      `fontsize=${fontSize}`,
      `fontcolor=${fontColor}@${alpha.toFixed(3)}`,
      `shadowcolor=black@0.7`,
      `shadowx=2`,
      `shadowy=2`,
      `enable='${enableExpr}'`,
    ];

    if (style.fontFamily && style.fontFamily !== 'Arial') {
      drawtextOptions.push(`font='${style.fontFamily}'`);
    }
    if (fontStyle) {
      drawtextOptions.push(`fontstyle='${fontStyle}'`);
    }

    // Apply rotation if needed — wrap in rotate filter
    if (transform.rotation !== 0 && Math.abs(transform.rotation) > 0.01) {
      const textPad = `txpre${filterIdx}`;
      allFilters.push(
        `[${currentPad}]drawtext=${drawtextOptions.join(':')}[${textPad}]`
      );
      // Note: Rotation applied via the entire frame — text clips with rotation
      // are uncommon, so we apply a full-frame rotate which may crop edges.
      // For precise rotation of just the text layer, a more complex pipeline
      // (render to transparent overlay, rotate overlay, blend) would be needed.
      const rad = (transform.rotation * Math.PI) / 180;
      allFilters.push(
        `[${textPad}]rotate=${rad.toFixed(6)}:fillcolor=none:enable='${enableExpr}'[${outPad}]`
      );
    } else {
      allFilters.push(
        `[${currentPad}]drawtext=${drawtextOptions.join(':')}[${outPad}]`
      );
    }

    return {
      filters: allFilters,
      outputPad: outPad,
      nextFilterIdx: filterIdx + 1,
    };
  },
};

// ─── Unified ClipElementDefinition ───────────────────────────────────────────

/**
 * Unified text clip element definition.
 *
 * Handles all clips with textContent (regardless of track type).
 * Must be registered BEFORE VideoClipElement in CLIP_REGISTRY since text
 * clips can live on video tracks and share the same Clip type.
 *
 * When text clips don't show in export → start here (TextClip.export).
 * When text looks different preview vs export → compare preview vs export in this file.
 */
export const TextClipElement: ClipElementDefinition = {
  clipType: 'text',

  canHandle(clip: Clip, _track: Track): boolean {
    return !!clip.textContent;
  },

  preview: textClipPreview,
  export: textClipExport,
};
