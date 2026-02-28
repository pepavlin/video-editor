/**
 * Beat Zoom Effect
 *
 * Creates a rhythmic zoom-in pulse synchronized with master audio beats.
 *
 * ┌─────────────────────────────────────────────────────────┐
 * │  PREVIEW: modifyTransform — multiplies transform.scale  │
 * │  EXPORT:  buildBaseModifier — FFmpeg crop expression    │
 * └─────────────────────────────────────────────────────────┘
 *
 * Both implementations use the same config params (from EffectClipConfig):
 *   intensity   — zoom factor (e.g., 0.08 = +8%)
 *   durationMs  — how long the pulse lasts in ms
 *   easing      — easeOut | easeIn | easeInOut | linear
 *   beatDivision — 1 = every beat, 2 = every 2nd beat, 0.5 = twice per beat
 *
 * Implementation note (export): Beat zoom is inlined into the base clip filter
 * using a crop expression rather than a separate overlay. This is required for
 * reliable per-frame evaluation in FFmpeg 8.x where overlay+enable is unreliable.
 */

import type { Clip, Track, Transform, EffectClipConfig } from '@video-editor/shared';
import { getActiveEffectConfig, getOverlappingEffectConfig, filterBeatsByDivision } from '@video-editor/shared';
import type {
  EffectDefinition,
  EffectPreviewApi,
  EffectExportApi,
  PreviewRenderContextWithAssets,
  ExportFilterContext,
  EffectSource,
  Bounds,
} from '../types';

// ─── Shared: easing functions ──────────────────────────────────────────────────

function easeOut(t: number): number { return 1 - Math.pow(1 - t, 3); }
function easeIn(t: number): number { return t * t * t; }
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ─── Shared: beat zoom scale computation ──────────────────────────────────────

/**
 * Returns the scale multiplier for beat zoom at the given time.
 * Returns 1.0 (no zoom) when outside all beat windows.
 *
 * This is the canonical implementation. The FFmpeg export replicates
 * the same math as a crop expression (iw/ZF during beat windows).
 */
export function computeBeatZoomScale(
  currentTime: number,
  beats: number[],
  cfg: EffectClipConfig
): number {
  const intensity = cfg.intensity ?? 0.08;
  const durationMs = cfg.durationMs ?? 150;
  const easing = cfg.easing ?? 'easeOut';
  const beatDivision = cfg.beatDivision ?? 1;

  const activeBeats = beatDivision === 1 ? beats : filterBeatsByDivision(beats, beatDivision);
  const dur = durationMs / 1000;

  for (const beat of activeBeats) {
    if (currentTime >= beat && currentTime < beat + dur) {
      const progress = (currentTime - beat) / dur;
      const invProgress = 1 - progress; // zoom in, then release
      let e: number;
      if (easing === 'easeOut') e = easeOut(invProgress);
      else if (easing === 'easeIn') e = easeIn(invProgress);
      else if (easing === 'easeInOut') e = easeInOut(invProgress);
      else e = invProgress; // linear
      return 1 + intensity * e;
    }
  }
  return 1;
}

// ─── Shared: master beats extraction ─────────────────────────────────────────

function getMasterBeatsFromExportContext(context: ExportFilterContext): number[] | null {
  const { masterAudioClip, beatsMap } = context;
  if (!masterAudioClip) return null;
  const masterBeats = beatsMap.get(masterAudioClip.assetId);
  if (!masterBeats) return null;
  return masterBeats.beats.map(
    (b) => masterAudioClip.timelineStart + (b - masterAudioClip.sourceStart)
  );
}

// ─── Preview implementation ───────────────────────────────────────────────────

const beatZoomPreview: EffectPreviewApi = {
  isActive(clip: Clip, track: Track, context: PreviewRenderContextWithAssets): boolean {
    const { project, currentTime, masterBeats } = context;
    if (!masterBeats || masterBeats.length === 0) return false;
    const cfg = getActiveEffectConfig(project, track, 'beatZoom', currentTime);
    return !!(cfg?.enabled);
  },

  /**
   * Phase 1: Multiply scale by the beat zoom factor before bounds are computed.
   * This causes the rendered clip to be larger during beat pulses.
   */
  modifyTransform(
    transform: Transform,
    clip: Clip,
    track: Track,
    context: PreviewRenderContextWithAssets
  ): void {
    const { project, currentTime, masterBeats } = context;
    if (!masterBeats || masterBeats.length === 0) return;
    const cfg = getActiveEffectConfig(project, track, 'beatZoom', currentTime);
    if (!cfg?.enabled) return;
    transform.scale *= computeBeatZoomScale(currentTime, masterBeats, cfg);
  },

  // No applyRender — BeatZoom only modifies the transform (Phase 1), not pixels (Phase 2).
};

// ─── Export implementation ────────────────────────────────────────────────────

const beatZoomExport: EffectExportApi = {
  isActive(clip: Clip, track: Track, context: ExportFilterContext): boolean {
    const cfg = getOverlappingEffectConfig(context.project, track, 'beatZoom', clip);
    if (!cfg?.enabled) return false;

    const masterBeats = getMasterBeatsFromExportContext(context);
    if (!masterBeats || masterBeats.length === 0) return false;

    const beatDivision = cfg.beatDivision ?? 1;
    const dividedBeats = filterBeatsByDivision(masterBeats, beatDivision);
    return dividedBeats.some((b) => b >= clip.timelineStart && b < clip.timelineEnd);
  },

  /**
   * Returns a crop fragment to inline into the base trim filter.
   *
   * The crop expression evaluates per-frame: during beat windows, it crops the
   * center (iw/ZF × ih/ZF) which the subsequent scale filter upscales to fill
   * the canvas — producing the zoom-in effect.
   *
   * This must be a base modifier (not buildFilter) because it uses the per-frame
   * `t` variable which requires eval=frame. Inlining avoids overlay+enable
   * unreliability in FFmpeg 8.x.
   */
  buildBaseModifier(clip: Clip, track: Track, context: ExportFilterContext): string | null {
    const cfg = getOverlappingEffectConfig(context.project, track, 'beatZoom', clip);
    if (!cfg) return null;

    const masterBeats = getMasterBeatsFromExportContext(context);
    if (!masterBeats) return null;

    const beatDivision = cfg.beatDivision ?? 1;
    const dividedBeats = filterBeatsByDivision(masterBeats, beatDivision);
    const beatsInClip = dividedBeats.filter(
      (b) => b >= clip.timelineStart && b < clip.timelineEnd
    );

    const pulseDur = (cfg.durationMs ?? 150) / 1000;
    const zf = (1 + (cfg.intensity ?? 0.08)).toFixed(6);

    // Build expression: sum of between() functions > 0 during any beat window
    const beatSumExpr = beatsInClip
      .map((b) => {
        const beatEnd = Math.min(b + pulseDur, clip.timelineEnd);
        return `between(t,${b.toFixed(4)},${beatEnd.toFixed(4)})`;
      })
      .join('+');

    // Crop to center iw/ZF × ih/ZF during beats; full frame otherwise
    return (
      `,crop=w='if(gt(${beatSumExpr},0),iw/${zf},iw)'` +
      `:h='if(gt(${beatSumExpr},0),ih/${zf},ih)'` +
      `:x='(iw-ow)/2':y='(ih-oh)/2'`
    );
  },

  // No buildFilter — BeatZoom inlines into the base filter via buildBaseModifier.
};

// ─── Effect Definition (exported) ─────────────────────────────────────────────

export const BeatZoomEffect: EffectDefinition = {
  type: 'beatZoom',
  preview: beatZoomPreview,
  export: beatZoomExport,
};
