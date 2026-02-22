import { useState, useCallback, useRef, useEffect } from 'react';
import type { Project, Clip, Track, Transform, TextStyle, EffectClipConfig, EffectType, LyricsStyle } from '@video-editor/shared';
import * as api from '@/lib/api';
import { genId } from '@/lib/utils';

const DEFAULT_TRANSFORM: Transform = { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 };

const AUTOSAVE_DELAY = 1500;

export function useProject() {
  const [project, setProjectRaw] = useState<Project | null>(null);
  const [saving, setSaving] = useState(false);
  const autosaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const projectRef = useRef<Project | null>(null);

  const setProject = useCallback((p: Project | ((prev: Project | null) => Project | null)) => {
    setProjectRaw((prev) => {
      const next = typeof p === 'function' ? p(prev) : p;
      projectRef.current = next;
      return next;
    });
  }, []);

  // Autosave
  useEffect(() => {
    if (!project) return;
    if (autosaveRef.current) clearTimeout(autosaveRef.current);
    autosaveRef.current = setTimeout(async () => {
      try {
        setSaving(true);
        await api.saveProject(project);
      } catch (e) {
        console.error('Autosave failed', e);
      } finally {
        setSaving(false);
      }
    }, AUTOSAVE_DELAY);
  }, [project]);

  // Create new project
  const createProject = useCallback(async (name: string) => {
    const { project: p } = await api.createProject(name);
    setProject(p);
    return p;
  }, [setProject]);

  // Load project
  const loadProject = useCallback(async (id: string) => {
    const { project: p } = await api.loadProject(id);
    setProject(p);
    return p;
  }, [setProject]);

  // Compute duration from tracks; auto-stretch work area if not manual
  const recomputeDuration = useCallback((p: Project): Project => {
    let maxEnd = 0;
    for (const track of p.tracks) {
      for (const clip of track.clips) {
        if (clip.timelineEnd > maxEnd) maxEnd = clip.timelineEnd;
      }
    }
    const newDuration = Math.max(maxEnd, 0.1);
    const result: Project = { ...p, duration: newDuration };

    // Auto-stretch work area end to match project duration when not manually set
    if (!p.workArea || !p.workArea.isManual) {
      result.workArea = { start: p.workArea?.start ?? 0, end: newDuration, isManual: false };
    }

    return result;
  }, []);

  // Update project (generic)
  const updateProject = useCallback((updater: (p: Project) => Project) => {
    setProject((prev) => {
      if (!prev) return prev;
      const updated = updater(prev);
      return recomputeDuration(updated);
    });
  }, [setProject, recomputeDuration]);

  // Add an effect track with one default clip at timelineStart
  // parentTrackId: if provided, the new effect track is inserted directly before that video track
  const addEffectTrack = useCallback(
    (effectType: EffectType, timelineStart: number, duration: number, parentTrackId?: string): string => {
      const trackId = genId('track');
      const clipId = genId('clip');

      const defaultConfig: EffectClipConfig = (() => {
        switch (effectType) {
          case 'beatZoom':
            return { effectType: 'beatZoom', enabled: true, intensity: 0.08, durationMs: 150, easing: 'easeOut' as const, beatDivision: 1 };
          case 'cutout':
            return { effectType: 'cutout', enabled: true, background: { type: 'solid' as const, color: '#000000' }, maskStatus: 'pending' as const };
          case 'headStabilization':
            return { effectType: 'headStabilization', enabled: true, smoothingX: 0.7, smoothingY: 0.7, smoothingZ: 0.0, stabilizationStatus: 'pending' as const };
          case 'cartoon':
            return { effectType: 'cartoon', enabled: true, edgeStrength: 0.6, colorSimplification: 0.5, saturation: 1.5 };
          case 'colorGrade':
            return { effectType: 'colorGrade', enabled: true, contrast: 1, brightness: 1, colorSaturation: 1, hue: 0, shadows: 0, highlights: 0 };
        }
      })();

      const effectNames: Record<EffectType, string> = {
        beatZoom: 'Beat Zoom',
        cutout: 'Cutout',
        headStabilization: 'Head Stab',
        cartoon: 'Cartoon',
        colorGrade: 'Color Grade',
      };

      updateProject((p) => {
        // Resolve the parent video track: prefer the provided parentTrackId,
        // fall back to the first video track in the project.
        const tracks = [...p.tracks];
        const resolvedParentId = (parentTrackId && tracks.some((t) => t.id === parentTrackId))
          ? parentTrackId
          : tracks.find((t) => t.type === 'video')?.id;

        const count = p.tracks.filter((t) => t.type === 'effect' && t.effectType === effectType).length;
        const name = `${effectNames[effectType]} ${count + 1}`;
        const newTrack: Track = {
          id: trackId,
          type: 'effect',
          effectType,
          parentTrackId: resolvedParentId,
          name,
          muted: false,
          clips: [
            {
              id: clipId,
              assetId: '',
              trackId,
              timelineStart,
              timelineEnd: timelineStart + duration,
              sourceStart: 0,
              sourceEnd: duration,
              effectConfig: defaultConfig,
            },
          ],
        };

        // Insert the effect track directly above (visually) its parent video track.
        // "Above" means at a smaller array index → the row appears higher in the timeline.
        // We insert right before the parent video track so effect tracks for a given
        // video track cluster just above it. If no parent is found, append at end.
        if (resolvedParentId) {
          const parentIdx = tracks.findIndex((t) => t.id === resolvedParentId);
          if (parentIdx >= 0) {
            tracks.splice(parentIdx, 0, newTrack);
            return { ...p, tracks };
          }
        }
        return { ...p, tracks: [...tracks, newTrack] };
      });
      return clipId;
    },
    [updateProject]
  );

  // Update effectConfig on an effect clip
  const updateEffectClipConfig = useCallback(
    (clipId: string, updates: Partial<EffectClipConfig>) => {
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === clipId && c.effectConfig
              ? { ...c, effectConfig: { ...c.effectConfig, ...updates } as EffectClipConfig }
              : c
          ),
        })),
      }));
    },
    [updateProject]
  );

  // Add track to project
  const addTrack = useCallback(
    (type: 'video' | 'audio', options: { name?: string; isMaster?: boolean } = {}): string => {
      const trackId = genId('track');
      updateProject((p) => {
        const count = p.tracks.filter((t) => t.type === type || (type === 'video' && t.type === 'text')).length;
        const baseName = type === 'audio' ? 'Audio' : 'Video';
        const name = options.name ?? (count === 0 ? baseName : `${baseName} ${count + 1}`);
        const newTrack: Track = {
          id: trackId,
          type,
          name,
          isMaster: options.isMaster ?? false,
          muted: false,
          clips: [],
        };
        return { ...p, tracks: [...p.tracks, newTrack] };
      });
      return trackId;
    },
    [updateProject]
  );

  // Add a text clip to a video track (or create a new video track if none exists).
  // targetTrackId optionally pins the clip to a specific track.
  const addTextTrack = useCallback(
    (timelineStart: number, duration: number, text: string = 'Text', targetTrackId?: string) => {
      const clipId = genId('clip');
      const defaultStyle: TextStyle = {
        fontFamily: 'Arial',
        fontSize: 96,
        color: '#ffffff',
        bold: true,
        italic: false,
        align: 'center',
      };
      updateProject((p) => {
        // Find target video track: prefer explicit, then first video track
        const videoTrack = targetTrackId
          ? p.tracks.find((t) => t.id === targetTrackId)
          : p.tracks.find((t) => t.type === 'video' || t.type === 'text');

        if (videoTrack) {
          // Add text clip to existing video track
          const textClip: Clip = {
            id: clipId,
            assetId: '',
            trackId: videoTrack.id,
            timelineStart,
            timelineEnd: timelineStart + duration,
            sourceStart: 0,
            sourceEnd: duration,
            textContent: text,
            textStyle: defaultStyle,
            transform: { ...DEFAULT_TRANSFORM },
          };
          return {
            ...p,
            tracks: p.tracks.map((t) =>
              t.id === videoTrack.id ? { ...t, clips: [...t.clips, textClip] } : t
            ),
          };
        }

        // No video track exists – create a new "Video" track with the text clip
        const newTrackId = genId('track');
        const count = p.tracks.filter((t) => t.type === 'video').length;
        const baseName = 'Video';
        const trackName = count === 0 ? baseName : `${baseName} ${count + 1}`;
        const newTrack: Track = {
          id: newTrackId,
          type: 'video',
          name: trackName,
          muted: false,
          clips: [
            {
              id: clipId,
              assetId: '',
              trackId: newTrackId,
              timelineStart,
              timelineEnd: timelineStart + duration,
              sourceStart: 0,
              sourceEnd: duration,
              textContent: text,
              textStyle: defaultStyle,
              transform: { ...DEFAULT_TRANSFORM },
            },
          ],
        };
        return { ...p, tracks: [...p.tracks, newTrack] };
      });
      return clipId;
    },
    [updateProject]
  );

  // Add a lyrics track with one clip at timelineStart
  const addLyricsTrack = useCallback(
    (timelineStart: number, duration: number, text: string = '') => {
      const trackId = genId('track');
      const clipId = genId('clip');
      const defaultStyle: LyricsStyle = {
        fontSize: 48,
        color: '#ffffff',
        highlightColor: '#FFE600',
        position: 'bottom',
        wordsPerChunk: 3,
      };
      updateProject((p) => {
        const count = p.tracks.filter((t) => t.type === 'lyrics').length;
        const newTrack: Track = {
          id: trackId,
          type: 'lyrics',
          name: `Lyrics ${count + 1}`,
          muted: false,
          clips: [
            {
              id: clipId,
              assetId: '',
              trackId,
              timelineStart,
              timelineEnd: timelineStart + duration,
              sourceStart: 0,
              sourceEnd: duration,
              lyricsContent: text,
              lyricsStyle: defaultStyle,
              lyricsAlignStatus: 'idle',
              transform: { ...DEFAULT_TRANSFORM },
            },
          ],
        };
        return { ...p, tracks: [...p.tracks, newTrack] };
      });
      return clipId;
    },
    [updateProject]
  );

  // Add clip to track
  const addClip = useCallback(
    (trackId: string, assetId: string, timelineStart: number, duration: number) => {
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) => {
          if (t.id !== trackId) return t;
          const isVideo = t.type === 'video';
          const clip: Clip = {
            id: genId('clip'),
            assetId,
            trackId,
            timelineStart,
            timelineEnd: timelineStart + duration,
            sourceStart: 0,
            sourceEnd: duration,
            // Video-only fields:
            ...(isVideo && {
              useClipAudio: false,
              clipAudioVolume: 1,
              transform: { ...DEFAULT_TRANSFORM },
            }),
          };
          return { ...t, clips: [...t.clips, clip] };
        }),
      }));
    },
    [updateProject]
  );

  // Update clip
  const updateClip = useCallback(
    (clipId: string, updates: Partial<Clip>) => {
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === clipId ? { ...c, ...updates } : c
          ),
        })),
      }));
    },
    [updateProject]
  );

  // Delete clip
  const deleteClip = useCallback(
    (clipId: string) => {
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) => ({
          ...t,
          clips: t.clips.filter((c) => c.id !== clipId),
        })),
      }));
    },
    [updateProject]
  );

  // Split clip at time
  const splitClip = useCallback(
    (clipId: string, splitTime: number) => {
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) => {
          const idx = t.clips.findIndex((c) => c.id === clipId);
          if (idx < 0) return t;
          const clip = t.clips[idx];
          if (splitTime <= clip.timelineStart || splitTime >= clip.timelineEnd) return t;

          const ratio = (splitTime - clip.timelineStart) / (clip.timelineEnd - clip.timelineStart);
          const splitSource = clip.sourceStart + ratio * (clip.sourceEnd - clip.sourceStart);

          const left: Clip = { ...clip, timelineEnd: splitTime, sourceEnd: splitSource };
          const right: Clip = {
            ...clip,
            id: genId('clip'),
            timelineStart: splitTime,
            sourceStart: splitSource,
          };

          const newClips = [...t.clips];
          newClips.splice(idx, 1, left, right);
          return { ...t, clips: newClips };
        }),
      }));
    },
    [updateProject]
  );

  // Find clip by id
  const findClip = useCallback(
    (clipId: string): Clip | undefined => {
      if (!project) return undefined;
      for (const t of project.tracks) {
        const c = t.clips.find((c) => c.id === clipId);
        if (c) return c;
      }
      return undefined;
    },
    [project]
  );

  // Reorder tracks by index
  const reorderTrack = useCallback(
    (fromIdx: number, toIdx: number) => {
      updateProject((p) => {
        const tracks = [...p.tracks];
        const [moved] = tracks.splice(fromIdx, 1);
        tracks.splice(toIdx, 0, moved);
        return { ...p, tracks };
      });
    },
    [updateProject]
  );

  // Move clip from its current track to a different existing track
  const moveClipToTrack = useCallback(
    (clipId: string, toTrackId: string, timelineStart: number, timelineEnd: number) => {
      updateProject((p) => {
        let movedClip: Clip | null = null;
        const tracksWithoutClip = p.tracks.map((t) => {
          const idx = t.clips.findIndex((c) => c.id === clipId);
          if (idx >= 0) {
            movedClip = { ...t.clips[idx], trackId: toTrackId, timelineStart, timelineEnd };
            return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
          }
          return t;
        });
        if (!movedClip) return p;
        return {
          ...p,
          tracks: tracksWithoutClip.map((t) =>
            t.id === toTrackId ? { ...t, clips: [...t.clips, movedClip!] } : t
          ),
        };
      });
    },
    [updateProject]
  );

  // Helper to build a new Track object for the given type
  function buildNewTrack(newTrackType: Track['type'], existingTracks: Track[], foundClip: Clip): Track {
    const newTrackId = `track_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const count = existingTracks.filter((t) => t.type === newTrackType).length;
    const baseName =
      newTrackType === 'audio' ? 'Audio'
      : newTrackType === 'text' ? 'Text'
      : newTrackType === 'lyrics' ? 'Lyrics'
      : 'Video';
    const name = count === 0 ? baseName : `${baseName} ${count + 1}`;
    return {
      id: newTrackId,
      type: newTrackType,
      name,
      isMaster: false,
      muted: false,
      clips: [{ ...foundClip, trackId: newTrackId }],
    };
  }

  // Move clip to a brand-new track appended at the end
  const moveClipToNewTrack = useCallback(
    (clipId: string, newTrackType: Track['type'], timelineStart: number, timelineEnd: number) => {
      updateProject((p) => {
        let movedClip: Clip | null = null;
        const tracksWithoutClip = p.tracks.map((t) => {
          const idx = t.clips.findIndex((c) => c.id === clipId);
          if (idx >= 0) {
            movedClip = { ...t.clips[idx], timelineStart, timelineEnd };
            return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
          }
          return t;
        });
        if (!movedClip) return p;
        const newTrack = buildNewTrack(newTrackType, p.tracks, movedClip);
        return { ...p, tracks: [...tracksWithoutClip, newTrack] };
      });
    },
    [updateProject]
  );

  // Move clip to a brand-new track inserted at a specific index (insertAfterIdx = -1 means before all)
  const moveClipToNewTrackAt = useCallback(
    (clipId: string, newTrackType: Track['type'], timelineStart: number, timelineEnd: number, insertAfterIdx: number) => {
      updateProject((p) => {
        let movedClip: Clip | null = null;
        const tracksWithoutClip = p.tracks.map((t) => {
          const idx = t.clips.findIndex((c) => c.id === clipId);
          if (idx >= 0) {
            movedClip = { ...t.clips[idx], timelineStart, timelineEnd };
            return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
          }
          return t;
        });
        if (!movedClip) return p;
        const newTrack = buildNewTrack(newTrackType, p.tracks, movedClip);
        const insertAt = Math.max(0, Math.min(insertAfterIdx + 1, tracksWithoutClip.length));
        const newTracks = [...tracksWithoutClip];
        newTracks.splice(insertAt, 0, newTrack);
        return { ...p, tracks: newTracks };
      });
    },
    [updateProject]
  );

  return {
    project,
    setProject,
    saving,
    createProject,
    loadProject,
    updateProject,
    addTrack,
    addTextTrack,
    addLyricsTrack,
    addEffectTrack,
    updateEffectClipConfig,
    addClip,
    updateClip,
    deleteClip,
    splitClip,
    findClip,
    reorderTrack,
    moveClipToTrack,
    moveClipToNewTrack,
    moveClipToNewTrackAt,
  };
}
