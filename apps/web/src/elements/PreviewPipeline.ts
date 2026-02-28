/**
 * Preview Pipeline — Browser/Canvas Rendering Orchestrator
 *
 * The PreviewPipeline is the single entry point for rendering a frame
 * onto the preview canvas. It:
 *
 *   1. Resolves asset paths and builds the render context
 *   2. Iterates tracks in reverse order (so top tracks appear on top)
 *   3. For each clip at the current time, dispatches to CLIP_REGISTRY
 *   4. Renders the project-level lyrics overlay (if enabled)
 *
 * ## Rendering Order (bottom → top):
 *   - Tracks in REVERSE array order (track[0] = top of stack = last to render)
 *   - Within each track: clips in array order
 *   - After all clips: project lyrics overlay
 *
 * ## How element dispatch works:
 *   CLIP_REGISTRY.find(e => e.canHandle(clip, track)) returns the right element.
 *   Each element has a preview.render() method that handles the actual drawing.
 *
 * ## Adding a New Element Type:
 *   1. Create packages/elements/src/clips/MyElement.ts implementing ClipElementDefinition
 *   2. Add it to CLIP_REGISTRY in packages/elements/src/clips/index.ts
 *   3. Done — no changes needed here
 *
 * ## When something doesn't render correctly in preview:
 *   → Find the element type in CLIP_REGISTRY
 *   → Open its file in packages/elements/src/clips/<ElementName>.ts
 *   → Look at the `preview` property
 *
 * Export counterpart orchestrator: apps/api/src/elements/ExportPipeline.ts
 */

import type { Asset } from '@video-editor/shared';
import type { PreviewRenderContext, Bounds, PreviewRenderContextWithAssets } from '@video-editor/elements';
import { CLIP_REGISTRY, renderProjectLyricsOverlay } from '@video-editor/elements';
import type { Clip, Track, Transform } from '@video-editor/shared';

const DEFAULT_TRANSFORM: Transform = { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 };

// ─── PreviewPipeline ──────────────────────────────────────────────────────────

export class PreviewPipeline {
  /**
   * Render one frame onto the canvas.
   *
   * Iterates CLIP_REGISTRY systematically for each visible clip.
   * Element dispatch is registry-driven — no manual if/else per element type.
   *
   * @param ctx         Canvas 2D context to draw onto
   * @param W           Canvas width in pixels
   * @param H           Canvas height in pixels
   * @param context     Render context with project, currentTime, etc.
   * @param assets      Full array of assets (used to build proxy path maps)
   * @param liveTransform Optional live transform override during drag
   */
  renderFrame(
    ctx: CanvasRenderingContext2D,
    W: number,
    H: number,
    context: PreviewRenderContext,
    assets: Asset[],
    liveTransform: { clipId: string; transform: Transform } | null
  ): void {
    const { project, currentTime } = context;

    // ── Build asset path maps ─────────────────────────────────────────────────
    const assetProxyPaths = new Map<string, string>();
    const maskPaths = new Map<string, string>();
    for (const asset of assets) {
      if (asset.proxyPath) assetProxyPaths.set(asset.id, asset.proxyPath);
      if (asset.maskPath) maskPaths.set(asset.id, asset.maskPath);
    }

    const extContext: PreviewRenderContextWithAssets = {
      ...context,
      _assetProxyPaths: assetProxyPaths,
      _maskPaths: maskPaths,
    };

    // ── Clear canvas ─────────────────────────────────────────────────────────
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);

    // ── Render tracks (reversed: top track renders last = appears on top) ────
    // Skips audio tracks and effect tracks (effects are applied within element rendering).
    for (const track of [...project.tracks].reverse()) {
      if (track.type === 'audio' || track.muted) continue;
      if (track.type === 'effect') continue;

      for (const clip of track.clips) {
        if (currentTime < clip.timelineStart || currentTime >= clip.timelineEnd) continue;

        const transform = (liveTransform?.clipId === clip.id)
          ? liveTransform.transform
          : (clip.transform ?? { ...DEFAULT_TRANSFORM });

        // Registry-driven dispatch: find the first element that can handle this clip
        const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track));
        if (element) {
          element.preview.render(ctx, clip, track, transform, extContext);
        }
      }
    }

    // ── Project-level lyrics overlay (rendered last, on top of everything) ───
    if (project.lyrics?.enabled && project.lyrics.words && project.lyrics.words.length > 0) {
      renderProjectLyricsOverlay(ctx, W, H, currentTime, project.lyrics);
    }
  }

  /**
   * Compute the bounding box for a clip in canvas pixels.
   * Used for hit testing and selection overlay rendering.
   */
  getClipBounds(
    clip: Clip,
    track: Track,
    transform: Transform,
    W: number,
    H: number,
    ctx: CanvasRenderingContext2D
  ): Bounds | null {
    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track));
    return element?.preview.getBounds?.(clip, track, transform, { W, H, ctx }) ?? null;
  }
}

/** Singleton pipeline instance — shared across all Preview renders */
export const previewPipeline = new PreviewPipeline();
