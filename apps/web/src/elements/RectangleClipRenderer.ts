/**
 * Rectangle Clip Renderer — Re-export shim
 *
 * The RectangleClip implementation has moved to the unified elements package:
 *   packages/elements/src/clips/RectangleClip.ts
 *
 * This file re-exports everything from there so existing imports still work.
 * The PreviewPipeline now uses CLIP_REGISTRY directly and no longer imports
 * RectangleClipRenderer, but other files may use the exported utilities.
 *
 * @see packages/elements/src/clips/RectangleClip.ts for the actual implementation
 */

export {
  getRectangleBounds,
  RectangleClipElement as RectangleClipRenderer,
} from '@video-editor/elements';
