import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Inspector from '../components/Inspector';
import type { Project, Asset } from '@video-editor/shared';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeNow() {
  return new Date().toISOString();
}

function makeProject(overrides: Partial<Project> = {}): Project {
  const now = makeNow();
  return {
    id: 'proj_1',
    name: 'Test',
    duration: 10,
    aspectRatio: '9:16',
    outputResolution: { w: 1080, h: 1920 },
    tracks: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeAsset(overrides: Partial<Asset> = {}): Asset {
  const now = makeNow();
  return {
    id: 'asset_1',
    name: 'video.mp4',
    type: 'video',
    originalPath: '/tmp/video.mp4',
    duration: 10,
    width: 1920,
    height: 1080,
    createdAt: now,
    ...overrides,
  };
}

const baseProps = {
  selectedClipId: null,
  assets: [],
  onClipUpdate: vi.fn(),
  onUpdateEffectClipConfig: vi.fn(),
  onUpdateProject: vi.fn(),
  masterAssetId: undefined,
  onAlignLyricsClip: vi.fn(),
  onTranscribeLyricsClip: vi.fn(),
  onStartCutout: vi.fn(),
  onCancelCutout: vi.fn(),
  onStartHeadStabilization: vi.fn(),
  onCancelHeadStabilization: vi.fn(),
  assetJobs: {},
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Inspector – cutout status via parent track resolution', () => {
  it('shows "Cutout ready" when the video asset on the parent track has maskPath set', () => {
    const now = makeNow();

    const asset = makeAsset({ id: 'asset_1', maskPath: 'masks/asset_1.mp4' });

    // Video track with a clip pointing to the asset
    const videoTrack = {
      id: 'track_video',
      type: 'video' as const,
      name: 'Video 1',
      muted: false,
      clips: [
        {
          id: 'clip_video',
          assetId: 'asset_1',
          trackId: 'track_video',
          timelineStart: 0,
          timelineEnd: 10,
          sourceStart: 0,
          sourceEnd: 10,
        },
      ],
    };

    // Effect track with assetId: '' (as created by addEffectTrack)
    const effectClipId = 'clip_effect';
    const effectTrack = {
      id: 'track_effect',
      type: 'effect' as const,
      effectType: 'cutout' as const,
      parentTrackId: 'track_video',
      name: 'Cutout 1',
      muted: false,
      clips: [
        {
          id: effectClipId,
          assetId: '',
          trackId: 'track_effect',
          timelineStart: 0,
          timelineEnd: 10,
          sourceStart: 0,
          sourceEnd: 10,
          effectConfig: {
            effectType: 'cutout' as const,
            enabled: true,
            background: { type: 'solid' as const, color: '#000000' },
          },
        },
      ],
    };

    const project = makeProject({ tracks: [effectTrack, videoTrack] });

    render(
      <Inspector
        {...baseProps}
        project={project}
        selectedClipId={effectClipId}
        assets={[asset]}
      />,
    );

    // The cutout status should say "Cutout ready" (green), not "Not processed"
    expect(screen.getByText('Cutout ready')).toBeDefined();
    expect(screen.queryByText('Not processed')).toBeNull();
  });

  it('shows "Not processed" when the parent asset has no maskPath', () => {
    const now = makeNow();

    const asset = makeAsset({ id: 'asset_1', maskPath: undefined });

    const videoTrack = {
      id: 'track_video',
      type: 'video' as const,
      name: 'Video 1',
      muted: false,
      clips: [
        {
          id: 'clip_video',
          assetId: 'asset_1',
          trackId: 'track_video',
          timelineStart: 0,
          timelineEnd: 10,
          sourceStart: 0,
          sourceEnd: 10,
        },
      ],
    };

    const effectClipId = 'clip_effect_2';
    const effectTrack = {
      id: 'track_effect',
      type: 'effect' as const,
      effectType: 'cutout' as const,
      parentTrackId: 'track_video',
      name: 'Cutout 1',
      muted: false,
      clips: [
        {
          id: effectClipId,
          assetId: '',
          trackId: 'track_effect',
          timelineStart: 0,
          timelineEnd: 10,
          sourceStart: 0,
          sourceEnd: 10,
          effectConfig: {
            effectType: 'cutout' as const,
            enabled: true,
            background: { type: 'solid' as const, color: '#000000' },
          },
        },
      ],
    };

    const project = makeProject({ tracks: [effectTrack, videoTrack] });

    render(
      <Inspector
        {...baseProps}
        project={project}
        selectedClipId={effectClipId}
        assets={[asset]}
      />,
    );

    expect(screen.getByText('Not processed')).toBeDefined();
    expect(screen.queryByText('Mask ready')).toBeNull();
  });

  it('shows "Process" button (not "Re-process") when cutout is not yet done', () => {
    const asset = makeAsset({ id: 'asset_1', maskPath: undefined });

    const videoTrack = {
      id: 'track_video',
      type: 'video' as const,
      name: 'Video 1',
      muted: false,
      clips: [
        {
          id: 'clip_video',
          assetId: 'asset_1',
          trackId: 'track_video',
          timelineStart: 0,
          timelineEnd: 10,
          sourceStart: 0,
          sourceEnd: 10,
        },
      ],
    };

    const effectClipId = 'clip_effect_3';
    const effectTrack = {
      id: 'track_effect',
      type: 'effect' as const,
      effectType: 'cutout' as const,
      parentTrackId: 'track_video',
      name: 'Cutout 1',
      muted: false,
      clips: [
        {
          id: effectClipId,
          assetId: '',
          trackId: 'track_effect',
          timelineStart: 0,
          timelineEnd: 10,
          sourceStart: 0,
          sourceEnd: 10,
          effectConfig: {
            effectType: 'cutout' as const,
            enabled: true,
            background: { type: 'solid' as const, color: '#000000' },
          },
        },
      ],
    };

    const project = makeProject({ tracks: [effectTrack, videoTrack] });

    render(
      <Inspector
        {...baseProps}
        project={project}
        selectedClipId={effectClipId}
        assets={[asset]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Process' })).toBeDefined();
  });

  it('shows "Re-process" button when cutout is already done', () => {
    const asset = makeAsset({ id: 'asset_1', maskPath: 'masks/asset_1.mp4' });

    const videoTrack = {
      id: 'track_video',
      type: 'video' as const,
      name: 'Video 1',
      muted: false,
      clips: [
        {
          id: 'clip_video',
          assetId: 'asset_1',
          trackId: 'track_video',
          timelineStart: 0,
          timelineEnd: 10,
          sourceStart: 0,
          sourceEnd: 10,
        },
      ],
    };

    const effectClipId = 'clip_effect_4';
    const effectTrack = {
      id: 'track_effect',
      type: 'effect' as const,
      effectType: 'cutout' as const,
      parentTrackId: 'track_video',
      name: 'Cutout 1',
      muted: false,
      clips: [
        {
          id: effectClipId,
          assetId: '',
          trackId: 'track_effect',
          timelineStart: 0,
          timelineEnd: 10,
          sourceStart: 0,
          sourceEnd: 10,
          effectConfig: {
            effectType: 'cutout' as const,
            enabled: true,
            background: { type: 'solid' as const, color: '#000000' },
          },
        },
      ],
    };

    const project = makeProject({ tracks: [effectTrack, videoTrack] });

    render(
      <Inspector
        {...baseProps}
        project={project}
        selectedClipId={effectClipId}
        assets={[asset]}
      />,
    );

    expect(screen.getByRole('button', { name: 'Re-process' })).toBeDefined();
  });

  it('shows "Cutout ready" via fallback (no parentTrackId) when video asset on any track has maskPath', () => {
    const asset = makeAsset({ id: 'asset_1', maskPath: 'masks/asset_1.mp4' });

    // Video track without explicit parentTrackId link
    const videoTrack = {
      id: 'track_video',
      type: 'video' as const,
      name: 'Video 1',
      muted: false,
      clips: [
        {
          id: 'clip_video',
          assetId: 'asset_1',
          trackId: 'track_video',
          timelineStart: 0,
          timelineEnd: 10,
          sourceStart: 0,
          sourceEnd: 10,
        },
      ],
    };

    const effectClipId = 'clip_effect_5';
    // Effect track with NO parentTrackId (simulates broken/missing relationship)
    const effectTrack = {
      id: 'track_effect',
      type: 'effect' as const,
      effectType: 'cutout' as const,
      parentTrackId: undefined as unknown as string,
      name: 'Cutout 1',
      muted: false,
      clips: [
        {
          id: effectClipId,
          assetId: '',
          trackId: 'track_effect',
          timelineStart: 0,
          timelineEnd: 10,
          sourceStart: 0,
          sourceEnd: 10,
          effectConfig: {
            effectType: 'cutout' as const,
            enabled: true,
            background: { type: 'solid' as const, color: '#000000' },
          },
        },
      ],
    };

    const project = makeProject({ tracks: [effectTrack, videoTrack] });

    render(
      <Inspector
        {...baseProps}
        project={project}
        selectedClipId={effectClipId}
        assets={[asset]}
      />,
    );

    // Fallback resolution should still find the asset and show "Cutout ready"
    expect(screen.getByText('Cutout ready')).toBeDefined();
    expect(screen.queryByText('Not processed')).toBeNull();
  });
});
