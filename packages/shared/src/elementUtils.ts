/**
 * Shared element utility functions.
 *
 * These utilities are used by effect renderers in @video-editor/elements to look up
 * effect configurations from the project data model without importing from the
 * elements package (which would create a circular dependency).
 */

import type { Project, Track, Clip, EffectClipConfig, EffectType } from './types';

/**
 * Finds the effective effect config for a given video track and effect type at a specific time.
 *
 * Looks for effect tracks whose parentTrackId matches the given video track's id,
 * then finds the effect clip active at `currentTime`.
 *
 * Used by preview renderers (isActive / modifyTransform / applyRender).
 *
 * @param project     The current project
 * @param track       The video track being rendered
 * @param effectType  The type of effect to look for (e.g. 'beatZoom', 'cutout')
 * @param currentTime The timeline position in seconds
 * @returns The active EffectClipConfig, or null if no active effect found
 */
export function getActiveEffectConfig(
  project: Project,
  track: Track,
  effectType: EffectType,
  currentTime: number
): EffectClipConfig | null {
  for (const t of project.tracks) {
    if (t.type !== 'effect') continue;
    if (t.parentTrackId !== track.id) continue;
    if (t.effectType !== effectType) continue;
    for (const clip of t.clips) {
      if (currentTime >= clip.timelineStart && currentTime < clip.timelineEnd) {
        return clip.effectConfig ?? null;
      }
    }
  }
  return null;
}

/**
 * Finds the effective effect config for a given video track and effect type that
 * OVERLAPS with the provided clip's time range.
 *
 * Used by export renderers (isActive / buildFilter) where currentTime is not available
 * but we need to check whether any effect applies during the clip's duration.
 *
 * @param project    The current project
 * @param track      The video track being exported
 * @param effectType The type of effect to look for
 * @param clip       The video clip whose time range is checked
 * @returns The overlapping EffectClipConfig, or null if none found
 */
export function getOverlappingEffectConfig(
  project: Project,
  track: Track,
  effectType: EffectType,
  clip: Clip
): EffectClipConfig | null {
  for (const t of project.tracks) {
    if (t.type !== 'effect') continue;
    if (t.parentTrackId !== track.id) continue;
    if (t.effectType !== effectType) continue;
    for (const effectClip of t.clips) {
      // Overlaps if the effect clip's range intersects with the video clip's range
      if (effectClip.timelineStart < clip.timelineEnd && effectClip.timelineEnd > clip.timelineStart) {
        return effectClip.effectConfig ?? null;
      }
    }
  }
  return null;
}

/**
 * Filters beat timestamps based on beat division setting.
 *
 * beatDivision >= 1 → keep every Nth beat (e.g. 2 = every 2nd beat)
 * beatDivision < 1  → subdivide beats (e.g. 0.5 = twice per beat)
 *
 * Mirrors the client-side filterBeatsByDivision from apps/web/src/lib/utils.ts.
 *
 * @param beats        Beat timestamps in seconds
 * @param beatDivision Division factor
 * @returns Filtered/subdivided beat timestamps
 */
export function filterBeatsByDivision(beats: number[], beatDivision: number): number[] {
  if (beatDivision <= 0) return beats;

  if (beatDivision >= 1) {
    const step = Math.round(beatDivision);
    return beats.filter((_, i) => i % step === 0);
  }

  // Sub-beat: interpolate evenly between consecutive beats
  const subdivisions = Math.round(1 / beatDivision);
  const result: number[] = [];
  for (let i = 0; i < beats.length; i++) {
    result.push(beats[i]);
    if (i < beats.length - 1) {
      const interval = beats[i + 1] - beats[i];
      for (let j = 1; j < subdivisions; j++) {
        result.push(beats[i] + (j / subdivisions) * interval);
      }
    }
  }
  return result;
}
