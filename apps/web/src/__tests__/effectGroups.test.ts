import { describe, it, expect } from 'vitest';
import type { Track } from '@video-editor/shared';
import {
  buildEffectGroups,
  computeTrackYPositions,
  EFFECT_COLOR_MAP,
} from '../lib/utils';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTrack(type: Track['type'], overrides: Partial<Track> = {}): Track {
  return {
    id: `track_${type}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    name: type,
    muted: false,
    clips: [],
    ...overrides,
  };
}

// ─── EFFECT_COLOR_MAP ─────────────────────────────────────────────────────────

describe('EFFECT_COLOR_MAP', () => {
  it('has entries for all known effect types', () => {
    expect(EFFECT_COLOR_MAP).toHaveProperty('beatZoom');
    expect(EFFECT_COLOR_MAP).toHaveProperty('cutout');
    expect(EFFECT_COLOR_MAP).toHaveProperty('headStabilization');
    expect(EFFECT_COLOR_MAP).toHaveProperty('cartoon');
    expect(EFFECT_COLOR_MAP).toHaveProperty('colorGrade');
  });

  it('returns RGB string values', () => {
    for (const val of Object.values(EFFECT_COLOR_MAP)) {
      // Each value should be an "R,G,B" string
      expect(val).toMatch(/^\d+,\d+,\d+$/);
    }
  });
});

// ─── buildEffectGroups ────────────────────────────────────────────────────────

describe('buildEffectGroups', () => {
  it('returns empty map when no effect tracks exist', () => {
    const tracks = [
      makeTrack('video', { id: 'v1' }),
      makeTrack('audio', { id: 'a1' }),
    ];
    const groups = buildEffectGroups(tracks);
    expect(groups.size).toBe(0);
  });

  it('returns empty map when effect track has no parentTrackId', () => {
    const tracks = [
      makeTrack('video', { id: 'v1' }),
      makeTrack('effect', { id: 'e1', effectType: 'beatZoom' }),
    ];
    const groups = buildEffectGroups(tracks);
    expect(groups.size).toBe(0);
  });

  it('returns empty map when effect track references a non-existent parent', () => {
    const tracks = [
      makeTrack('video', { id: 'v1' }),
      makeTrack('effect', { id: 'e1', effectType: 'beatZoom', parentTrackId: 'non_existent' }),
    ];
    const groups = buildEffectGroups(tracks);
    expect(groups.size).toBe(0);
  });

  it('groups a single effect track with its parent video track', () => {
    const tracks = [
      makeTrack('effect', { id: 'e1', effectType: 'beatZoom', parentTrackId: 'v1' }),
      makeTrack('video', { id: 'v1' }),
    ];
    const groups = buildEffectGroups(tracks);
    expect(groups.size).toBe(1);
    expect(groups.has('v1')).toBe(true);

    const group = groups.get('v1')!;
    expect(group.parentIdx).toBe(1);
    expect(group.effectIndices).toEqual([0]);
    expect(group.effectColors).toEqual([EFFECT_COLOR_MAP.beatZoom]);
  });

  it('groups multiple effect tracks with the same parent', () => {
    const tracks = [
      makeTrack('effect', { id: 'e1', effectType: 'beatZoom', parentTrackId: 'v1' }),
      makeTrack('effect', { id: 'e2', effectType: 'cutout', parentTrackId: 'v1' }),
      makeTrack('video', { id: 'v1' }),
    ];
    const groups = buildEffectGroups(tracks);
    expect(groups.size).toBe(1);

    const group = groups.get('v1')!;
    expect(group.parentIdx).toBe(2);
    expect(group.effectIndices).toEqual([0, 1]);
    expect(group.effectColors).toEqual([
      EFFECT_COLOR_MAP.beatZoom,
      EFFECT_COLOR_MAP.cutout,
    ]);
  });

  it('creates separate groups for different parent tracks', () => {
    const tracks = [
      makeTrack('effect', { id: 'e1', effectType: 'beatZoom', parentTrackId: 'v1' }),
      makeTrack('video', { id: 'v1' }),
      makeTrack('effect', { id: 'e2', effectType: 'cartoon', parentTrackId: 'v2' }),
      makeTrack('video', { id: 'v2' }),
    ];
    const groups = buildEffectGroups(tracks);
    expect(groups.size).toBe(2);

    const g1 = groups.get('v1')!;
    expect(g1.parentIdx).toBe(1);
    expect(g1.effectIndices).toEqual([0]);
    expect(g1.effectColors).toEqual([EFFECT_COLOR_MAP.beatZoom]);

    const g2 = groups.get('v2')!;
    expect(g2.parentIdx).toBe(3);
    expect(g2.effectIndices).toEqual([2]);
    expect(g2.effectColors).toEqual([EFFECT_COLOR_MAP.cartoon]);
  });

  it('assigns correct colors for each effect type', () => {
    const tracks = [
      makeTrack('effect', { id: 'e1', effectType: 'headStabilization', parentTrackId: 'v1' }),
      makeTrack('effect', { id: 'e2', effectType: 'colorGrade', parentTrackId: 'v1' }),
      makeTrack('video', { id: 'v1' }),
    ];
    const groups = buildEffectGroups(tracks);
    const group = groups.get('v1')!;
    expect(group.effectColors).toEqual([
      EFFECT_COLOR_MAP.headStabilization,
      EFFECT_COLOR_MAP.colorGrade,
    ]);
  });

  it('defaults to beatZoom color when effectType is undefined', () => {
    const tracks = [
      makeTrack('effect', { id: 'e1', parentTrackId: 'v1' }), // no effectType
      makeTrack('video', { id: 'v1' }),
    ];
    const groups = buildEffectGroups(tracks);
    const group = groups.get('v1')!;
    expect(group.effectColors).toEqual([EFFECT_COLOR_MAP.beatZoom]);
  });

  it('ignores non-effect tracks when building groups', () => {
    const tracks = [
      makeTrack('text', { id: 't1' }),
      makeTrack('effect', { id: 'e1', effectType: 'beatZoom', parentTrackId: 'v1' }),
      makeTrack('video', { id: 'v1' }),
      makeTrack('audio', { id: 'a1' }),
      makeTrack('lyrics', { id: 'l1' }),
    ];
    const groups = buildEffectGroups(tracks);
    expect(groups.size).toBe(1);
    expect(groups.get('v1')!.effectIndices).toEqual([1]);
    expect(groups.get('v1')!.parentIdx).toBe(2);
  });
});

// ─── computeTrackYPositions ──────────────────────────────────────────────────

describe('computeTrackYPositions', () => {
  const RULER_H = 24;

  it('returns empty array for no tracks', () => {
    const positions = computeTrackYPositions([], RULER_H, 0, () => 56);
    expect(positions).toEqual([]);
  });

  it('computes positions for a single track', () => {
    const tracks = [makeTrack('video')];
    const positions = computeTrackYPositions(tracks, RULER_H, 0, () => 56);
    expect(positions).toEqual([24]); // RULER_H - scrollTop
  });

  it('computes positions for multiple tracks with uniform height', () => {
    const tracks = [makeTrack('video'), makeTrack('audio'), makeTrack('video')];
    const positions = computeTrackYPositions(tracks, RULER_H, 0, () => 56);
    expect(positions).toEqual([24, 80, 136]);
  });

  it('computes positions with varying track heights', () => {
    const tracks = [
      makeTrack('effect', { id: 'e1', effectType: 'beatZoom' }),
      makeTrack('video'),
      makeTrack('audio'),
    ];
    const getHeight = (t: Track) => t.type === 'effect' ? 26 : 56;
    const positions = computeTrackYPositions(tracks, RULER_H, 0, getHeight);
    expect(positions).toEqual([24, 50, 106]); // 24, 24+26=50, 50+56=106
  });

  it('applies scrollTop offset correctly', () => {
    const tracks = [makeTrack('video'), makeTrack('audio')];
    const scrollTop = 10;
    const positions = computeTrackYPositions(tracks, RULER_H, scrollTop, () => 56);
    expect(positions).toEqual([14, 70]); // 24-10=14, 14+56=70
  });

  it('handles negative scrollTop (scrolled above origin)', () => {
    const tracks = [makeTrack('video')];
    const positions = computeTrackYPositions(tracks, RULER_H, -5, () => 56);
    expect(positions).toEqual([29]); // 24 - (-5) = 29
  });

  it('computes correct positions for effect tracks above their parent', () => {
    const tracks = [
      makeTrack('effect', { id: 'e1', effectType: 'beatZoom', parentTrackId: 'v1' }),
      makeTrack('effect', { id: 'e2', effectType: 'cutout', parentTrackId: 'v1' }),
      makeTrack('video', { id: 'v1' }),
    ];
    const getHeight = (t: Track) => t.type === 'effect' ? 26 : 56;
    const positions = computeTrackYPositions(tracks, RULER_H, 0, getHeight);
    // Effect 1 at 24, Effect 2 at 24+26=50, Video at 50+26=76
    expect(positions).toEqual([24, 50, 76]);
    // Verify group spans: topY=24, parentBottomY=76+56=132, groupHeight=108
    const groupTopY = positions[0];
    const parentBottomY = positions[2] + 56;
    expect(parentBottomY - groupTopY).toBe(108);
  });
});
