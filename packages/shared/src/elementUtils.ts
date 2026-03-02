/**
 * Element utility functions for shared use across packages.
 *
 * These helpers look up effect configuration from the project data model.
 * They are used by effect implementations in @video-editor/elements to find
 * the active EffectClipConfig for a given video track and effect type.
 */

import type { Project, Track, Clip, EffectClipConfig, EffectType } from './types';

// ─── Effect track lookup ──────────────────────────────────────────────────────

/**
 * Finds the effect track for the given video track and effect type.
 * Returns the first effect track in project.tracks where:
 *   - track.type === 'effect'
 *   - track.effectType === effectType
 *   - track.parentTrackId === videoTrack.id
 */
function findEffectTrack(
  project: Project,
  videoTrack: Track,
  effectType: EffectType
): Track | undefined {
  return project.tracks.find(
    (t) =>
      t.type === 'effect' &&
      t.effectType === effectType &&
      t.parentTrackId === videoTrack.id
  );
}

// ─── Active effect config (preview side) ─────────────────────────────────────

/**
 * Returns the EffectClipConfig for the effect of `effectType` that is active
 * at `currentTime` on the effect track linked to `videoTrack`.
 *
 * "Active" means currentTime falls within [clip.timelineStart, clip.timelineEnd).
 *
 * Returns null if:
 *   - No effect track of the given type is linked to videoTrack
 *   - No clip is active at currentTime
 *   - The active clip has no effectConfig
 */
export function getActiveEffectConfig(
  project: Project,
  videoTrack: Track,
  effectType: EffectType,
  currentTime: number
): EffectClipConfig | null {
  const effectTrack = findEffectTrack(project, videoTrack, effectType);
  if (!effectTrack) return null;

  const activeClip = effectTrack.clips.find(
    (c) => currentTime >= c.timelineStart && currentTime < c.timelineEnd
  );
  return activeClip?.effectConfig ?? null;
}

// ─── Overlapping effect config (export side) ──────────────────────────────────

/**
 * Returns the EffectClipConfig for the effect of `effectType` whose clip
 * overlaps with `videoClip` on the effect track linked to `videoTrack`.
 *
 * "Overlapping" means the effect clip's time range intersects the video clip's
 * time range: effectClip.timelineStart < videoClip.timelineEnd AND
 *              effectClip.timelineEnd   > videoClip.timelineStart
 *
 * Returns null if:
 *   - No effect track of the given type is linked to videoTrack
 *   - No effect clip overlaps with videoClip
 *   - The overlapping clip has no effectConfig
 */
export function getOverlappingEffectConfig(
  project: Project,
  videoTrack: Track,
  effectType: EffectType,
  videoClip: Clip
): EffectClipConfig | null {
  const effectTrack = findEffectTrack(project, videoTrack, effectType);
  if (!effectTrack) return null;

  const overlappingClip = effectTrack.clips.find(
    (c) =>
      c.timelineStart < videoClip.timelineEnd &&
      c.timelineEnd > videoClip.timelineStart
  );
  return overlappingClip?.effectConfig ?? null;
}

// ─── Beat division filter ──────────────────────────────────────────────────────

/**
 * Filters a beat array based on the beatDivision parameter.
 *
 * beatDivision controls how many beats trigger an effect:
 *   >= 1  → use every Nth beat (1=every beat, 2=every 2nd, 4=every 4th, …)
 *   < 1   → interpolate sub-beat triggers (0.5=twice per beat, 0.25=4x per beat)
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
