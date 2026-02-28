/**
 * Element Types — Re-export shim
 *
 * All type and interface definitions live in the shared elements package:
 *   packages/elements/src/types.ts
 *
 * This re-exports everything for backwards compatibility with existing imports.
 *
 * @see packages/elements/src/types.ts for all definitions
 * @see packages/elements/src/clips/ for unified element implementations (preview + export)
 *
 * ## Architecture: Unified Clip Element Definitions
 *
 * Each element type lives in ONE file in packages/elements/src/clips/:
 *   - preview property → Canvas 2D implementation
 *   - export property  → FFmpeg filter implementation
 *
 * When an element doesn't work:
 *   → Open packages/elements/src/clips/<ElementName>.ts
 *   → Look at the `preview` or `export` property as appropriate
 *
 * ## Adding a New Element Type:
 *   1. Create packages/elements/src/clips/MyElement.ts
 *   2. Implement ClipElementDefinition (both preview + export sides)
 *   3. Add to CLIP_REGISTRY in packages/elements/src/clips/index.ts
 */

export type {
  Bounds,
  EffectSource,
  PreviewRenderContext,
  PreviewRenderContextWithAssets,
  ElementPreviewRenderer,
  EffectPreviewApi,
  EffectDefinition,
  ClipElementDefinition,
  ClipPreviewApi,
  ClipExportApi,
  ClipFilterResult,
} from '@video-editor/elements';
