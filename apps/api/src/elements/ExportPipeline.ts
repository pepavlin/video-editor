/**
 * Export Pipeline — FFmpeg Filter Complex Orchestrator
 *
 * The ExportPipeline builds the complete FFmpeg filter complex for a project export.
 * It is the single entry point for constructing the FFmpeg -filter_complex argument.
 *
 * ## Processing Order (mirrors PreviewPipeline.ts):
 *   1. Base canvas (black background at 30fps)
 *   2. ALL visual clips (reversed track order: track[0] = top = last to render)
 *      - Dispatches to CLIP_REGISTRY for each clip (VideoClip, TextClip, RectangleClip, LyricsClip)
 *      - Each element's export.buildFilter() adds its FFmpeg filter fragments
 *   3. Audio mixing (master audio + clip audio WAV files)
 *   4. Project-level lyrics overlay (ASS subtitle burn-in, if enabled)
 *
 * ## Element dispatch:
 *   CLIP_REGISTRY.find(e => e.canHandle(clip, track)) returns the right element.
 *   Each element's export.buildFilter() builds the FFmpeg filters for that clip.
 *   This is fully systematic — no manual if/else per element type.
 *
 * ## When an element doesn't appear in export:
 *   → Find the element type in CLIP_REGISTRY
 *   → Open packages/elements/src/clips/<ElementName>.ts
 *   → Look at the `export` property and its buildFilter method
 *
 * ## Adding a New Element Type:
 *   1. Create packages/elements/src/clips/MyElement.ts implementing ClipElementDefinition
 *   2. Add it to CLIP_REGISTRY in packages/elements/src/clips/index.ts
 *   3. Done — no changes needed here
 *
 * Preview counterpart orchestrator: apps/web/src/elements/PreviewPipeline.ts
 */

import path from 'path';
import fs from 'fs';
import type { Project, BeatsData } from '@video-editor/shared';
import type { ExportFilterContext } from '@video-editor/elements';
import { CLIP_REGISTRY, buildProjectLyricsFilter } from '@video-editor/elements';
import type { ExportOptions } from '../services/ffmpegService';
import * as ws from '../services/workspace';

// ─── ExportPipeline ───────────────────────────────────────────────────────────

export interface ExportPipelineResult {
  /** FFmpeg -i arguments */
  inputArgs: string[];
  /** Assembled filter_complex string */
  filterComplex: string;
  /** Output pad name for the video stream (to use with -map) */
  videoOutPad: string;
  /** Output pad name for the audio stream (to use with -map), or null if no audio */
  audioOutPad: string | null;
}

export class ExportPipeline {
  /**
   * Build the complete FFmpeg filter complex for a project export.
   *
   * Iterates CLIP_REGISTRY systematically for each clip.
   * All visual element types (video, text, rectangle, lyrics) are handled
   * without any special-casing in this file.
   *
   * @param project     The project to export
   * @param opts        Export options (output path, dimensions, work area, etc.)
   * @param beatsMap    Beats data keyed by assetId
   * @param stabilizedAssetIds  Set of assetIds that should use the head-stabilized path
   */
  build(
    project: Project,
    opts: ExportOptions,
    beatsMap: Map<string, BeatsData>,
    stabilizedAssetIds: Set<string>
  ): ExportPipelineResult {
    const W = opts.width ?? 1080;
    const H = opts.height ?? 1920;

    // All visual tracks (skip audio tracks and effect tracks)
    // effect tracks are applied within VideoClip via EFFECT_REGISTRY, not here
    const visualTracks = project.tracks.filter(
      (t) => t.type !== 'audio' && !t.muted && t.type !== 'effect'
    );

    // Video-only tracks (needed for input collection)
    const videoTracks = project.tracks.filter((t) => t.type === 'video' && !t.muted);

    const masterAudioTrack = project.tracks.find((t) => t.type === 'audio' && t.isMaster);

    const inputs: string[] = [];
    const inputArgs: string[] = [];

    // ── Collect unique asset proxy paths ──────────────────────────────────────
    const assetPathMap = new Map<string, string>();
    for (const track of videoTracks) {
      for (const clip of track.clips) {
        if (!assetPathMap.has(clip.assetId)) {
          const asset = ws.getAsset(clip.assetId);
          if (asset) {
            let absProxy: string;
            if (stabilizedAssetIds.has(clip.assetId) && asset.headStabilizedPath) {
              absProxy = path.join(ws.getWorkspaceDir(), asset.headStabilizedPath);
            } else {
              absProxy = asset.proxyPath
                ? path.join(ws.getWorkspaceDir(), asset.proxyPath)
                : path.join(ws.getWorkspaceDir(), asset.originalPath);
            }
            assetPathMap.set(clip.assetId, absProxy);
          }
        }
      }
    }

    // ── Master audio input ────────────────────────────────────────────────────
    let masterAudioInputIdx = -1;
    const masterAudioClip = masterAudioTrack?.clips[0];
    if (masterAudioTrack && masterAudioClip) {
      const masterAsset = ws.getAsset(masterAudioClip.assetId);
      if (masterAsset) {
        const masterPath = path.join(ws.getWorkspaceDir(), masterAsset.originalPath);
        masterAudioInputIdx = inputs.length;
        inputs.push(masterPath);
      }
    }

    // ── Video asset inputs ────────────────────────────────────────────────────
    const assetInputIdxMap = new Map<string, number>();
    for (const [assetId, assetPath] of assetPathMap) {
      assetInputIdxMap.set(assetId, inputs.length);
      inputs.push(assetPath);
    }

    // ── Clip audio WAV inputs ─────────────────────────────────────────────────
    const clipAudioWavMap = new Map<string, number>();
    for (const track of videoTracks) {
      for (const clip of track.clips) {
        if (!clip.useClipAudio) continue;
        if (clipAudioWavMap.has(clip.assetId)) continue;
        const asset = ws.getAsset(clip.assetId);
        if (!asset?.audioPath) continue;
        const wavPath = path.join(ws.getWorkspaceDir(), asset.audioPath);
        if (!fs.existsSync(wavPath)) continue;
        clipAudioWavMap.set(clip.assetId, inputs.length);
        inputs.push(wavPath);
      }
    }

    // ── Mask video inputs (for Cutout effect) ─────────────────────────────────
    // Collect mask videos for assets that have an active cutout effect track.
    const assetMaskInputIdxMap = new Map<string, number>();
    for (const track of videoTracks) {
      const cutoutEffectTrack = project.tracks.find(
        (t) => t.type === 'effect' && t.effectType === 'cutout' && t.parentTrackId === track.id
      );
      if (!cutoutEffectTrack?.clips.some((c) => c.effectConfig?.enabled)) continue;

      for (const clip of track.clips) {
        if (assetMaskInputIdxMap.has(clip.assetId)) continue;
        const asset = ws.getAsset(clip.assetId);
        if (!asset?.maskPath) continue;
        const maskAbsPath = path.join(ws.getWorkspaceDir(), asset.maskPath);
        if (!fs.existsSync(maskAbsPath)) continue;
        assetMaskInputIdxMap.set(clip.assetId, inputs.length);
        inputs.push(maskAbsPath);
      }
    }

    for (const inp of inputs) {
      inputArgs.push('-i', inp);
    }

    // ── Project directory (needed by LyricsClip to write ASS files) ──────────
    const projectDir = ws.getProjectDir(project.id);

    // ── Build export filter context ───────────────────────────────────────────
    const filterContext: ExportFilterContext = {
      project,
      assetPathMap,
      assetInputIdxMap,
      clipAudioWavMap,
      assetMaskInputIdxMap,
      W,
      H,
      beatsMap,
      masterAudioClip,
      projectDir,
      writeFile: (filePath, content) => fs.writeFileSync(filePath, content),
    };

    // ── Build filter complex ───────────────────────────────────────────────────
    const filterParts: string[] = [];
    let filterIdx = 0;

    // 1. Base canvas (black background at 30fps)
    filterParts.push(`color=c=black:s=${W}x${H}:r=30[base]`);
    let prevPad = 'base';

    // 2. ALL visual clips (reversed track order: top track renders last = on top)
    //    Dispatches to CLIP_REGISTRY — handles VideoClip, TextClip, RectangleClip, LyricsClip.
    //    No special-casing per element type needed here.
    for (const track of [...visualTracks].reverse()) {
      for (const clip of track.clips) {
        const srcDuration = clip.sourceEnd - clip.sourceStart;
        const outDuration = clip.timelineEnd - clip.timelineStart;

        // Skip clips with no duration (video clips only, text/rect/lyrics use enable expressions)
        if (track.type === 'video' && (srcDuration <= 0 || outDuration <= 0)) continue;

        // Registry-driven dispatch: find the first element that can handle this clip
        const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track));
        if (!element) continue;

        const result = element.export.buildFilter(prevPad, clip, track, filterIdx, filterContext);
        if (result) {
          filterParts.push(...result.filters);
          prevPad = result.outputPad;
          filterIdx = result.nextFilterIdx;
        }
      }
    }

    // 3. Audio mixing
    const audioOutPad = this._buildAudioFilters(
      filterParts,
      filterIdx,
      masterAudioInputIdx,
      masterAudioClip,
      videoTracks,
      clipAudioWavMap
    );

    // 4. Project-level lyrics overlay (applied LAST, on top of everything)
    //    This is separate from clip-level lyrics (handled by LyricsClipElement above).
    let videoOutPad = prevPad;
    if (project.lyrics?.enabled && project.lyrics.words && project.lyrics.words.length > 0) {
      const lyricsResult = buildProjectLyricsFilter(
        videoOutPad,
        project.lyrics,
        projectDir,
        (filePath, content) => fs.writeFileSync(filePath, content)
      );
      if (lyricsResult) {
        filterParts.push(lyricsResult.filter);
        videoOutPad = lyricsResult.outputPad;
      }
    }

    return {
      inputArgs,
      filterComplex: filterParts.join('; '),
      videoOutPad,
      audioOutPad,
    };
  }

  // ── Private: audio filter building ───────────────────────────────────────────

  private _buildAudioFilters(
    filterParts: string[],
    _filterIdx: number,
    masterAudioInputIdx: number,
    masterAudioClip: import('@video-editor/shared').Clip | undefined,
    videoTracks: import('@video-editor/shared').Track[],
    clipAudioWavMap: Map<string, number>
  ): string | null {
    const audioInputPads: string[] = [];
    let clipAudioIdx = 0;

    if (masterAudioInputIdx >= 0 && masterAudioClip) {
      const masterAudioPad = `maudio`;
      filterParts.push(
        `[${masterAudioInputIdx}:a]atrim=start=${masterAudioClip.sourceStart.toFixed(4)}:end=${masterAudioClip.sourceEnd.toFixed(4)},asetpts=PTS-STARTPTS,adelay=${Math.round(masterAudioClip.timelineStart * 1000)}:all=1[${masterAudioPad}]`
      );
      audioInputPads.push(`[${masterAudioPad}]`);
    }

    for (const track of videoTracks) {
      for (const clip of track.clips) {
        if (!clip.useClipAudio) continue;
        const inputIdx = clipAudioWavMap.get(clip.assetId);
        if (inputIdx === undefined) continue;

        const vol = Math.max(0, clip.clipAudioVolume ?? 1);
        const clipAudioPad = `caudio${clipAudioIdx}`;
        filterParts.push(
          `[${inputIdx}:a]atrim=start=${clip.sourceStart.toFixed(4)}:end=${clip.sourceEnd.toFixed(4)},asetpts=PTS-STARTPTS,adelay=${Math.round(clip.timelineStart * 1000)}:all=1,volume=${vol.toFixed(4)}[${clipAudioPad}]`
        );
        audioInputPads.push(`[${clipAudioPad}]`);
        clipAudioIdx++;
      }
    }

    if (audioInputPads.length > 1) {
      filterParts.push(
        `${audioInputPads.join('')}amix=inputs=${audioInputPads.length}[aout]`
      );
      return '[aout]';
    } else if (audioInputPads.length === 1) {
      return audioInputPads[0];
    }

    return null;
  }
}

export const exportPipeline = new ExportPipeline();
