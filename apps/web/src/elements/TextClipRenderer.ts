/**
 * Text Clip Renderer — Re-export shim
 *
 * The TextClip implementation has moved to the unified elements package:
 *   packages/elements/src/clips/TextClip.ts
 *
 * This file re-exports everything from there so existing imports still work.
 * The PreviewPipeline now uses CLIP_REGISTRY directly and no longer imports
 * TextClipRenderer, but other files may use the exported utilities.
 *
 * @see packages/elements/src/clips/TextClip.ts for the actual implementation
 */

export {
  DEFAULT_TEXT_STYLE,
  getTextBounds,
  TextClipElement as TextClipRenderer,
} from '@video-editor/elements';
