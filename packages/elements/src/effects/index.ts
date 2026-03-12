/**
 * Effect Registry — @video-editor/elements
 *
 * EFFECT_REGISTRY is the ordered list of all video clip effects.
 * Applied within VideoClip rendering in this exact order (both preview and export).
 *
 * Current order and rationale:
 *   1. BeatZoom   — Phase 1 (modifies transform BEFORE bounds computed)
 *   2. Cutout     — Phase 2 first: draws background, returns masked canvas
 *   3. Cartoon    — Phase 2 second: stylizes the (possibly masked) source
 *   4. ColorGrade — Phase 2 last: color correction on top of everything
 *
 * To change the order or add a new effect, modify this array.
 */

import type { EffectDefinition } from '../types';
import { BeatZoomEffect } from './BeatZoom';
import { CutoutEffect } from './Cutout';
import { CartoonEffect } from './Cartoon';
import { ColorGradeEffect } from './ColorGrade';

export { BeatZoomEffect, computeBeatZoomScale } from './BeatZoom';
export { CartoonEffect, processCartoonFrame, processAiStyleFrame } from './Cartoon';
export { ColorGradeEffect, processColorGradeFrame, buildColorGradeCssFilter } from './ColorGrade';
export { CutoutEffect, getOrCreateMaskVideoEl, maskVideoCache, applyCutoutPreview } from './Cutout';

export const EFFECT_REGISTRY: readonly EffectDefinition[] = [
  BeatZoomEffect,
  CutoutEffect,
  CartoonEffect,
  ColorGradeEffect,
];
