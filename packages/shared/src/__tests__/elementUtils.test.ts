/**
 * Unit tests for elementUtils.ts
 *
 * Tests getActiveEffectConfig, getOverlappingEffectConfig, and filterBeatsByDivision.
 */

import { describe, it, expect } from 'vitest';
import {
  getActiveEffectConfig,
  getOverlappingEffectConfig,
  filterBeatsByDivision,
} from '../elementUtils';
import type { Project, Track, Clip } from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeProject(tracks: Track[]): Project {
  return {
    id: 'proj1',
    name: 'Test',
    duration: 10,
    aspectRatio: '9:16',
    outputResolution: { w: 1080, h: 1920 },
    tracks,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
}

function makeVideoTrack(id = 'video1'): Track {
  return { id, type: 'video', name: 'Video', clips: [] };
}

function makeEffectTrack(
  parentTrackId: string,
  effectType: 'beatZoom' | 'cutout' | 'cartoon' | 'colorGrade',
  clips: Clip[] = []
): Track {
  return {
    id: `effect-${effectType}`,
    type: 'effect',
    name: effectType,
    effectType,
    parentTrackId,
    clips,
  };
}

function makeEffectClip(
  timelineStart: number,
  timelineEnd: number,
  effectType: 'beatZoom' | 'cutout' | 'cartoon' | 'colorGrade'
): Clip {
  return {
    id: `effect-clip-${timelineStart}`,
    assetId: 'asset1',
    trackId: 'effect-track',
    timelineStart,
    timelineEnd,
    sourceStart: 0,
    sourceEnd: timelineEnd - timelineStart,
    effectConfig: { effectType, enabled: true },
  };
}

function makeVideoClip(timelineStart: number, timelineEnd: number): Clip {
  return {
    id: 'video-clip',
    assetId: 'asset1',
    trackId: 'video1',
    timelineStart,
    timelineEnd,
    sourceStart: 0,
    sourceEnd: timelineEnd - timelineStart,
  };
}

// ─── getActiveEffectConfig ─────────────────────────────────────────────────────

describe('getActiveEffectConfig', () => {
  it('returns null when no effect track exists for the video track', () => {
    const videoTrack = makeVideoTrack('video1');
    const project = makeProject([videoTrack]);
    const result = getActiveEffectConfig(project, videoTrack, 'beatZoom', 2.0);
    expect(result).toBeNull();
  });

  it('returns null when effect track exists but no clip is active at currentTime', () => {
    const videoTrack = makeVideoTrack('video1');
    const effectClip = makeEffectClip(5, 8, 'beatZoom');
    const effectTrack = makeEffectTrack('video1', 'beatZoom', [effectClip]);
    const project = makeProject([videoTrack, effectTrack]);

    // Before clip start
    expect(getActiveEffectConfig(project, videoTrack, 'beatZoom', 2.0)).toBeNull();
    // After clip end
    expect(getActiveEffectConfig(project, videoTrack, 'beatZoom', 9.0)).toBeNull();
  });

  it('returns effectConfig when currentTime is within a clip', () => {
    const videoTrack = makeVideoTrack('video1');
    const effectClip = makeEffectClip(2, 6, 'beatZoom');
    const effectTrack = makeEffectTrack('video1', 'beatZoom', [effectClip]);
    const project = makeProject([videoTrack, effectTrack]);

    const result = getActiveEffectConfig(project, videoTrack, 'beatZoom', 4.0);
    expect(result).not.toBeNull();
    expect(result?.effectType).toBe('beatZoom');
    expect(result?.enabled).toBe(true);
  });

  it('returns effectConfig when currentTime equals clip start (inclusive)', () => {
    const videoTrack = makeVideoTrack('video1');
    const effectClip = makeEffectClip(3, 7, 'cartoon');
    const effectTrack = makeEffectTrack('video1', 'cartoon', [effectClip]);
    const project = makeProject([videoTrack, effectTrack]);

    const result = getActiveEffectConfig(project, videoTrack, 'cartoon', 3.0);
    expect(result).not.toBeNull();
    expect(result?.effectType).toBe('cartoon');
  });

  it('returns null when currentTime equals clip end (exclusive)', () => {
    const videoTrack = makeVideoTrack('video1');
    const effectClip = makeEffectClip(3, 7, 'cartoon');
    const effectTrack = makeEffectTrack('video1', 'cartoon', [effectClip]);
    const project = makeProject([videoTrack, effectTrack]);

    const result = getActiveEffectConfig(project, videoTrack, 'cartoon', 7.0);
    expect(result).toBeNull();
  });

  it('does not match an effect track linked to a different video track', () => {
    const videoTrack1 = makeVideoTrack('video1');
    const videoTrack2 = makeVideoTrack('video2');
    const effectClip = makeEffectClip(0, 10, 'cutout');
    // Effect track is linked to video2, not video1
    const effectTrack = makeEffectTrack('video2', 'cutout', [effectClip]);
    const project = makeProject([videoTrack1, videoTrack2, effectTrack]);

    expect(getActiveEffectConfig(project, videoTrack1, 'cutout', 5.0)).toBeNull();
    expect(getActiveEffectConfig(project, videoTrack2, 'cutout', 5.0)).not.toBeNull();
  });

  it('does not match an effect track with a different effectType', () => {
    const videoTrack = makeVideoTrack('video1');
    const effectClip = makeEffectClip(0, 10, 'cartoon');
    const effectTrack = makeEffectTrack('video1', 'cartoon', [effectClip]);
    const project = makeProject([videoTrack, effectTrack]);

    // Looking for beatZoom, but track is cartoon
    expect(getActiveEffectConfig(project, videoTrack, 'beatZoom', 5.0)).toBeNull();
    // Correct effectType works
    expect(getActiveEffectConfig(project, videoTrack, 'cartoon', 5.0)).not.toBeNull();
  });

  it('returns null for clip with no effectConfig', () => {
    const videoTrack = makeVideoTrack('video1');
    const clipWithoutConfig: Clip = {
      id: 'no-config-clip',
      assetId: 'asset1',
      trackId: 'effect-beatZoom',
      timelineStart: 0,
      timelineEnd: 10,
      sourceStart: 0,
      sourceEnd: 10,
      // no effectConfig
    };
    const effectTrack = makeEffectTrack('video1', 'beatZoom', [clipWithoutConfig]);
    const project = makeProject([videoTrack, effectTrack]);

    expect(getActiveEffectConfig(project, videoTrack, 'beatZoom', 5.0)).toBeNull();
  });
});

// ─── getOverlappingEffectConfig ────────────────────────────────────────────────

describe('getOverlappingEffectConfig', () => {
  it('returns null when no effect track exists', () => {
    const videoTrack = makeVideoTrack('video1');
    const videoClip = makeVideoClip(0, 5);
    const project = makeProject([videoTrack]);

    expect(getOverlappingEffectConfig(project, videoTrack, 'beatZoom', videoClip)).toBeNull();
  });

  it('returns effectConfig when effect clip overlaps the video clip', () => {
    const videoTrack = makeVideoTrack('video1');
    const videoClip = makeVideoClip(2, 6);
    const effectClip = makeEffectClip(3, 8, 'beatZoom');
    const effectTrack = makeEffectTrack('video1', 'beatZoom', [effectClip]);
    const project = makeProject([videoTrack, effectTrack]);

    const result = getOverlappingEffectConfig(project, videoTrack, 'beatZoom', videoClip);
    expect(result).not.toBeNull();
    expect(result?.effectType).toBe('beatZoom');
  });

  it('returns null when effect clip ends exactly at video clip start (no overlap)', () => {
    const videoTrack = makeVideoTrack('video1');
    const videoClip = makeVideoClip(5, 8);
    const effectClip = makeEffectClip(0, 5, 'beatZoom'); // ends at 5, clip starts at 5
    const effectTrack = makeEffectTrack('video1', 'beatZoom', [effectClip]);
    const project = makeProject([videoTrack, effectTrack]);

    expect(getOverlappingEffectConfig(project, videoTrack, 'beatZoom', videoClip)).toBeNull();
  });

  it('returns null when effect clip starts exactly at video clip end (no overlap)', () => {
    const videoTrack = makeVideoTrack('video1');
    const videoClip = makeVideoClip(0, 5);
    const effectClip = makeEffectClip(5, 8, 'beatZoom'); // starts at 5, clip ends at 5
    const effectTrack = makeEffectTrack('video1', 'beatZoom', [effectClip]);
    const project = makeProject([videoTrack, effectTrack]);

    expect(getOverlappingEffectConfig(project, videoTrack, 'beatZoom', videoClip)).toBeNull();
  });

  it('returns effectConfig when effect clip fully contains the video clip', () => {
    const videoTrack = makeVideoTrack('video1');
    const videoClip = makeVideoClip(3, 6);
    const effectClip = makeEffectClip(0, 10, 'cutout');
    const effectTrack = makeEffectTrack('video1', 'cutout', [effectClip]);
    const project = makeProject([videoTrack, effectTrack]);

    expect(getOverlappingEffectConfig(project, videoTrack, 'cutout', videoClip)).not.toBeNull();
  });

  it('returns effectConfig when video clip fully contains the effect clip', () => {
    const videoTrack = makeVideoTrack('video1');
    const videoClip = makeVideoClip(0, 10);
    const effectClip = makeEffectClip(3, 6, 'cartoon');
    const effectTrack = makeEffectTrack('video1', 'cartoon', [effectClip]);
    const project = makeProject([videoTrack, effectTrack]);

    expect(getOverlappingEffectConfig(project, videoTrack, 'cartoon', videoClip)).not.toBeNull();
  });

  it('returns first overlapping clip when multiple effect clips are present', () => {
    const videoTrack = makeVideoTrack('video1');
    const videoClip = makeVideoClip(4, 7);
    const effectClip1 = makeEffectClip(0, 5, 'beatZoom');
    const effectClip2: Clip = {
      ...makeEffectClip(5, 10, 'beatZoom'),
      id: 'effect-clip-5',
      effectConfig: { effectType: 'beatZoom', enabled: false, intensity: 0.2 },
    };
    const effectTrack = makeEffectTrack('video1', 'beatZoom', [effectClip1, effectClip2]);
    const project = makeProject([videoTrack, effectTrack]);

    // videoClip [4,7) overlaps effectClip1 [0,5) and effectClip2 [5,10)
    const result = getOverlappingEffectConfig(project, videoTrack, 'beatZoom', videoClip);
    // Returns the first matching one
    expect(result?.effectType).toBe('beatZoom');
    expect(result?.enabled).toBe(true); // effectClip1
  });
});

// ─── filterBeatsByDivision ─────────────────────────────────────────────────────

describe('filterBeatsByDivision', () => {
  const beats = [0, 1, 2, 3, 4, 5];

  it('returns all beats when beatDivision is 1', () => {
    expect(filterBeatsByDivision(beats, 1)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('returns every 2nd beat when beatDivision is 2', () => {
    expect(filterBeatsByDivision(beats, 2)).toEqual([0, 2, 4]);
  });

  it('returns every 4th beat when beatDivision is 4', () => {
    expect(filterBeatsByDivision(beats, 4)).toEqual([0, 4]);
  });

  it('interpolates sub-beats when beatDivision is 0.5 (twice per beat)', () => {
    const result = filterBeatsByDivision([0, 1, 2], 0.5);
    // Expect: 0, 0.5, 1, 1.5, 2
    expect(result).toHaveLength(5);
    expect(result[0]).toBe(0);
    expect(result[1]).toBeCloseTo(0.5);
    expect(result[2]).toBe(1);
    expect(result[3]).toBeCloseTo(1.5);
    expect(result[4]).toBe(2);
  });

  it('interpolates sub-beats when beatDivision is 0.25 (4x per beat)', () => {
    const result = filterBeatsByDivision([0, 1], 0.25);
    // Expect: 0, 0.25, 0.5, 0.75, 1
    expect(result).toHaveLength(5);
    expect(result[0]).toBe(0);
    expect(result[1]).toBeCloseTo(0.25);
    expect(result[2]).toBeCloseTo(0.5);
    expect(result[3]).toBeCloseTo(0.75);
    expect(result[4]).toBe(1);
  });

  it('returns input beats unchanged when beatDivision is 0 or negative', () => {
    expect(filterBeatsByDivision(beats, 0)).toEqual(beats);
    expect(filterBeatsByDivision(beats, -1)).toEqual(beats);
  });

  it('handles empty beats array', () => {
    expect(filterBeatsByDivision([], 1)).toEqual([]);
    expect(filterBeatsByDivision([], 0.5)).toEqual([]);
  });

  it('handles single beat array', () => {
    expect(filterBeatsByDivision([5], 1)).toEqual([5]);
    expect(filterBeatsByDivision([5], 2)).toEqual([5]);
    // Single beat → no interpolation possible after it
    expect(filterBeatsByDivision([5], 0.5)).toEqual([5]);
  });

  it('rounds non-integer beat division to nearest step', () => {
    // beatDivision=2.7 should round to step=3
    const result = filterBeatsByDivision([0, 1, 2, 3, 4, 5], 2.7);
    expect(result).toEqual([0, 3]);
  });
});
