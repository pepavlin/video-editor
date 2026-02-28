/**
 * Clip Element Registry — @video-editor/elements
 *
 * CLIP_REGISTRY is the ordered list of all visual element types in the editor.
 * Both the preview pipeline and the export pipeline iterate this registry to
 * dispatch rendering to the correct element handler.
 *
 * ## How the pipelines use CLIP_REGISTRY
 *
 * Preview (PreviewPipeline.ts):
 *   for each clip visible at currentTime:
 *     const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))
 *     element?.preview.render(ctx, clip, track, transform, context)
 *
 * Export (ExportPipeline.ts):
 *   for each clip in the project:
 *     const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))
 *     const result = element?.export.buildFilter(prevPad, clip, track, filterIdx, context)
 *     if (result) { filterParts.push(...result.filters); prevPad = result.outputPad }
 *
 * ## Registry order
 * The FIRST matching element wins. More specific matchers must come before general ones.
 * Example: TextClipElement must come before VideoClipElement because text clips
 * can live on video tracks and both would match via VideoClipElement.canHandle
 * if TextClipElement were not checked first.
 *
 * Current order and rationale:
 *   1. RectangleClipElement — clips with rectangleStyle (most specific check first)
 *   2. TextClipElement      — clips with textContent
 *   3. LyricsClipElement    — clips on lyrics tracks with word timestamps
 *   4. VideoClipElement     — all remaining video track clips (catch-all for video)
 *
 * ## Adding a new element type
 *   1. Create packages/elements/src/clips/MyElement.ts
 *   2. Implement ClipElementDefinition (both preview and export in one file)
 *   3. Add it to CLIP_REGISTRY below in the correct position
 *   4. Done — no changes needed in apps/web or apps/api pipeline files
 *
 * ## When something doesn't work
 *   Element not visible in preview:
 *     → Find element by clipType below, open its file
 *     → Look at the `preview` property and its render method
 *
 *   Element not visible in export:
 *     → Find element by clipType below, open its file
 *     → Look at the `export` property and its buildFilter method
 *
 *   Wrong element handles a clip:
 *     → Check canHandle() methods — the wrong element matched first
 *     → Adjust the order in CLIP_REGISTRY below
 */

import type { ClipElementDefinition } from '../types';
import { RectangleClipElement } from './RectangleClip';
import { TextClipElement } from './TextClip';
import { LyricsClipElement } from './LyricsClip';
import { VideoClipElement } from './VideoClip';

export { VideoClipElement } from './VideoClip';
export { TextClipElement } from './TextClip';
export { RectangleClipElement } from './RectangleClip';
export { LyricsClipElement } from './LyricsClip';

/**
 * Ordered registry of all visual clip element types.
 *
 * Both preview and export pipelines use this to dispatch per-clip rendering.
 * CLIP_REGISTRY.find(e => e.canHandle(clip, track)) returns the handler.
 */
export const CLIP_REGISTRY: readonly ClipElementDefinition[] = [
  RectangleClipElement, // 1. Most specific: clips with rectangleStyle
  TextClipElement,      // 2. Specific: clips with textContent
  LyricsClipElement,    // 3. Specific: clips on lyrics tracks
  VideoClipElement,     // 4. General: all remaining video track clips
];
