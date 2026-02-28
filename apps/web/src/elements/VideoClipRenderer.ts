/**
 * Video Clip Renderer — Re-export shim
 *
 * The VideoClip implementation has moved to the unified elements package:
 *   packages/elements/src/clips/VideoClip.ts
 *
 * This file re-exports everything from there so existing imports still work.
 * The PreviewPipeline now uses CLIP_REGISTRY directly and no longer imports
 * VideoClipRenderer, but other files (e.g. Preview.tsx) may use the exported
 * utilities (videoElementCache, getOrCreateVideoEl).
 *
 * @see packages/elements/src/clips/VideoClip.ts for the actual implementation
 */

export {
  videoElementCache,
  getOrCreateVideoEl,
  getVideoBounds,
  VideoClipElement as VideoClipRenderer,
} from '@video-editor/elements';

// Re-export the type that Preview.tsx uses
export type { PreviewRenderContextWithAssets } from '@video-editor/elements';
