import { describe, it, expect } from 'vitest';
import type { Project, Clip, Track, ClipboardData } from '@video-editor/shared';
import { buildClipboardData, applyPaste, PASTE_OFFSET } from '../hooks/useClipboard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_1',
    assetId: 'asset_1',
    trackId: 'track_v1',
    timelineStart: 0,
    timelineEnd: 5,
    sourceStart: 0,
    sourceEnd: 5,
    ...overrides,
  };
}

function makeTrack(type: Track['type'], overrides: Partial<Track> = {}): Track {
  return {
    id: `track_${type}_1`,
    type,
    name: type.charAt(0).toUpperCase() + type.slice(1),
    muted: false,
    clips: [],
    ...overrides,
  };
}

function makeProject(tracks: Track[]): Project {
  return {
    id: 'project_1',
    name: 'Test Project',
    duration: 10,
    aspectRatio: '16:9',
    outputResolution: { w: 1920, h: 1080 },
    tracks,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

// ─── buildClipboardData ──────────────────────────────────────────────────────

describe('buildClipboardData', () => {
  it('returns null when clip ID is not found', () => {
    const project = makeProject([
      makeTrack('video', { id: 'v1', clips: [makeClip({ id: 'c1', trackId: 'v1' })] }),
    ]);
    expect(buildClipboardData(project, 'nonexistent')).toBeNull();
  });

  it('returns null for an empty project', () => {
    const project = makeProject([]);
    expect(buildClipboardData(project, 'c1')).toBeNull();
  });

  it('copies a video clip with its transform', () => {
    const clip = makeClip({
      id: 'c1',
      trackId: 'v1',
      transform: { scale: 1.5, x: 10, y: 20, rotation: 45, opacity: 0.8 },
    });
    const project = makeProject([
      makeTrack('video', { id: 'v1', clips: [clip] }),
    ]);

    const result = buildClipboardData(project, 'c1');
    expect(result).not.toBeNull();
    expect(result!.trackType).toBe('video');
    expect(result!.clip.transform).toEqual({ scale: 1.5, x: 10, y: 20, rotation: 45, opacity: 0.8 });
    expect(result!.effectTracks).toEqual([]);
  });

  it('copies a text clip with textContent and textStyle', () => {
    const clip = makeClip({
      id: 'c1',
      trackId: 't1',
      assetId: '',
      textContent: 'Hello World',
      textStyle: { fontFamily: 'Arial', fontSize: 48, color: '#ffffff' },
      transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const project = makeProject([
      makeTrack('text', { id: 't1', clips: [clip] }),
    ]);

    const result = buildClipboardData(project, 'c1');
    expect(result).not.toBeNull();
    expect(result!.trackType).toBe('text');
    expect(result!.clip.textContent).toBe('Hello World');
    expect(result!.clip.textStyle).toEqual({ fontFamily: 'Arial', fontSize: 48, color: '#ffffff' });
  });

  it('copies a video clip and includes overlapping effect tracks', () => {
    const videoClip = makeClip({ id: 'vc1', trackId: 'v1', timelineStart: 2, timelineEnd: 8 });
    const effectClip = makeClip({
      id: 'ec1',
      trackId: 'eff1',
      assetId: '',
      timelineStart: 0,
      timelineEnd: 10,
      sourceStart: 0,
      sourceEnd: 10,
      effectConfig: { effectType: 'cartoon', enabled: true, edgeStrength: 0.6, colorSimplification: 0.5, saturation: 1.5 },
    });

    const project = makeProject([
      makeTrack('effect', {
        id: 'eff1',
        effectType: 'cartoon',
        parentTrackId: 'v1',
        name: 'Cartoon 1',
        clips: [effectClip],
      }),
      makeTrack('video', { id: 'v1', clips: [videoClip] }),
    ]);

    const result = buildClipboardData(project, 'vc1');
    expect(result).not.toBeNull();
    expect(result!.effectTracks).toHaveLength(1);
    expect(result!.effectTracks[0].effectType).toBe('cartoon');
    expect(result!.effectTracks[0].clips).toHaveLength(1);
    expect(result!.effectTracks[0].clips[0].effectConfig?.edgeStrength).toBe(0.6);
  });

  it('excludes effect tracks that do not overlap the copied clip', () => {
    const videoClip = makeClip({ id: 'vc1', trackId: 'v1', timelineStart: 0, timelineEnd: 3 });
    const effectClip = makeClip({
      id: 'ec1',
      trackId: 'eff1',
      assetId: '',
      timelineStart: 5,
      timelineEnd: 10,
      sourceStart: 0,
      sourceEnd: 5,
      effectConfig: { effectType: 'cartoon', enabled: true },
    });

    const project = makeProject([
      makeTrack('effect', {
        id: 'eff1',
        effectType: 'cartoon',
        parentTrackId: 'v1',
        name: 'Cartoon 1',
        clips: [effectClip],
      }),
      makeTrack('video', { id: 'v1', clips: [videoClip] }),
    ]);

    const result = buildClipboardData(project, 'vc1');
    expect(result).not.toBeNull();
    expect(result!.effectTracks).toHaveLength(0);
  });

  it('does not include effect tracks when copying an audio clip', () => {
    const audioClip = makeClip({ id: 'ac1', trackId: 'a1' });
    const project = makeProject([
      makeTrack('audio', { id: 'a1', clips: [audioClip] }),
      makeTrack('effect', {
        id: 'eff1',
        effectType: 'cartoon',
        parentTrackId: 'a1',
        clips: [makeClip({ id: 'ec1', trackId: 'eff1' })],
      }),
    ]);

    const result = buildClipboardData(project, 'ac1');
    expect(result).not.toBeNull();
    expect(result!.trackType).toBe('audio');
    expect(result!.effectTracks).toHaveLength(0);
  });

  it('deep-clones clip data (no shared references)', () => {
    const transform = { scale: 1, x: 10, y: 20, rotation: 0, opacity: 1 };
    const clip = makeClip({ id: 'c1', trackId: 'v1', transform });
    const project = makeProject([
      makeTrack('video', { id: 'v1', clips: [clip] }),
    ]);

    const result = buildClipboardData(project, 'c1');
    expect(result).not.toBeNull();
    // Mutating original should not affect clipboard
    transform.x = 999;
    expect(result!.clip.transform!.x).toBe(10);
  });

  it('copies a rectangle clip with rectangleStyle', () => {
    const clip = makeClip({
      id: 'rc1',
      trackId: 'v1',
      assetId: '',
      rectangleStyle: { color: '#ff0000', fillOpacity: 1, width: 200, height: 100, borderRadius: 10 },
      transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const project = makeProject([
      makeTrack('video', { id: 'v1', clips: [clip] }),
    ]);

    const result = buildClipboardData(project, 'rc1');
    expect(result).not.toBeNull();
    expect(result!.clip.rectangleStyle).toEqual({
      color: '#ff0000', fillOpacity: 1, width: 200, height: 100, borderRadius: 10,
    });
  });

  it('copies multiple effect tracks for the same video clip', () => {
    const videoClip = makeClip({ id: 'vc1', trackId: 'v1', timelineStart: 0, timelineEnd: 10 });
    const cartoonEffectClip = makeClip({
      id: 'ec1', trackId: 'eff1', assetId: '', timelineStart: 0, timelineEnd: 10,
      effectConfig: { effectType: 'cartoon', enabled: true },
    });
    const colorGradeEffectClip = makeClip({
      id: 'ec2', trackId: 'eff2', assetId: '', timelineStart: 0, timelineEnd: 10,
      effectConfig: { effectType: 'colorGrade', enabled: true },
    });

    const project = makeProject([
      makeTrack('effect', { id: 'eff1', effectType: 'cartoon', parentTrackId: 'v1', name: 'Cartoon 1', clips: [cartoonEffectClip] }),
      makeTrack('effect', { id: 'eff2', effectType: 'colorGrade', parentTrackId: 'v1', name: 'Color Grade 1', clips: [colorGradeEffectClip] }),
      makeTrack('video', { id: 'v1', clips: [videoClip] }),
    ]);

    const result = buildClipboardData(project, 'vc1');
    expect(result).not.toBeNull();
    expect(result!.effectTracks).toHaveLength(2);
    expect(result!.effectTracks[0].effectType).toBe('cartoon');
    expect(result!.effectTracks[1].effectType).toBe('colorGrade');
  });
});

// ─── applyPaste ──────────────────────────────────────────────────────────────

describe('applyPaste', () => {
  it('creates a new track with the pasted clip', () => {
    const clip = makeClip({
      id: 'c1', trackId: 'v1',
      transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const project = makeProject([
      makeTrack('video', { id: 'v1', clips: [clip] }),
    ]);
    const clipboardData: ClipboardData = {
      clip: JSON.parse(JSON.stringify(clip)),
      trackType: 'video',
      effectTracks: [],
    };

    const { project: result, newClipId } = applyPaste(project, clipboardData);

    // New track created in foreground (index 0)
    expect(result.tracks).toHaveLength(2);
    const newTrack = result.tracks[0];
    expect(newTrack.type).toBe('video');
    expect(newTrack.clips).toHaveLength(1);
    expect(newTrack.clips[0].id).toBe(newClipId);

    // Original track untouched
    expect(result.tracks[1].clips).toHaveLength(1);
    expect(result.tracks[1].clips[0].id).toBe('c1');
  });

  it('generates unique IDs for the pasted clip and track', () => {
    const clip = makeClip({ id: 'c1', trackId: 'v1' });
    const project = makeProject([
      makeTrack('video', { id: 'v1', clips: [clip] }),
    ]);
    const clipboardData: ClipboardData = {
      clip: JSON.parse(JSON.stringify(clip)),
      trackType: 'video',
      effectTracks: [],
    };

    const { project: result, newClipId } = applyPaste(project, clipboardData);
    const newTrack = result.tracks[0];

    expect(newClipId).not.toBe('c1');
    expect(newTrack.id).not.toBe('v1');
    expect(newTrack.clips[0].trackId).toBe(newTrack.id);
  });

  it('applies diagonal offset to transform', () => {
    const clip = makeClip({
      id: 'c1', trackId: 'v1',
      transform: { scale: 1, x: 50, y: 100, rotation: 0, opacity: 1 },
    });
    const project = makeProject([
      makeTrack('video', { id: 'v1', clips: [clip] }),
    ]);
    const clipboardData: ClipboardData = {
      clip: JSON.parse(JSON.stringify(clip)),
      trackType: 'video',
      effectTracks: [],
    };

    const { project: result } = applyPaste(project, clipboardData);
    const pastedClip = result.tracks[0].clips[0];

    expect(pastedClip.transform!.x).toBe(50 + PASTE_OFFSET);
    expect(pastedClip.transform!.y).toBe(100 + PASTE_OFFSET);
    // Other transform properties should be preserved
    expect(pastedClip.transform!.scale).toBe(1);
    expect(pastedClip.transform!.rotation).toBe(0);
    expect(pastedClip.transform!.opacity).toBe(1);
  });

  it('preserves timeline position (timelineStart/End)', () => {
    const clip = makeClip({
      id: 'c1', trackId: 'v1', timelineStart: 2.5, timelineEnd: 7.5,
      transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const project = makeProject([
      makeTrack('video', { id: 'v1', clips: [clip] }),
    ]);
    const clipboardData: ClipboardData = {
      clip: JSON.parse(JSON.stringify(clip)),
      trackType: 'video',
      effectTracks: [],
    };

    const { project: result } = applyPaste(project, clipboardData);
    const pastedClip = result.tracks[0].clips[0];

    expect(pastedClip.timelineStart).toBe(2.5);
    expect(pastedClip.timelineEnd).toBe(7.5);
    expect(pastedClip.sourceStart).toBe(0);
    expect(pastedClip.sourceEnd).toBe(5);
  });

  it('names the new track correctly when there are existing tracks of the same type', () => {
    const clip = makeClip({ id: 'c1', trackId: 'v1' });
    const project = makeProject([
      makeTrack('video', { id: 'v1', name: 'Video', clips: [clip] }),
      makeTrack('video', { id: 'v2', name: 'Video 2', clips: [] }),
    ]);
    const clipboardData: ClipboardData = {
      clip: JSON.parse(JSON.stringify(clip)),
      trackType: 'video',
      effectTracks: [],
    };

    const { project: result } = applyPaste(project, clipboardData);
    const newTrack = result.tracks[0];
    expect(newTrack.name).toBe('Video 3');
  });

  it('names the first track of its type without a number suffix', () => {
    const clip = makeClip({ id: 'c1', trackId: 'a1' });
    const project = makeProject([
      makeTrack('video', { id: 'v1', clips: [] }),
    ]);
    const clipboardData: ClipboardData = {
      clip: JSON.parse(JSON.stringify(clip)),
      trackType: 'audio',
      effectTracks: [],
    };

    const { project: result } = applyPaste(project, clipboardData);
    const newTrack = result.tracks[0];
    expect(newTrack.name).toBe('Audio');
  });

  it('creates new effect tracks linked to the new video track', () => {
    const clip = makeClip({
      id: 'vc1', trackId: 'v1',
      transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const effectClip = makeClip({
      id: 'ec1', trackId: 'eff1', assetId: '', timelineStart: 0, timelineEnd: 5,
      effectConfig: { effectType: 'cartoon', enabled: true, edgeStrength: 0.6, colorSimplification: 0.5, saturation: 1.5 },
    });

    const project = makeProject([
      makeTrack('effect', { id: 'eff1', effectType: 'cartoon', parentTrackId: 'v1', name: 'Cartoon 1', clips: [effectClip] }),
      makeTrack('video', { id: 'v1', clips: [clip] }),
    ]);

    const clipboardData = buildClipboardData(project, 'vc1')!;
    const { project: result, newClipId } = applyPaste(project, clipboardData);

    // Should have: new effect + new video + original effect + original video
    expect(result.tracks).toHaveLength(4);

    // Find the new video track (in foreground, after its effect tracks)
    const newVideoTrack = result.tracks.find(
      (t) => t.type === 'video' && t.id !== 'v1'
    )!;
    expect(newVideoTrack.type).toBe('video');
    expect(newVideoTrack.clips[0].id).toBe(newClipId);

    // Find the new effect track
    const newEffectTrack = result.tracks.find(
      (t) => t.type === 'effect' && t.parentTrackId === newVideoTrack.id
    );
    expect(newEffectTrack).toBeDefined();
    expect(newEffectTrack!.effectType).toBe('cartoon');
    expect(newEffectTrack!.clips).toHaveLength(1);
    expect(newEffectTrack!.clips[0].effectConfig?.edgeStrength).toBe(0.6);
  });

  it('generates new IDs for pasted effect clips', () => {
    const clip = makeClip({
      id: 'vc1', trackId: 'v1',
      transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const effectClip = makeClip({
      id: 'ec1', trackId: 'eff1', assetId: '',
      effectConfig: { effectType: 'cartoon', enabled: true },
    });

    const project = makeProject([
      makeTrack('effect', { id: 'eff1', effectType: 'cartoon', parentTrackId: 'v1', clips: [effectClip] }),
      makeTrack('video', { id: 'v1', clips: [clip] }),
    ]);

    const clipboardData = buildClipboardData(project, 'vc1')!;
    const { project: result } = applyPaste(project, clipboardData);

    const newEffectTrack = result.tracks.find(
      (t) => t.type === 'effect' && t.id !== 'eff1'
    );
    expect(newEffectTrack).toBeDefined();
    expect(newEffectTrack!.id).not.toBe('eff1');
    expect(newEffectTrack!.clips[0].id).not.toBe('ec1');
    expect(newEffectTrack!.clips[0].trackId).toBe(newEffectTrack!.id);
  });

  it('does not apply transform offset when clip has no transform (audio clips)', () => {
    const clip = makeClip({ id: 'ac1', trackId: 'a1' });
    const project = makeProject([
      makeTrack('audio', { id: 'a1', clips: [clip] }),
    ]);
    const clipboardData: ClipboardData = {
      clip: JSON.parse(JSON.stringify(clip)),
      trackType: 'audio',
      effectTracks: [],
    };

    const { project: result } = applyPaste(project, clipboardData);
    const pastedClip = result.tracks[0].clips[0];
    expect(pastedClip.transform).toBeUndefined();
  });

  it('preserves text content when pasting text clips', () => {
    const clip = makeClip({
      id: 'tc1', trackId: 't1', assetId: '',
      textContent: 'Hello World',
      textStyle: { fontFamily: 'Arial', fontSize: 48, color: '#ffffff' },
      transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const project = makeProject([
      makeTrack('text', { id: 't1', clips: [clip] }),
    ]);
    const clipboardData = buildClipboardData(project, 'tc1')!;
    const { project: result } = applyPaste(project, clipboardData);

    const pastedClip = result.tracks[0].clips[0];
    expect(pastedClip.textContent).toBe('Hello World');
    expect(pastedClip.textStyle).toEqual({ fontFamily: 'Arial', fontSize: 48, color: '#ffffff' });
  });

  it('does not mutate the original project', () => {
    const clip = makeClip({
      id: 'c1', trackId: 'v1',
      transform: { scale: 1, x: 50, y: 50, rotation: 0, opacity: 1 },
    });
    const project = makeProject([
      makeTrack('video', { id: 'v1', clips: [clip] }),
    ]);
    const originalTrackCount = project.tracks.length;
    const originalClipX = project.tracks[0].clips[0].transform?.x;

    const clipboardData: ClipboardData = {
      clip: JSON.parse(JSON.stringify(clip)),
      trackType: 'video',
      effectTracks: [],
    };
    applyPaste(project, clipboardData);

    expect(project.tracks).toHaveLength(originalTrackCount);
    expect(project.tracks[0].clips[0].transform?.x).toBe(originalClipX);
  });

  it('new track is not master and not muted', () => {
    const clip = makeClip({ id: 'c1', trackId: 'v1' });
    const project = makeProject([
      makeTrack('video', { id: 'v1', clips: [clip] }),
    ]);
    const clipboardData: ClipboardData = {
      clip: JSON.parse(JSON.stringify(clip)),
      trackType: 'video',
      effectTracks: [],
    };

    const { project: result } = applyPaste(project, clipboardData);
    const newTrack = result.tracks[0];
    expect(newTrack.isMaster).toBe(false);
    expect(newTrack.muted).toBe(false);
  });

  it('preserves asset reference (assetId) on pasted clip', () => {
    const clip = makeClip({ id: 'c1', trackId: 'v1', assetId: 'important_asset_42' });
    const project = makeProject([
      makeTrack('video', { id: 'v1', clips: [clip] }),
    ]);
    const clipboardData: ClipboardData = {
      clip: JSON.parse(JSON.stringify(clip)),
      trackType: 'video',
      effectTracks: [],
    };

    const { project: result } = applyPaste(project, clipboardData);
    const pastedClip = result.tracks[0].clips[0];
    expect(pastedClip.assetId).toBe('important_asset_42');
  });

  it('places the pasted track in the foreground (lower array index than existing tracks)', () => {
    const clip = makeClip({
      id: 'c1', trackId: 'v1',
      transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const project = makeProject([
      makeTrack('video', { id: 'v1', name: 'Video', clips: [clip] }),
      makeTrack('video', { id: 'v2', name: 'Video 2', clips: [] }),
    ]);
    const clipboardData: ClipboardData = {
      clip: JSON.parse(JSON.stringify(clip)),
      trackType: 'video',
      effectTracks: [],
    };

    const { project: result } = applyPaste(project, clipboardData);

    // Pasted track should be at index 0 (foreground)
    expect(result.tracks[0].id).not.toBe('v1');
    expect(result.tracks[0].id).not.toBe('v2');
    // Original tracks follow
    expect(result.tracks[1].id).toBe('v1');
    expect(result.tracks[2].id).toBe('v2');
  });

  it('places pasted effect tracks before the pasted video track (foreground)', () => {
    const clip = makeClip({
      id: 'vc1', trackId: 'v1',
      transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const effectClip = makeClip({
      id: 'ec1', trackId: 'eff1', assetId: '', timelineStart: 0, timelineEnd: 5,
      effectConfig: { effectType: 'cartoon', enabled: true },
    });
    const project = makeProject([
      makeTrack('effect', { id: 'eff1', effectType: 'cartoon', parentTrackId: 'v1', name: 'Cartoon 1', clips: [effectClip] }),
      makeTrack('video', { id: 'v1', clips: [clip] }),
    ]);

    const clipboardData = buildClipboardData(project, 'vc1')!;
    const { project: result } = applyPaste(project, clipboardData);

    // New effect track at index 0, new video track at index 1, then originals
    expect(result.tracks[0].type).toBe('effect');
    expect(result.tracks[0].id).not.toBe('eff1');
    expect(result.tracks[1].type).toBe('video');
    expect(result.tracks[1].id).not.toBe('v1');
    // Originals follow
    expect(result.tracks[2].id).toBe('eff1');
    expect(result.tracks[3].id).toBe('v1');
  });
});

// ─── Copy then Paste integration ─────────────────────────────────────────────

describe('copy → paste integration', () => {
  it('full cycle: copy video clip with effects, paste, verify independence', () => {
    const videoClip = makeClip({
      id: 'vc1', trackId: 'v1', timelineStart: 1, timelineEnd: 6, assetId: 'video_asset',
      transform: { scale: 1.2, x: 100, y: -50, rotation: 15, opacity: 0.9 },
      useClipAudio: true,
      clipAudioVolume: 0.8,
    });
    const effectClip1 = makeClip({
      id: 'ec1', trackId: 'eff1', assetId: '', timelineStart: 0, timelineEnd: 10,
      effectConfig: { effectType: 'cartoon', enabled: true, edgeStrength: 0.8, colorSimplification: 0.3, saturation: 1.2 },
    });
    const effectClip2 = makeClip({
      id: 'ec2', trackId: 'eff2', assetId: '', timelineStart: 0, timelineEnd: 10,
      effectConfig: { effectType: 'colorGrade', enabled: true, brightness: 1.1, contrast: 0.9, colorSaturation: 1.3, hue: 10, shadows: 0.1, highlights: -0.05 },
    });

    const project = makeProject([
      makeTrack('effect', { id: 'eff1', effectType: 'cartoon', parentTrackId: 'v1', name: 'Cartoon 1', clips: [effectClip1] }),
      makeTrack('effect', { id: 'eff2', effectType: 'colorGrade', parentTrackId: 'v1', name: 'Color Grade 1', clips: [effectClip2] }),
      makeTrack('video', { id: 'v1', name: 'Video', clips: [videoClip] }),
    ]);

    // Copy
    const clipboardData = buildClipboardData(project, 'vc1');
    expect(clipboardData).not.toBeNull();
    expect(clipboardData!.effectTracks).toHaveLength(2);

    // Paste
    const { project: result, newClipId } = applyPaste(project, clipboardData!);

    // Original tracks unchanged
    expect(result.tracks.filter((t) => t.id === 'v1')).toHaveLength(1);
    expect(result.tracks.filter((t) => t.id === 'eff1')).toHaveLength(1);
    expect(result.tracks.filter((t) => t.id === 'eff2')).toHaveLength(1);

    // New video track (in foreground, after its effect tracks)
    const newVideoTrack = result.tracks.find(
      (t) => t.type === 'video' && t.id !== 'v1'
    )!;
    expect(newVideoTrack.type).toBe('video');
    expect(newVideoTrack.name).toBe('Video 2');

    // New clip properties
    const pastedClip = newVideoTrack.clips[0];
    expect(pastedClip.id).toBe(newClipId);
    expect(pastedClip.assetId).toBe('video_asset');
    expect(pastedClip.timelineStart).toBe(1);
    expect(pastedClip.timelineEnd).toBe(6);
    expect(pastedClip.useClipAudio).toBe(true);
    expect(pastedClip.clipAudioVolume).toBe(0.8);
    expect(pastedClip.transform!.x).toBe(100 + PASTE_OFFSET);
    expect(pastedClip.transform!.y).toBe(-50 + PASTE_OFFSET);
    expect(pastedClip.transform!.scale).toBe(1.2);
    expect(pastedClip.transform!.rotation).toBe(15);
    expect(pastedClip.transform!.opacity).toBe(0.9);

    // New effect tracks linked to new video track
    const newEffectTracks = result.tracks.filter(
      (t) => t.type === 'effect' && t.parentTrackId === newVideoTrack.id
    );
    expect(newEffectTracks).toHaveLength(2);

    const newCartoon = newEffectTracks.find((t) => t.effectType === 'cartoon');
    expect(newCartoon).toBeDefined();
    expect(newCartoon!.clips[0].effectConfig?.edgeStrength).toBe(0.8);

    const newColorGrade = newEffectTracks.find((t) => t.effectType === 'colorGrade');
    expect(newColorGrade).toBeDefined();
    expect(newColorGrade!.clips[0].effectConfig?.brightness).toBe(1.1);
  });

  it('pasting multiple times creates multiple independent copies', () => {
    const clip = makeClip({
      id: 'c1', trackId: 'v1',
      transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const project = makeProject([
      makeTrack('video', { id: 'v1', name: 'Video', clips: [clip] }),
    ]);
    const clipboardData = buildClipboardData(project, 'c1')!;

    // First paste
    const { project: afterFirst, newClipId: id1 } = applyPaste(project, clipboardData);
    expect(afterFirst.tracks).toHaveLength(2);

    // Second paste (on updated project)
    const { project: afterSecond, newClipId: id2 } = applyPaste(afterFirst, clipboardData);
    expect(afterSecond.tracks).toHaveLength(3);

    // All clip IDs are unique
    expect(id1).not.toBe(id2);
    expect(id1).not.toBe('c1');
    expect(id2).not.toBe('c1');

    // Track names increment
    const trackNames = afterSecond.tracks.map((t) => t.name);
    expect(trackNames).toContain('Video');
    expect(trackNames).toContain('Video 2');
    expect(trackNames).toContain('Video 3');
  });
});
