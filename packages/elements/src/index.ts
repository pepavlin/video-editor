/**
 * @video-editor/elements — Unified Clip Element + Effect Definitions
 *
 * This package is the single source of truth for ALL visual rendering in the
 * video editor. Each element type and effect lives in ONE file and contains
 * BOTH its preview (Canvas 2D) and export (FFmpeg) implementations.
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## CLIP_REGISTRY (top-level element dispatch)
 *
 * Both pipelines dispatch per-clip rendering via CLIP_REGISTRY:
 *
 *   const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track));
 *   element?.preview.render(ctx, clip, track, transform, context);   // preview
 *   element?.export.buildFilter(prevPad, clip, track, idx, context); // export
 *
 * Registry entries (in match priority order):
 *   1. RectangleClipElement → packages/elements/src/clips/RectangleClip.ts
 *   2. TextClipElement      → packages/elements/src/clips/TextClip.ts
 *   3. LyricsClipElement    → packages/elements/src/clips/LyricsClip.ts
 *   4. VideoClipElement     → packages/elements/src/clips/VideoClip.ts
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## EFFECT_REGISTRY (sub-registry for VideoClip effects)
 *
 * Applied within VideoClip rendering only.
 * ORDER MATTERS — effects are applied in this sequence:
 *
 *   1. BeatZoom   — modifies transform scale before rendering (Phase 1)
 *   2. Cutout     — composites background + masked subject (Phase 2)
 *   3. Cartoon    — edge detection + color simplification (Phase 2)
 *   4. ColorGrade — contrast/brightness/saturation/hue (Phase 2)
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## When something doesn't work
 *
 *   Element not visible in preview:
 *     → Find element by clipType in CLIP_REGISTRY → open its file → preview property
 *
 *   Element not visible in export:
 *     → Find element by clipType in CLIP_REGISTRY → open its file → export property
 *
 *   Effect not visible in preview:
 *     → Open packages/elements/src/effects/<EffectName>.ts → preview property
 *
 *   Effect not visible in export:
 *     → Open packages/elements/src/effects/<EffectName>.ts → export property
 *
 *   Wrong rendering order:
 *     → CLIP_REGISTRY in packages/elements/src/clips/index.ts
 *     → EFFECT_REGISTRY in this file
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ## Adding a new element type
 *   1. Create packages/elements/src/clips/MyElement.ts
 *   2. Implement ClipElementDefinition (both preview and export sides)
 *   3. Add it to CLIP_REGISTRY in packages/elements/src/clips/index.ts
 *   4. Done — no changes needed in apps/web or apps/api pipeline files
 *
 * ## Adding a new effect (applies to video clips only)
 *   1. Create packages/elements/src/effects/MyEffect.ts
 *   2. Implement EffectDefinition (both preview and export sides)
 *   3. Add it to EFFECT_REGISTRY below in the correct position
 *   4. Done — no changes needed anywhere else
 */

// ─── Type exports ─────────────────────────────────────────────────────────────

export type {
  // Clip element system
  ClipElementDefinition,
  ClipPreviewApi,
  ClipExportApi,
  ClipFilterResult,
  // Effect system
  EffectDefinition,
  EffectPreviewApi,
  EffectExportApi,
  EffectFilterResult,
  // Context types
  PreviewRenderContext,
  PreviewRenderContextWithAssets,
  ExportFilterContext,
  // Shared types
  Bounds,
  EffectSource,
} from './types';

// ─── Clip element exports ─────────────────────────────────────────────────────

export { CLIP_REGISTRY } from './clips/index';
export {
  VideoClipElement,
  videoElementCache,
  getOrCreateVideoEl,
  getVideoBounds,
} from './clips/VideoClip';
export {
  TextClipElement,
  DEFAULT_TEXT_STYLE,
  getTextBounds,
} from './clips/TextClip';
export {
  RectangleClipElement,
  getRectangleBounds,
} from './clips/RectangleClip';
export {
  LyricsClipElement,
  drawLyricsWords,
  generateAssContent,
  renderProjectLyricsOverlay,
  buildProjectLyricsFilter,
} from './clips/LyricsClip';

// ─── Effect exports ───────────────────────────────────────────────────────────

export { BeatZoomEffect, computeBeatZoomScale } from './effects/BeatZoom';
export { CartoonEffect, processCartoonFrame } from './effects/Cartoon';
export { ColorGradeEffect, processColorGradeFrame, buildColorGradeCssFilter } from './effects/ColorGrade';
export { CutoutEffect, getOrCreateMaskVideoEl, maskVideoCache, applyCutoutPreview } from './effects/Cutout';

// ─── EFFECT_REGISTRY ──────────────────────────────────────────────────────────

import type { EffectDefinition } from './types';
import { BeatZoomEffect } from './effects/BeatZoom';
import { CutoutEffect } from './effects/Cutout';
import { CartoonEffect } from './effects/Cartoon';
import { ColorGradeEffect } from './effects/ColorGrade';

/**
 * Ordered registry of all video clip effects.
 *
 * Applied within VideoClip rendering in this exact order (both preview and export).
 * To change the order or add a new effect, modify this array.
 *
 * Current order and rationale:
 *   1. BeatZoom   — Phase 1 (modifies transform BEFORE bounds computed)
 *   2. Cutout     — Phase 2 first: draws background, returns masked canvas
 *   3. Cartoon    — Phase 2 second: stylizes the (possibly masked) source
 *   4. ColorGrade — Phase 2 last: color correction on top of everything
 */
export const EFFECT_REGISTRY: readonly EffectDefinition[] = [
  BeatZoomEffect,
  CutoutEffect,
  CartoonEffect,
  ColorGradeEffect,
];
