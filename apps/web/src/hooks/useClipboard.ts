import { useState, useCallback } from 'react';
import type { Project, Clip, Track, ClipboardData, ClipboardEffectTrack } from '@video-editor/shared';
import { genId } from '@/lib/utils';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Diagonal offset (px at output resolution) applied to the pasted clip's transform. */
export const PASTE_OFFSET = 30;

// ─── Pure helpers (exported for testing) ─────────────────────────────────────

/**
 * Build clipboard data from a project and a selected clip ID.
 * Returns `null` if the clip or its parent track cannot be found.
 */
export function buildClipboardData(project: Project, clipId: string): ClipboardData | null {
  let sourceClip: Clip | undefined;
  let sourceTrack: Track | undefined;

  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) {
      sourceClip = clip;
      sourceTrack = track;
      break;
    }
  }

  if (!sourceClip || !sourceTrack) return null;

  // Deep-clone the clip (structuredClone-safe plain object)
  const clonedClip: Clip = JSON.parse(JSON.stringify(sourceClip));

  // Collect associated effect tracks (only for video-type tracks)
  const effectTracks: ClipboardEffectTrack[] = [];
  if (sourceTrack.type === 'video') {
    for (const track of project.tracks) {
      if (track.type !== 'effect' || track.parentTrackId !== sourceTrack.id) continue;

      // Find effect clips that overlap with the source clip's time range
      const overlapping = track.clips.filter(
        (ec) => ec.timelineStart < sourceClip!.timelineEnd && ec.timelineEnd > sourceClip!.timelineStart
      );
      if (overlapping.length === 0) continue;

      effectTracks.push({
        effectType: track.effectType!,
        name: track.name,
        muted: track.muted,
        clips: JSON.parse(JSON.stringify(overlapping)),
      });
    }
  }

  return {
    clip: clonedClip,
    trackType: sourceTrack.type,
    effectTracks,
  };
}

/**
 * Apply clipboard data to a project, creating a new track with the pasted clip
 * (and any associated effect tracks). Returns the updated project and the ID
 * of the newly created clip so the caller can select it.
 */
export function applyPaste(project: Project, clipboard: ClipboardData): { project: Project; newClipId: string } {
  const newTrackId = genId('track');
  const newClipId = genId('clip');

  // Build the pasted clip with new IDs and an optional diagonal offset
  const pastedClip: Clip = {
    ...clipboard.clip,
    id: newClipId,
    trackId: newTrackId,
  };

  // Apply transform offset for visual clips (video, text, lyrics, rectangles)
  if (pastedClip.transform) {
    pastedClip.transform = {
      ...pastedClip.transform,
      x: pastedClip.transform.x + PASTE_OFFSET,
      y: pastedClip.transform.y + PASTE_OFFSET,
    };
  }

  // Determine track name (numbered by existing tracks of same type)
  const TRACK_BASE_NAMES: Record<Track['type'], string> = {
    video: 'Video',
    audio: 'Audio',
    text: 'Text',
    lyrics: 'Lyrics',
    effect: 'Effect',
  };
  const baseName = TRACK_BASE_NAMES[clipboard.trackType] ?? 'Track';
  const count = project.tracks.filter((t) => t.type === clipboard.trackType).length;
  const trackName = count === 0 ? baseName : `${baseName} ${count + 1}`;

  const newTrack: Track = {
    id: newTrackId,
    type: clipboard.trackType,
    name: trackName,
    isMaster: false,
    muted: false,
    clips: [pastedClip],
  };

  // Build associated effect tracks (for video clips)
  const newEffectTracks: Track[] = [];
  for (const et of clipboard.effectTracks) {
    const effectTrackId = genId('track');
    const effectClips: Clip[] = et.clips.map((ec) => ({
      ...ec,
      id: genId('clip'),
      trackId: effectTrackId,
    }));

    const effectCount = project.tracks.filter(
      (t) => t.type === 'effect' && t.effectType === et.effectType
    ).length + newEffectTracks.filter(
      (t) => t.effectType === et.effectType
    ).length;
    const effectName = `${et.name.replace(/\s*\d+$/, '')} ${effectCount + 1}`;

    newEffectTracks.push({
      id: effectTrackId,
      type: 'effect',
      effectType: et.effectType,
      parentTrackId: newTrackId,
      name: effectName,
      muted: et.muted ?? false,
      clips: effectClips,
    });
  }

  // Insert: effect tracks first (they render above), then the new video track.
  // This matches the convention where effect tracks sit directly above their parent.
  const updatedTracks = [...project.tracks, ...newEffectTracks, newTrack];

  return {
    project: { ...project, updatedAt: new Date().toISOString(), tracks: updatedTracks },
    newClipId,
  };
}

// ─── React hook ──────────────────────────────────────────────────────────────

export function useClipboard() {
  const [clipboardData, setClipboardData] = useState<ClipboardData | null>(null);

  const copy = useCallback((project: Project, clipId: string): boolean => {
    const data = buildClipboardData(project, clipId);
    if (!data) return false;
    setClipboardData(data);
    return true;
  }, []);

  const paste = useCallback(
    (
      project: Project,
      updateProject: (updater: (p: Project) => Project) => void,
      setSelectedClipId: (id: string) => void,
    ) => {
      if (!clipboardData) return;
      const { project: updatedProject, newClipId } = applyPaste(project, clipboardData);
      updateProject(() => updatedProject);
      setSelectedClipId(newClipId);
    },
    [clipboardData]
  );

  return {
    clipboardData,
    canPaste: clipboardData !== null,
    copy,
    paste,
  };
}
