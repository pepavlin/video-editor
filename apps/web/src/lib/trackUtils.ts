/**
 * Track utility functions shared between Timeline.tsx and potentially other components.
 * Keeping these as pure module-level functions ensures they are easily testable.
 */

import type { Clip, Track, Asset } from '@video-editor/shared';

// ─── Asset-track compatibility ────────────────────────────────────────────────

/**
 * Returns true if an asset of the given type can be dropped onto the given track.
 * Enforces that video assets stay on video tracks and audio assets on audio tracks,
 * preventing cross-type contamination that causes naming/type leakage.
 */
export function isAssetCompatibleWithTrack(assetType: 'video' | 'audio', track: Track): boolean {
  if (assetType === 'video') return track.type === 'video';
  if (assetType === 'audio') return track.type === 'audio';
  return false;
}

// ─── Clip intrinsic type resolution ──────────────────────────────────────────

/**
 * Determines the intrinsic media type of a clip, independent of which track it
 * currently lives on. This prevents type/name leakage when a clip has been placed
 * on the wrong track type (e.g. a video asset clip on a lyrics track).
 *
 * Priority: effectConfig > lyricsContent > textContent/rectangleStyle > assetId → track.type
 */
export function getClipMediaType(clip: Clip, track: Track, assets: Asset[]): Track['type'] {
  if (clip.effectConfig) return 'effect';
  if (clip.lyricsContent !== undefined) return 'lyrics';
  if (clip.textContent !== undefined || clip.rectangleStyle !== undefined) return 'video';
  if (clip.assetId) {
    const asset = assets.find((a) => a.id === clip.assetId);
    if (asset) return asset.type; // 'video' | 'audio'
  }
  return track.type; // fallback to track type
}
