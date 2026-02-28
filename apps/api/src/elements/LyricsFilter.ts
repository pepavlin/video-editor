/**
 * Lyrics Filter — Re-export shim
 *
 * The lyrics export implementation has moved to the unified elements package:
 *   packages/elements/src/clips/LyricsClip.ts
 *
 * The ExportPipeline now uses buildProjectLyricsFilter from @video-editor/elements.
 * This file provides backward-compatible exports for any code that imported directly.
 *
 * @see packages/elements/src/clips/LyricsClip.ts for the actual implementation
 * @see apps/api/src/elements/ExportPipeline.ts for the pipeline orchestrator
 */

import fs from 'fs';
import { generateAssContent, buildProjectLyricsFilter } from '@video-editor/elements';
import type { LyricsData } from '@video-editor/shared';

/**
 * @deprecated Use generateAssContent from @video-editor/elements instead.
 * Generates an ASS subtitle file from lyrics data and writes it to outputPath.
 */
export function generateAss(lyrics: LyricsData, outputPath: string): void {
  const content = generateAssContent(lyrics);
  fs.writeFileSync(outputPath, content);
}

/**
 * @deprecated Use buildProjectLyricsFilter from @video-editor/elements instead.
 * Builds the FFmpeg subtitles filter fragment for burned-in lyrics.
 */
export function buildLyricsFilter(
  prevPad: string,
  assPath: string
): { filter: string; outputPad: string } | null {
  if (!fs.existsSync(assPath)) return null;

  // Escape path for FFmpeg
  const escapedPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const subbedPad = `subbed`;

  return {
    filter: `[${prevPad}]subtitles='${escapedPath}'[${subbedPad}]`,
    outputPad: subbedPad,
  };
}

export { generateAssContent, buildProjectLyricsFilter };
