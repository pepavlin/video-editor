/**
 * Video Clip Filter — Re-export shim
 *
 * The VideoClip export implementation has moved to the unified elements package:
 *   packages/elements/src/clips/VideoClip.ts
 *
 * The ExportPipeline now dispatches via CLIP_REGISTRY directly.
 * This file is kept for backwards compatibility with tests that may import from here.
 *
 * @see packages/elements/src/clips/VideoClip.ts for the actual implementation
 * @see apps/api/src/elements/ExportPipeline.ts for the pipeline orchestrator
 */

import { VideoClipElement } from '@video-editor/elements';
import type { Clip, Track } from '@video-editor/shared';
import type { ExportFilterContext, VideoClipFilterResult } from '@video-editor/elements';

/**
 * @deprecated Use CLIP_REGISTRY from @video-editor/elements instead.
 * Kept for backwards compatibility.
 */
export class VideoClipFilter {
  buildFilter(
    clip: Clip,
    track: Track,
    prevPad: string,
    filterIdx: number,
    context: ExportFilterContext
  ): VideoClipFilterResult {
    const result = VideoClipElement.export.buildFilter(prevPad, clip, track, filterIdx, context);
    if (!result) {
      return { filters: [], outputPad: prevPad, nextFilterIdx: filterIdx, nextPrevPad: prevPad };
    }
    return {
      filters: result.filters,
      outputPad: result.outputPad,
      nextFilterIdx: result.nextFilterIdx,
      nextPrevPad: result.outputPad,
    };
  }
}

export const videoClipFilter = new VideoClipFilter();
