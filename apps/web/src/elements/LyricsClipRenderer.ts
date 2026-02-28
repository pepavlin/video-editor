/**
 * Lyrics Clip Renderer — Re-export shim
 *
 * The LyricsClip implementation has moved to the unified elements package:
 *   packages/elements/src/clips/LyricsClip.ts
 *
 * This file re-exports everything from there so existing imports still work.
 * The PreviewPipeline now uses CLIP_REGISTRY directly and no longer imports
 * LyricsClipRenderer, but other files may use the exported utilities.
 *
 * @see packages/elements/src/clips/LyricsClip.ts for the actual implementation
 */

export {
  LyricsClipElement as LyricsClipRenderer,
  drawLyricsWords,
  renderProjectLyricsOverlay,
} from '@video-editor/elements';
