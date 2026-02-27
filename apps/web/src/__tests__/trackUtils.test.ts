import { describe, it, expect } from 'vitest';
import type { Track, Clip } from '@video-editor/shared';
import { isCompatibleTrackType, isAssetCompatibleWithTrack } from '../lib/utils';
import { buildNewTrack } from '../hooks/useProject';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTrack(type: Track['type'], overrides: Partial<Track> = {}): Track {
  return {
    id: `track_${type}`,
    type,
    name: type,
    muted: false,
    clips: [],
    ...overrides,
  };
}

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_1',
    assetId: 'asset_1',
    trackId: 'track_1',
    timelineStart: 0,
    timelineEnd: 5,
    sourceStart: 0,
    sourceEnd: 5,
    ...overrides,
  };
}

// ─── isCompatibleTrackType ────────────────────────────────────────────────────

describe('isCompatibleTrackType', () => {
  it('video clip can move to another video track', () => {
    expect(isCompatibleTrackType('video', makeTrack('video'))).toBe(true);
  });

  it('audio clip can move to another audio track', () => {
    expect(isCompatibleTrackType('audio', makeTrack('audio'))).toBe(true);
  });

  it('lyrics clip can move to another lyrics track', () => {
    expect(isCompatibleTrackType('lyrics', makeTrack('lyrics'))).toBe(true);
  });

  it('text clip can move to another text track', () => {
    expect(isCompatibleTrackType('text', makeTrack('text'))).toBe(true);
  });

  it('video clip cannot move to audio track', () => {
    expect(isCompatibleTrackType('video', makeTrack('audio'))).toBe(false);
  });

  it('audio clip cannot move to video track', () => {
    expect(isCompatibleTrackType('audio', makeTrack('video'))).toBe(false);
  });

  it('video clip cannot move to lyrics track', () => {
    expect(isCompatibleTrackType('video', makeTrack('lyrics'))).toBe(false);
  });

  it('lyrics clip cannot move to video track', () => {
    expect(isCompatibleTrackType('lyrics', makeTrack('video'))).toBe(false);
  });

  it('effect clip cannot move to any track', () => {
    expect(isCompatibleTrackType('effect', makeTrack('video'))).toBe(false);
    expect(isCompatibleTrackType('effect', makeTrack('audio'))).toBe(false);
    expect(isCompatibleTrackType('effect', makeTrack('effect'))).toBe(false);
  });

  it('no clip type can move to effect track', () => {
    const effectTrack = makeTrack('effect');
    expect(isCompatibleTrackType('video', effectTrack)).toBe(false);
    expect(isCompatibleTrackType('audio', effectTrack)).toBe(false);
    expect(isCompatibleTrackType('lyrics', effectTrack)).toBe(false);
    expect(isCompatibleTrackType('text', effectTrack)).toBe(false);
  });
});

// ─── isAssetCompatibleWithTrack ───────────────────────────────────────────────

describe('isAssetCompatibleWithTrack', () => {
  it('video asset is compatible with video track', () => {
    expect(isAssetCompatibleWithTrack('video', makeTrack('video'))).toBe(true);
  });

  it('audio asset is compatible with audio track', () => {
    expect(isAssetCompatibleWithTrack('audio', makeTrack('audio'))).toBe(true);
  });

  it('video asset is NOT compatible with audio track', () => {
    expect(isAssetCompatibleWithTrack('video', makeTrack('audio'))).toBe(false);
  });

  it('audio asset is NOT compatible with video track', () => {
    expect(isAssetCompatibleWithTrack('audio', makeTrack('video'))).toBe(false);
  });

  it('video asset is NOT compatible with lyrics track', () => {
    expect(isAssetCompatibleWithTrack('video', makeTrack('lyrics'))).toBe(false);
  });

  it('video asset is NOT compatible with text track', () => {
    expect(isAssetCompatibleWithTrack('video', makeTrack('text'))).toBe(false);
  });

  it('video asset is NOT compatible with effect track', () => {
    expect(isAssetCompatibleWithTrack('video', makeTrack('effect'))).toBe(false);
  });

  it('audio asset is NOT compatible with lyrics track', () => {
    expect(isAssetCompatibleWithTrack('audio', makeTrack('lyrics'))).toBe(false);
  });
});

// ─── buildNewTrack ────────────────────────────────────────────────────────────

describe('buildNewTrack — naming', () => {
  const clip = makeClip();

  it('first video track is named "Video"', () => {
    const track = buildNewTrack('video', [], clip);
    expect(track.name).toBe('Video');
    expect(track.type).toBe('video');
  });

  it('second video track is named "Video 2"', () => {
    const existing = [makeTrack('video', { id: 'existing_1' })];
    const track = buildNewTrack('video', existing, clip);
    expect(track.name).toBe('Video 2');
  });

  it('third video track is named "Video 3"', () => {
    const existing = [makeTrack('video', { id: 'v1' }), makeTrack('video', { id: 'v2' })];
    const track = buildNewTrack('video', existing, clip);
    expect(track.name).toBe('Video 3');
  });

  it('first audio track is named "Audio"', () => {
    const track = buildNewTrack('audio', [], clip);
    expect(track.name).toBe('Audio');
    expect(track.type).toBe('audio');
  });

  it('second audio track is named "Audio 2"', () => {
    const existing = [makeTrack('audio', { id: 'a1' })];
    const track = buildNewTrack('audio', existing, clip);
    expect(track.name).toBe('Audio 2');
  });

  it('first lyrics track is named "Lyrics"', () => {
    const track = buildNewTrack('lyrics', [], clip);
    expect(track.name).toBe('Lyrics');
    expect(track.type).toBe('lyrics');
  });

  it('second lyrics track is named "Lyrics 2"', () => {
    const existing = [makeTrack('lyrics', { id: 'l1' })];
    const track = buildNewTrack('lyrics', existing, clip);
    expect(track.name).toBe('Lyrics 2');
  });

  it('first text track is named "Text"', () => {
    const track = buildNewTrack('text', [], clip);
    expect(track.name).toBe('Text');
    expect(track.type).toBe('text');
  });

  it('video track naming is NOT affected by presence of other track types', () => {
    // Bug scenario: should not count text/lyrics tracks when naming video tracks
    const existing = [
      makeTrack('text', { id: 't1' }),
      makeTrack('lyrics', { id: 'l1' }),
      makeTrack('audio', { id: 'a1' }),
    ];
    const track = buildNewTrack('video', existing, clip);
    expect(track.name).toBe('Video'); // First video track, not "Video 2"
  });

  it('audio track naming is NOT affected by presence of other track types', () => {
    const existing = [
      makeTrack('video', { id: 'v1' }),
      makeTrack('lyrics', { id: 'l1' }),
    ];
    const track = buildNewTrack('audio', existing, clip);
    expect(track.name).toBe('Audio'); // First audio track
  });

  it('generates unique IDs for each new track', () => {
    const t1 = buildNewTrack('video', [], clip);
    const t2 = buildNewTrack('video', [], clip);
    expect(t1.id).not.toBe(t2.id);
    expect(t1.id).toMatch(/^track_/);
    expect(t2.id).toMatch(/^track_/);
  });

  it('attaches the clip with updated trackId', () => {
    const track = buildNewTrack('video', [], clip);
    expect(track.clips).toHaveLength(1);
    expect(track.clips[0].trackId).toBe(track.id);
  });

  it('new track is not marked as master', () => {
    const track = buildNewTrack('video', [], clip);
    expect(track.isMaster).toBe(false);
  });

  it('new track is not muted', () => {
    const track = buildNewTrack('video', [], clip);
    expect(track.muted).toBe(false);
  });
});

// ─── Bug regression: lyrics track name isolation ──────────────────────────────

describe('Track type isolation — regression tests', () => {
  const clip = makeClip();

  it('dragging a video clip to new track does not produce a lyrics-named track', () => {
    // Scenario: project has a lyrics track; user drags a video clip to new area
    const existingTracks = [makeTrack('lyrics', { id: 'l1', name: 'Lyrics' })];
    const newTrack = buildNewTrack('video', existingTracks, clip);
    expect(newTrack.type).toBe('video');
    expect(newTrack.name).toBe('Video');
    expect(newTrack.name).not.toBe('Lyrics');
  });

  it('dragging a lyrics clip to new track produces a lyrics track', () => {
    const existingTracks = [makeTrack('video', { id: 'v1', name: 'Video' })];
    const newTrack = buildNewTrack('lyrics', existingTracks, clip);
    expect(newTrack.type).toBe('lyrics');
    expect(newTrack.name).toBe('Lyrics');
  });

  it('multiple video tracks are numbered independently from text tracks', () => {
    const existingTracks = [
      makeTrack('video', { id: 'v1', name: 'Video' }),
      makeTrack('text', { id: 't1', name: 'Text' }),
      makeTrack('text', { id: 't2', name: 'Text 2' }),
    ];
    const newTrack = buildNewTrack('video', existingTracks, clip);
    expect(newTrack.name).toBe('Video 2'); // 1 existing video → next is "Video 2"
  });
});
