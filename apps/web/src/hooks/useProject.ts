import { useState, useCallback, useRef, useEffect } from 'react';
import type { Project, Clip, Track, Effect, Transform, TextStyle } from '@video-editor/shared';
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

  // Add track to project
  const addTrack = useCallback(
    (type: 'video' | 'audio', options: { name?: string; isMaster?: boolean } = {}): string => {
      const trackId = genId('track');
      updateProject((p) => {
        const count = p.tracks.filter((t) => t.type === type).length;
        const name = options.name ?? (type === 'audio' ? `Audio ${count + 1}` : `Video ${count + 1}`);
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

  // Add a text track with one clip at timelineStart
  const addTextTrack = useCallback(
    (timelineStart: number, duration: number, text: string = 'Text') => {
      const trackId = genId('track');
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
        const newTrack: Track = {
          id: trackId,
          type: 'text',
          name: 'Text',
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
              effects: [],
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
            effects: [],
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

  // Add effect to clip
  const addEffect = useCallback(
    (clipId: string, effect: Effect) => {
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === clipId ? { ...c, effects: [...c.effects, effect] } : c
          ),
        })),
      }));
    },
    [updateProject]
  );

  // Remove effect from clip
  const removeEffect = useCallback(
    (clipId: string, effectType: string) => {
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === clipId
              ? { ...c, effects: c.effects.filter((e) => e.type !== effectType) }
              : c
          ),
        })),
      }));
    },
    [updateProject]
  );

  // Update effect
  const updateEffect = useCallback(
    (clipId: string, effectType: string, updates: object) => {
      updateProject((p) => ({
        ...p,
        tracks: p.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) =>
            c.id === clipId
              ? {
                  ...c,
                  effects: c.effects.map((e) =>
                    e.type === effectType ? ({ ...e, ...updates } as Effect) : e
                  ),
                }
              : c
          ),
        })),
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

  return {
    project,
    setProject,
    saving,
    createProject,
    loadProject,
    updateProject,
    addTrack,
    addTextTrack,
    addClip,
    updateClip,
    deleteClip,
    splitClip,
    addEffect,
    removeEffect,
    updateEffect,
    findClip,
    reorderTrack,
  };
}
