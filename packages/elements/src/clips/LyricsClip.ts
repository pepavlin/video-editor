/**
 * Lyrics Clip Element — Unified Preview + Export
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │  PREVIEW: Canvas 2D word-level karaoke rendering with chunk display       │
 * │  EXPORT:  ASS subtitle file generation + FFmpeg subtitles filter          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * This is the single source of truth for how lyrics clips are rendered.
 * This handles BOTH clip-level lyrics (from lyrics tracks) AND project-level
 * lyrics overlay (project.lyrics).
 *
 * ## Rendering approach
 * Preview: Word-level rendering with current word highlighted, chunk-based display.
 * Export: ASS subtitle format with karaoke-style per-word timing.
 * Both use the same chunk size, position, and color configuration.
 *
 * ## Word timestamps
 * Word timestamps in clip.lyricsWords are relative to the master audio WAV start.
 * Preview adjusts using masterClip.sourceStart - masterClip.timelineStart offset.
 * Export embeds timing directly in ASS format (absolute timeline timestamps).
 *
 * ## ASS file writing
 * The export implementation writes ASS files via context.writeFile (injected by
 * ExportPipeline). This avoids importing 'fs' in the shared elements package.
 * Each lyrics clip writes to: context.projectDir/lyrics_<filterIdx>.ass
 *
 * ## When lyrics don't show in export:
 *   → Look at LyricsClip.export below (this file)
 *
 * ## When lyrics look different between preview and export:
 *   → Compare LyricsClip.preview and LyricsClip.export in this file
 */

import type { Clip, Track, Transform, WordTimestamp, LyricsStyle, LyricsData, Project } from '@video-editor/shared';
import type {
  ClipElementDefinition,
  ClipPreviewApi,
  ClipExportApi,
  ClipFilterResult,
  PreviewRenderContextWithAssets,
  ExportFilterContext,
  Bounds,
} from '../types';

// ─── Shared defaults ──────────────────────────────────────────────────────────

const DEFAULT_LYRICS_STYLE: LyricsStyle = {
  fontSize: 48,
  color: '#FFFFFF',
  highlightColor: '#FFE600',
  position: 'bottom',
  wordsPerChunk: 3,
};

// ─── Shared: canvas lyrics rendering ─────────────────────────────────────────

/**
 * Draw a chunk of lyrics words onto the canvas at the given audio time.
 * Words at the current time are highlighted; others use the default color.
 * Exported for use by renderProjectLyricsOverlay (project-level lyrics).
 */
export function drawLyricsWords(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  audioTime: number,
  words: WordTimestamp[],
  lyricsStyle?: LyricsStyle
): void {
  const style: LyricsStyle = lyricsStyle ?? DEFAULT_LYRICS_STYLE;
  const chunkSize = style.wordsPerChunk;
  const fontSize = Math.round((style.fontSize / 1920) * H);

  // Find the chunk that contains the current time
  let chunkStart = -1;
  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    if (audioTime >= chunk[0].start && audioTime <= (chunk[chunk.length - 1].end + 0.5)) {
      chunkStart = i;
      break;
    }
  }

  if (chunkStart < 0) return;

  const chunk = words.slice(chunkStart, chunkStart + chunkSize);

  ctx.save();
  ctx.font = `bold ${fontSize}px Arial`;
  ctx.textAlign = 'center';

  const y = style.position === 'bottom'
    ? H - fontSize * 2
    : style.position === 'top'
    ? fontSize * 2
    : H / 2;

  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 8;

  // Measure total width to center the line
  const texts = chunk.map((w) => w.word);
  const fullText = texts.join(' ');
  const totalWidth = ctx.measureText(fullText).width;
  let x = (W - totalWidth) / 2;

  for (let i = 0; i < chunk.length; i++) {
    const w = chunk[i];
    const isCurrentWord = audioTime >= w.start && audioTime <= w.end;
    ctx.fillStyle = isCurrentWord ? style.highlightColor : style.color;
    const wordText = i < chunk.length - 1 ? w.word + ' ' : w.word;
    ctx.fillText(wordText, x + ctx.measureText(wordText).width / 2, y);
    x += ctx.measureText(wordText).width;
  }

  ctx.restore();
}

// ─── Shared: ASS subtitle generation ─────────────────────────────────────────

function toAssTime(t: number): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.round((t % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

function hex2ass(hex: string): string {
  const h = hex.replace('#', '');
  if (h.length === 6) {
    return `&H00${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`;
  }
  return '&H00FFFFFF&';
}

/**
 * Generate ASS subtitle content string from lyrics data.
 * Does not write to disk — the caller provides file I/O via context.writeFile.
 * Exported for use in ExportPipeline (project-level lyrics).
 */
export function generateAssContent(lyrics: LyricsData): string {
  const style = lyrics.style ?? DEFAULT_LYRICS_STYLE;

  const alignmentMap: Record<string, number> = { top: 8, center: 5, bottom: 2 };
  const alignment = alignmentMap[style.position] ?? 2;

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${style.fontSize},${hex2ass(style.color)},${hex2ass(style.highlightColor)},&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,2,1,${alignment},80,80,60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const words = lyrics.words ?? [];
  const chunkSize = Math.max(1, style.wordsPerChunk);
  const events: string[] = [];

  for (let i = 0; i < words.length; i += chunkSize) {
    const chunk = words.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;

    for (let j = 0; j < chunk.length; j++) {
      const w = chunk[j];
      const wordStart = w.start;
      const wordEnd = j < chunk.length - 1 ? chunk[j + 1].start : w.end + 0.1;
      const chunkEnd = chunk[chunk.length - 1].end + 0.1;

      // Build karaoke text: highlight current word, show others in default color
      let text = '';
      for (let k = 0; k < chunk.length; k++) {
        const cw = chunk[k];
        if (k === j) {
          text += `{\\c${hex2ass(style.highlightColor)}}${cw.word} `;
        } else {
          text += `{\\c${hex2ass(style.color)}}${cw.word} `;
        }
      }
      text = text.trim();

      events.push(
        `Dialogue: 0,${toAssTime(wordStart)},${toAssTime(Math.min(wordEnd, chunkEnd))},Default,,0,0,0,,${text}`
      );
    }
  }

  return header + events.join('\n') + '\n';
}

// ─── Preview implementation ───────────────────────────────────────────────────

const lyricsClipPreview: ClipPreviewApi = {
  render(
    ctx: CanvasRenderingContext2D,
    clip: Clip,
    _track: Track,
    _transform: Transform,
    context: PreviewRenderContextWithAssets
  ): void {
    if (!clip.lyricsWords || clip.lyricsWords.length === 0) return;

    // Word timestamps are relative to the master audio WAV start.
    // Compute audio time by accounting for master clip's timeline/source offset.
    const audioTimeOffset = context.masterClip
      ? context.masterClip.sourceStart - context.masterClip.timelineStart
      : 0;
    const audioTime = context.currentTime + audioTimeOffset;

    drawLyricsWords(ctx, context.W, context.H, audioTime, clip.lyricsWords, clip.lyricsStyle);
  },

  getBounds(
    _clip: Clip,
    _track: Track,
    _transform: Transform,
    _context: { W: number; H: number; ctx: CanvasRenderingContext2D }
  ): Bounds | null {
    // Lyrics don't have a spatial bounds for selection/hit-testing
    return null;
  },
};

// ─── Export implementation ────────────────────────────────────────────────────

const lyricsClipExport: ClipExportApi = {
  buildFilter(
    prevPad: string,
    clip: Clip,
    _track: Track,
    filterIdx: number,
    context: ExportFilterContext
  ): ClipFilterResult | null {
    if (!clip.lyricsWords || clip.lyricsWords.length === 0) return null;

    const lyricsData: LyricsData = {
      text: clip.lyricsContent ?? '',
      words: clip.lyricsWords,
      style: clip.lyricsStyle,
      enabled: true,
    };

    // Generate ASS content and write via context.writeFile (provided by ExportPipeline)
    const assContent = generateAssContent(lyricsData);
    const assPath = `${context.projectDir}/lyrics_${filterIdx}.ass`;
    context.writeFile(assPath, assContent);

    // Escape path for FFmpeg (forward slashes, escape colons and backslashes)
    const escapedPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    const outPad = `lyr${filterIdx}`;

    return {
      filters: [`[${prevPad}]subtitles='${escapedPath}'[${outPad}]`],
      outputPad: outPad,
      nextFilterIdx: filterIdx + 1,
    };
  },
};

// ─── Unified ClipElementDefinition ───────────────────────────────────────────

/**
 * Unified lyrics clip element definition.
 *
 * Handles clips on lyrics tracks that have word-level timestamps.
 *
 * When lyrics clips don't show in export → start here (LyricsClip.export).
 * When lyrics look different preview vs export → compare preview vs export in this file.
 *
 * NOTE: Project-level lyrics (project.lyrics) are handled separately in ExportPipeline
 * as a global overlay applied AFTER all track clips. This definition handles
 * clip-level lyrics on lyrics tracks only.
 */
export const LyricsClipElement: ClipElementDefinition = {
  clipType: 'lyrics',

  canHandle(clip: Clip, track: Track): boolean {
    return track.type === 'lyrics' && !!(clip.lyricsWords && clip.lyricsWords.length > 0);
  },

  preview: lyricsClipPreview,
  export: lyricsClipExport,
};

// ─── Project-level lyrics overlay helpers ─────────────────────────────────────

/**
 * Render the project-level lyrics overlay (project.lyrics) onto the canvas.
 * Called by PreviewPipeline after all track clips have been rendered.
 * This is separate from LyricsClipElement which handles clip-level lyrics.
 */
export function renderProjectLyricsOverlay(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  currentTime: number,
  lyrics: NonNullable<Project['lyrics']>
): void {
  if (!lyrics.words || lyrics.words.length === 0) return;
  drawLyricsWords(ctx, W, H, currentTime, lyrics.words, lyrics.style);
}

/**
 * Build the FFmpeg subtitles filter for project-level lyrics.
 * Called by ExportPipeline after all track clips have been processed.
 * Writes the ASS file via writeFile callback (provided by ExportPipeline).
 *
 * @param prevPad     Current accumulated video output pad name
 * @param lyrics      Project lyrics data
 * @param projectDir  Absolute path to the project directory
 * @param writeFile   File writing callback (injected from ExportPipeline)
 * @returns Filter string and output pad, or null if no lyrics data
 */
export function buildProjectLyricsFilter(
  prevPad: string,
  lyrics: NonNullable<Project['lyrics']>,
  projectDir: string,
  writeFile: (filePath: string, content: string) => void
): { filter: string; outputPad: string } | null {
  if (!lyrics.words || lyrics.words.length === 0) return null;

  const assContent = generateAssContent(lyrics as LyricsData);
  const assPath = `${projectDir}/lyrics.ass`;
  writeFile(assPath, assContent);

  // Escape path for FFmpeg
  const escapedPath = assPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const subbedPad = 'subbed';

  return {
    filter: `[${prevPad}]subtitles='${escapedPath}'[${subbedPad}]`,
    outputPad: subbedPad,
  };
}
