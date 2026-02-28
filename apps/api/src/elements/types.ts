/**
 * Element Filter Types — Export (Node.js/FFmpeg)
 *
 * Re-exports the unified types from @video-editor/elements.
 * All type definitions have moved to the shared elements package so that
 * preview and export implementations can live in the same file.
 *
 * @see packages/elements/src/types.ts for the full type definitions.
 */

export type {
  ExportFilterContext,
  EffectFilterResult,
  VideoClipFilterResult,
} from '@video-editor/elements';
