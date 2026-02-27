import { describe, it, expect } from 'vitest';
import type { Track, Clip, Asset } from '@video-editor/shared';
import { isAssetCompatibleWithTrack, getClipMediaType } from '../lib/trackUtils';
import { getDefaultTrackName } from '../hooks/useProject';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTrack(type: Track['type'], overrides: Partial<Track> = {}): Track {
  return { id: 'track_1', type, name: 'Track', clips: [], ...overrides };
}

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip_1',
    assetId: '',
    trackId: 'track_1',
    timelineStart: 0,
    timelineEnd: 5,
    sourceStart: 0,
    sourceEnd: 5,
    ...overrides,
  };
}

function makeAsset(id: string, type: 'video' | 'audio'): Asset {
  return {
    id,
    name: `asset_${type}`,
    type,
    originalPath: `/assets/${id}`,
    duration: 10,
    createdAt: '2024-01-01',
  };
}

// ─── getDefaultTrackName ──────────────────────────────────────────────────────

describe('getDefaultTrackName', () => {
  it('returns base name when no tracks exist', () => {
    expect(getDefaultTrackName('video', [])).toBe('Video');
    expect(getDefaultTrackName('audio', [])).toBe('Audio');
    expect(getDefaultTrackName('lyrics', [])).toBe('Lyrics');
    expect(getDefaultTrackName('text', [])).toBe('Text');
    expect(getDefaultTrackName('effect', [])).toBe('Effect');
  });

  it('returns "Video 2" when one video track exists', () => {
    const tracks: Track[] = [makeTrack('video', { name: 'Video' })];
    expect(getDefaultTrackName('video', tracks)).toBe('Video 2');
  });

  it('returns "Video 3" when two video tracks exist', () => {
    const tracks: Track[] = [
      makeTrack('video', { id: 't1', name: 'Video' }),
      makeTrack('video', { id: 't2', name: 'Video 2' }),
    ];
    expect(getDefaultTrackName('video', tracks)).toBe('Video 3');
  });

  it('video tracks count includes text tracks (visual layer grouping)', () => {
    const tracks: Track[] = [makeTrack('text', { name: 'Text' })];
    // A new video track alongside an existing text track should be "Video 2"
    expect(getDefaultTrackName('video', tracks)).toBe('Video 2');
  });

  it('lyrics tracks are counted independently from video tracks', () => {
    const tracks: Track[] = [
      makeTrack('video', { id: 't1', name: 'Video' }),
      makeTrack('video', { id: 't2', name: 'Video 2' }),
    ];
    // Lyrics track naming ignores video tracks
    expect(getDefaultTrackName('lyrics', tracks)).toBe('Lyrics');
  });

  it('audio tracks are counted independently', () => {
    const tracks: Track[] = [
      makeTrack('video', { id: 't1', name: 'Video' }),
      makeTrack('audio', { id: 't2', name: 'Audio' }),
    ];
    expect(getDefaultTrackName('audio', tracks)).toBe('Audio 2');
    expect(getDefaultTrackName('video', tracks)).toBe('Video 2');
  });

  it('is consistent regardless of creation order', () => {
    // Video + lyrics → next video is "Video 2", not "Video 3"
    const tracks: Track[] = [
      makeTrack('video', { id: 't1', name: 'Video' }),
      makeTrack('lyrics', { id: 't2', name: 'Lyrics' }),
    ];
    expect(getDefaultTrackName('video', tracks)).toBe('Video 2');
  });

  it('effect tracks are counted independently', () => {
    const tracks: Track[] = [
      makeTrack('effect', { id: 't1', name: 'Effect 1' }),
      makeTrack('effect', { id: 't2', name: 'Effect 2' }),
    ];
    expect(getDefaultTrackName('effect', tracks)).toBe('Effect 3');
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

  it('video asset is NOT compatible with effect track', () => {
    expect(isAssetCompatibleWithTrack('video', makeTrack('effect'))).toBe(false);
  });

  it('audio asset is NOT compatible with lyrics track', () => {
    expect(isAssetCompatibleWithTrack('audio', makeTrack('lyrics'))).toBe(false);
  });
});

// ─── getClipMediaType ─────────────────────────────────────────────────────────

describe('getClipMediaType', () => {
  const videoAsset = makeAsset('va1', 'video');
  const audioAsset = makeAsset('aa1', 'audio');
  const assets: Asset[] = [videoAsset, audioAsset];

  it('returns "video" for a video asset clip on a video track', () => {
    const clip = makeClip({ assetId: 'va1' });
    const track = makeTrack('video');
    expect(getClipMediaType(clip, track, assets)).toBe('video');
  });

  it('returns "audio" for an audio asset clip on an audio track', () => {
    const clip = makeClip({ assetId: 'aa1' });
    const track = makeTrack('audio');
    expect(getClipMediaType(clip, track, assets)).toBe('audio');
  });

  it('returns the asset type even if clip is on the wrong track type', () => {
    // Video asset clip mistakenly placed on a lyrics track → should still report "video"
    const clip = makeClip({ assetId: 'va1' });
    const track = makeTrack('lyrics');
    expect(getClipMediaType(clip, track, assets)).toBe('video');
  });

  it('returns "audio" for audio asset clip on video track (misplaced clip)', () => {
    const clip = makeClip({ assetId: 'aa1' });
    const track = makeTrack('video');
    expect(getClipMediaType(clip, track, assets)).toBe('audio');
  });

  it('returns "lyrics" for a clip with lyricsContent regardless of track', () => {
    const clip = makeClip({ lyricsContent: 'Hello world', assetId: '' });
    const track = makeTrack('video'); // wrong track type
    expect(getClipMediaType(clip, track, assets)).toBe('lyrics');
  });

  it('returns "video" for a clip with textContent', () => {
    const clip = makeClip({ textContent: 'Hello', assetId: '' });
    const track = makeTrack('text');
    expect(getClipMediaType(clip, track, assets)).toBe('video');
  });

  it('returns "video" for a clip with rectangleStyle', () => {
    const clip = makeClip({
      rectangleStyle: { color: '#ff0000', fillOpacity: 1, width: 100, height: 50 },
      assetId: '',
    });
    const track = makeTrack('video');
    expect(getClipMediaType(clip, track, assets)).toBe('video');
  });

  it('returns "effect" for a clip with effectConfig', () => {
    const clip = makeClip({
      effectConfig: { effectType: 'beatZoom', enabled: true },
    });
    const track = makeTrack('effect');
    expect(getClipMediaType(clip, track, assets)).toBe('effect');
  });

  it('falls back to track.type when assetId does not match any asset', () => {
    const clip = makeClip({ assetId: 'unknown_asset' });
    const track = makeTrack('audio');
    expect(getClipMediaType(clip, track, assets)).toBe('audio');
  });

  it('falls back to track.type when assetId is empty', () => {
    const clip = makeClip({ assetId: '' });
    const track = makeTrack('lyrics');
    expect(getClipMediaType(clip, track, assets)).toBe('lyrics');
  });

  it('effectConfig takes priority over lyricsContent', () => {
    const clip = makeClip({
      effectConfig: { effectType: 'colorGrade', enabled: true },
      lyricsContent: 'some lyrics',
    });
    const track = makeTrack('effect');
    expect(getClipMediaType(clip, track, assets)).toBe('effect');
  });

  it('lyricsContent takes priority over textContent', () => {
    const clip = makeClip({
      lyricsContent: 'some lyrics',
      textContent: 'some text',
      assetId: '',
    });
    const track = makeTrack('lyrics');
    expect(getClipMediaType(clip, track, assets)).toBe('lyrics');
  });
});
