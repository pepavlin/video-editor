/**
 * Unified Element Types — @video-editor/elements
 *
 * This file defines ALL the types shared between the preview pipeline (browser/Canvas)
 * and the export pipeline (Node.js/FFmpeg).
 *
 * ## Architecture: Unified Clip Element Definitions
 *
 * Every visual element type (VideoClip, TextClip, RectangleClip, LyricsClip) lives
 * in ONE file under packages/elements/src/clips/<ElementName>.ts and exposes BOTH
 * a preview implementation AND an export implementation via the ClipElementDefinition
 * interface.
 *
 * This means:
 *   - When TextClip doesn't show in export  → look in packages/elements/src/clips/TextClip.ts
 *   - When VideoClip effect doesn't work    → look in packages/elements/src/clips/VideoClip.ts
 *     then in packages/elements/src/effects/<EffectName>.ts for the specific effect
 *   - ONE file per element type. No more searching in two separate codebases.
 *
 * ## Pipeline Integration
 *
 * Both pipelines import CLIP_REGISTRY from this package and iterate it systematically:
 *
 *   // Preview (PreviewPipeline.ts):
 *   for (const track of tracks) {
 *     for (const clip of track.clips) {
 *       const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track));
 *       element?.preview.render(ctx, clip, track, transform, context);
 *     }
 *   }
 *
 *   // Export (ExportPipeline.ts):
 *   for (const track of tracks) {
 *     for (const clip of track.clips) {
 *       const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track));
 *       const result = element?.export.buildFilter(prevPad, clip, track, filterIdx, context);
 *       if (result) { filterParts.push(...result.filters); prevPad = result.outputPad; }
 *     }
 *   }
 *
 * ## Adding a New Element Type
 *   1. Create packages/elements/src/clips/MyElement.ts
 *   2. Implement ClipElementDefinition (preview + export in one file)
 *   3. Add it to CLIP_REGISTRY in packages/elements/src/clips/index.ts (order matters!)
 *   4. Done — no changes needed in apps/web or apps/api pipelines
 *
 * ## Effect System (sub-layer for VideoClip)
 *
 * Effects (BeatZoom, Cutout, Cartoon, ColorGrade) are applied WITHIN the VideoClip
 * element via EFFECT_REGISTRY. The same "one file per effect" pattern applies:
 *   - When BeatZoom doesn't work in export  → packages/elements/src/effects/BeatZoom.ts
 *   - When Cutout doesn't work in preview   → packages/elements/src/effects/Cutout.ts
 */

import type { Project, Clip, Track, Transform, BeatsData, EffectType } from '@video-editor/shared';

// ─── Shared Context Types ─────────────────────────────────────────────────────

/**
 * Bounding box in canvas pixels.
 * Used by preview renderers to position elements.
 */
export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * The type of source image that flows through the preview effect pipeline.
 * Effects receive a source and may return a transformed source.
 * The final source is drawn to the canvas after all effects are applied.
 */
export type EffectSource = HTMLVideoElement | HTMLCanvasElement;

// ─── Preview Context ──────────────────────────────────────────────────────────

/**
 * All data needed by any element renderer to draw one frame.
 * Passed into PreviewPipeline.renderFrame() and forwarded to each renderer.
 */
export interface PreviewRenderContext {
  project: Project;
  currentTime: number;
  masterBeats: number[] | undefined;
  masterClip: Clip | undefined;
  isPlaying: boolean;
  W: number;
  H: number;
  editingClipId: string | null;
  beatsData: Map<string, BeatsData>;
}

/**
 * Extended context injected by PreviewPipeline before calling renderers.
 * Contains asset path maps that are expensive to rebuild per-clip.
 */
export interface PreviewRenderContextWithAssets extends PreviewRenderContext {
  _assetProxyPaths: Map<string, string>;
  _maskPaths: Map<string, string>;
}

// ─── Export Context ───────────────────────────────────────────────────────────

/**
 * All data available to a clip element export builder.
 * Passed into each builder by ExportPipeline.
 */
export interface ExportFilterContext {
  project: Project;
  /** assetId → absolute filesystem path of the asset's proxy/source */
  assetPathMap: Map<string, string>;
  /** assetId → FFmpeg input index for video */
  assetInputIdxMap: Map<string, number>;
  /** assetId → FFmpeg input index for clip audio WAV files */
  clipAudioWavMap: Map<string, number>;
  /** assetId → FFmpeg input index for mask video (used by cutout effect) */
  assetMaskInputIdxMap: Map<string, number>;
  W: number;
  H: number;
  beatsMap: Map<string, BeatsData>;
  masterAudioClip: Clip | undefined;
  /**
   * Absolute path to the project directory.
   * Used by LyricsClip to write ASS subtitle files.
   */
  projectDir: string;
  /**
   * Write a file to the filesystem.
   * Provided by ExportPipeline (uses fs.writeFileSync).
   * Injected as a callback so packages/elements/ doesn't need to import 'fs'.
   */
  writeFile: (filePath: string, content: string) => void;
}

// ─── Export Filter Results ────────────────────────────────────────────────────

/**
 * Result returned by a clip element's export.buildFilter().
 * The pipeline accumulates these to build the complete FFmpeg filter complex.
 */
export interface ClipFilterResult {
  /** FFmpeg filter graph fragments for this element */
  filters: string[];
  /** The name of the output pad after this element's filters */
  outputPad: string;
  /** Updated filter index counter for the next element */
  nextFilterIdx: number;
}

/**
 * @deprecated Use ClipFilterResult instead.
 * Kept for backwards compatibility with VideoClipFilter.ts.
 */
export interface EffectFilterResult {
  /** FFmpeg filter graph fragments for this effect */
  filters: string[];
  /** The name of the output pad after this effect's filters */
  outputPad: string;
}

/**
 * @deprecated Use ClipFilterResult instead.
 * Kept for backwards compatibility with VideoClipFilter.ts during migration.
 */
export interface VideoClipFilterResult {
  filters: string[];
  outputPad: string;
  nextFilterIdx: number;
  nextPrevPad: string;
}

// ─── Unified Clip Element Definition ──────────────────────────────────────────

/**
 * A single clip element definition containing BOTH preview and export implementations.
 *
 * Each element in packages/elements/src/clips/ exports one of these.
 * The CLIP_REGISTRY is an ordered array of ClipElementDefinition objects.
 *
 * When something doesn't work:
 *   - Preview issue → find element by clipType in CLIP_REGISTRY, open its file → preview property
 *   - Export issue  → find element by clipType in CLIP_REGISTRY, open its file → export property
 *   - Order issue   → look at CLIP_REGISTRY in packages/elements/src/clips/index.ts
 *
 * When a specific EFFECT on a video clip doesn't work:
 *   - Look in packages/elements/src/effects/<EffectName>.ts
 */
export interface ClipElementDefinition {
  /** Identifier for this element type (for documentation and debugging) */
  readonly clipType: string;

  /**
   * Returns true if this definition should handle the given clip+track combination.
   * CLIP_REGISTRY is iterated in order; the FIRST matching element wins.
   * Put more specific matchers before general ones (e.g., TextClip before VideoClip).
   */
  canHandle(clip: Clip, track: Track): boolean;

  /** Preview implementation — Canvas 2D, runs in browser */
  readonly preview: ClipPreviewApi;

  /** Export implementation — FFmpeg filters, runs on server */
  readonly export: ClipExportApi;
}

/**
 * The preview side of a clip element definition.
 * Implemented using Canvas 2D APIs (browser-only).
 */
export interface ClipPreviewApi {
  /**
   * Render this clip onto the canvas for the current frame.
   */
  render(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    track: Track,
    transform: Transform,
    context: PreviewRenderContextWithAssets
  ): void;

  /**
   * Return the bounding box for this clip in canvas pixels.
   * Used for hit testing and selection overlay rendering.
   * Return null if this element type does not have spatial bounds (e.g., lyrics).
   */
  getBounds?(
    clip: Clip,
    track: Track,
    transform: Transform,
    context: { W: number; H: number; ctx: CanvasRenderingContext2D }
  ): Bounds | null;
}

/**
 * The export side of a clip element definition.
 * Implemented using FFmpeg filter string generation (pure JS, no DOM).
 */
export interface ClipExportApi {
  /**
   * Returns FFmpeg filter graph fragments for this clip.
   * Receives prevPad (current accumulated video pad) and returns the new pad after compositing.
   * Returns null if the clip cannot be exported (e.g., missing required data).
   */
  buildFilter(
    prevPad: string,
    clip: Clip,
    track: Track,
    filterIdx: number,
    context: ExportFilterContext
  ): ClipFilterResult | null;
}

// ─── Effect Preview API ───────────────────────────────────────────────────────

/**
 * The preview side of an effect definition.
 * Implemented using Canvas 2D APIs (browser-only).
 *
 * Effects are applied in a two-phase pipeline per video clip:
 *
 *   Phase 1 — modifyTransform (optional):
 *     Called BEFORE the clip bounds are computed.
 *     Use for effects that change how the clip is positioned or scaled.
 *     Example: BeatZoom multiplies transform.scale on beat pulses.
 *
 *   Phase 2 — applyRender (optional):
 *     Called AFTER transform and bounds are computed.
 *     Receives the current source (video element or canvas from a previous effect).
 *     Returns the new source for subsequent effects, or null if unchanged.
 *     MAY draw side effects to ctx (e.g., Cutout draws the background first).
 *     The pipeline draws the final source to ctx after all effects complete.
 */
export interface EffectPreviewApi {
  /**
   * Returns true if this effect is active for the given clip at the current time.
   * When false, BOTH modifyTransform and applyRender are skipped.
   */
  isActive(clip: Clip, track: Track, context: PreviewRenderContextWithAssets): boolean;

  /**
   * Phase 1: Modify the clip's transform BEFORE bounds are calculated.
   * The transform object is mutated in place.
   * Optional — effects that only process pixels can omit this.
   */
  modifyTransform?(
    transform: Transform,
    clip: Clip,
    track: Track,
    context: PreviewRenderContextWithAssets
  ): void;

  /**
   * Phase 2: Process pixel data for this clip.
   * Returns the new source for chaining, or null if no source change.
   * Effects may draw to ctx as a side effect (e.g., Cutout draws the background).
   * Optional — transform-only effects (e.g., BeatZoom) can omit this.
   */
  applyRender?(
    ctx: CanvasRenderingContext2D,
    source: EffectSource,
    bounds: Bounds,
    clip: Clip,
    track: Track,
    context: PreviewRenderContextWithAssets
  ): EffectSource | null;
}

// ─── Effect Export API ────────────────────────────────────────────────────────

/**
 * The export side of an effect definition.
 * Implemented using FFmpeg filter string generation (pure JS, no DOM).
 *
 * Effects contribute to the FFmpeg filter_complex in two ways:
 *
 *   buildBaseModifier (optional):
 *     Returns a filter fragment to INLINE into the base clip chain.
 *     Used by BeatZoom which injects a crop filter directly after the trim.
 *     This avoids the need for a separate pad, which improves FFmpeg compatibility.
 *
 *   buildFilter (optional):
 *     Returns filter graph fragments to append AFTER the base clip chain.
 *     Used by Cartoon, ColorGrade, Cutout — each creating separate filter nodes.
 *     Receives an input pad and returns an output pad for chaining.
 */
export interface EffectExportApi {
  /**
   * Returns true if this effect is active for the given clip.
   * When false, buildBaseModifier and buildFilter are skipped.
   */
  isActive(clip: Clip, track: Track, context: ExportFilterContext): boolean;

  /**
   * Returns a filter fragment string to inject into the base trim filter chain.
   * Used for effects that need to be evaluated per-frame in the base filter
   * (e.g., BeatZoom crop expressions with per-frame `t` variable).
   * Returns null if not applicable.
   * Optional — most effects use buildFilter instead.
   */
  buildBaseModifier?(
    clip: Clip,
    track: Track,
    context: ExportFilterContext
  ): string | null;

  /**
   * Returns FFmpeg filter graph fragments to append after the base clip chain.
   * Receives inputPad (the current clip pad) and returns outputPad (new pad name).
   * Returns null if the effect cannot be applied (e.g., missing mask file).
   * Optional — base-modifier-only effects (e.g., BeatZoom) can omit this.
   */
  buildFilter?(
    inputPad: string,
    clip: Clip,
    track: Track,
    filterIdx: number,
    context: ExportFilterContext
  ): EffectFilterResult | null;
}

// ─── Unified Effect Definition ────────────────────────────────────────────────

/**
 * A single effect definition containing BOTH the preview and export implementations.
 *
 * Each effect in packages/elements/src/effects/ exports one of these.
 * The EFFECT_REGISTRY is an ordered array of EffectDefinition objects.
 *
 * When something doesn't work:
 *   - Preview issue → find the effect's type in EFFECT_REGISTRY, open its file → preview property
 *   - Export issue  → find the effect's type in EFFECT_REGISTRY, open its file → export property
 *   - Order issue   → look at EFFECT_REGISTRY in packages/elements/src/index.ts
 */
export interface EffectDefinition {
  /** Must match the EffectType from @video-editor/shared */
  readonly type: EffectType;
  /** Preview implementation — Canvas 2D, runs in browser */
  readonly preview: EffectPreviewApi;
  /** Export implementation — FFmpeg filters, runs on server */
  readonly export: EffectExportApi;
}

// ─── Legacy: Element Preview Renderer (for non-video clips) ──────────────────

/**
 * @deprecated Use ClipElementDefinition instead.
 * Kept for backwards compatibility during migration.
 */
export interface ElementPreviewRenderer {
  canRender(clip: Clip, track: Track): boolean;
  render(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    track: Track,
    transform: Transform,
    context: PreviewRenderContext
  ): void;
  getBounds(
    clip: Clip,
    track: Track,
    transform: Transform,
    context: { W: number; H: number; ctx: CanvasRenderingContext2D }
  ): Bounds | null;
}
