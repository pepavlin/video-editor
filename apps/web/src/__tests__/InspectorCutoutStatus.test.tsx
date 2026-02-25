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
    expect(screen.getByText('✓ Cutout ready')).toBeDefined();
    expect(screen.queryByText('Not processed')).toBeNull();
    expect(screen.queryByText('Cutout ready')).toBeNull(); // old label without checkmark
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
    expect(screen.queryByText('Cutout ready')).toBeNull();
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

  it('shows "Cutout ready" when parentTrackId is missing but a video track exists (legacy project fallback)', () => {
    // Simulates projects created before parentTrackId was tracked
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

    const effectClipId = 'clip_effect_legacy';
    const effectTrack = {
      id: 'track_effect_legacy',
      type: 'effect' as const,
      effectType: 'cutout' as const,
      // No parentTrackId — simulates legacy/old project data
      parentTrackId: undefined as unknown as string,
      name: 'Cutout 1',
      muted: false,
      clips: [
        {
          id: effectClipId,
          assetId: '',
          trackId: 'track_effect_legacy',
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

    // Falls back to the only video track → asset has maskPath → should show "Cutout ready"
    expect(screen.getByText('✓ Cutout ready')).toBeDefined();
    expect(screen.queryByText('Not processed')).toBeNull();
    expect(screen.queryByText('No video asset')).toBeNull();
  });

  it('shows "Cutout ready" when parentTrackId points to a deleted track (invalid id fallback)', () => {
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

    const effectClipId = 'clip_effect_stale';
    const effectTrack = {
      id: 'track_effect_stale',
      type: 'effect' as const,
      effectType: 'cutout' as const,
      parentTrackId: 'track_deleted_long_ago', // no longer exists in tracks
      name: 'Cutout 1',
      muted: false,
      clips: [
        {
          id: effectClipId,
          assetId: '',
          trackId: 'track_effect_stale',
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

    // Falls back to the first video track → asset has maskPath → "Cutout ready"
    expect(screen.getByText('✓ Cutout ready')).toBeDefined();
    expect(screen.queryByText('Not processed')).toBeNull();
  });

  it('shows "No video asset" and no Process button when there are no video tracks at all', () => {
    const effectClipId = 'clip_effect_novideo';
    const effectTrack = {
      id: 'track_effect_novideo',
      type: 'effect' as const,
      effectType: 'cutout' as const,
      parentTrackId: undefined as unknown as string,
      name: 'Cutout 1',
      muted: false,
      clips: [
        {
          id: effectClipId,
          assetId: '',
          trackId: 'track_effect_novideo',
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

    const project = makeProject({ tracks: [effectTrack] }); // no video track

    render(
      <Inspector
        {...baseProps}
        project={project}
        selectedClipId={effectClipId}
        assets={[]}
      />,
    );

    expect(screen.getByText('No video asset')).toBeDefined();
    expect(screen.queryByText('Not processed')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Process' })).toBeNull();
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
    expect(screen.getByText('✓ Cutout ready')).toBeDefined();
    expect(screen.queryByText('Not processed')).toBeNull();
    expect(screen.queryByText('Cutout ready')).toBeNull(); // old label without checkmark
  });

  it('shows "Cutout ready" via clips[0] fallback when no parentTrackId and no time overlap', () => {
    const asset = makeAsset({ id: 'asset_1', maskPath: 'masks/asset_1.mp4' });

    // Video clip lives at t=0..10, effect clip lives at t=15..20 — no time overlap
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

    const effectClipId = 'clip_effect_6';
    // Effect track with NO parentTrackId and placed beyond the video clip
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
          timelineStart: 15,
          timelineEnd: 20,
          sourceStart: 0,
          sourceEnd: 5,
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

    // clips[0] fallback should resolve to asset_1 which has maskPath → "Cutout ready"
    expect(screen.getByText('✓ Cutout ready')).toBeDefined();
    expect(screen.queryByText('Not processed')).toBeNull();
    expect(screen.queryByText('Cutout ready')).toBeNull(); // old label without checkmark
  });

  it('shows the resolved video asset name in the Video row', () => {
    const asset = makeAsset({ id: 'asset_1', name: 'my-clip.mp4', maskPath: 'masks/asset_1.mp4' });

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

    const effectClipId = 'clip_effect_video_row';
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

    // The "Video" row should show the resolved asset name
    expect(screen.getByText('my-clip.mp4')).toBeDefined();
  });

  it('shows "No video found" in the Video row when asset cannot be resolved', () => {
    const effectClipId = 'clip_effect_no_asset';
    // Effect track with no parentTrackId and no video tracks in the project
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

    const project = makeProject({ tracks: [effectTrack] }); // no video tracks

    render(
      <Inspector
        {...baseProps}
        project={project}
        selectedClipId={effectClipId}
        assets={[]}
      />,
    );

    // No asset found → show fallback text
    expect(screen.getByText('No video found')).toBeDefined();
  });
});

describe('Inspector – cutout mode toggle', () => {
  function makeScenario(cutoutMode?: 'removeBg' | 'removePerson') {
    const asset = makeAsset({ id: 'asset_1' });
    const videoTrack = {
      id: 'track_video',
      type: 'video' as const,
      name: 'Video 1',
      muted: false,
      clips: [{ id: 'clip_video', assetId: 'asset_1', trackId: 'track_video', timelineStart: 0, timelineEnd: 10, sourceStart: 0, sourceEnd: 10 }],
    };
    const effectClipId = 'clip_eff_mode';
    const effectTrack = {
      id: 'track_effect',
      type: 'effect' as const,
      effectType: 'cutout' as const,
      parentTrackId: 'track_video',
      name: 'Cutout',
      muted: false,
      clips: [{
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
          ...(cutoutMode ? { cutoutMode } : {}),
        },
      }],
    };
    return { asset, project: makeProject({ tracks: [effectTrack, videoTrack] }), effectClipId };
  }

  it('shows both mode toggle buttons', () => {
    const { asset, project, effectClipId } = makeScenario();
    render(<Inspector {...baseProps} project={project} selectedClipId={effectClipId} assets={[asset]} />);
    expect(screen.getByText('👤 Keep person')).toBeDefined();
    expect(screen.getByText('🖼 Keep background')).toBeDefined();
  });

  it('defaults to "Keep person" active when no cutoutMode is set', () => {
    const { asset, project, effectClipId } = makeScenario(undefined);
    render(<Inspector {...baseProps} project={project} selectedClipId={effectClipId} assets={[asset]} />);
    const keepPersonBtn = screen.getByText('👤 Keep person').closest('button')!;
    const keepBgBtn = screen.getByText('🖼 Keep background').closest('button')!;
    // active button has green color style
    expect(keepPersonBtn.style.color).toBe('rgb(52, 211, 153)');
    expect(keepBgBtn.style.color).not.toBe('rgb(52, 211, 153)');
  });

  it('marks "Keep background" active when cutoutMode is removePerson', () => {
    const { asset, project, effectClipId } = makeScenario('removePerson');
    render(<Inspector {...baseProps} project={project} selectedClipId={effectClipId} assets={[asset]} />);
    const keepBgBtn = screen.getByText('🖼 Keep background').closest('button')!;
    expect(keepBgBtn.style.color).toBe('rgb(52, 211, 153)');
  });

  it('calls onUpdateEffectClipConfig with removePerson when "Keep background" is clicked', () => {
    const onUpdate = vi.fn();
    const { asset, project, effectClipId } = makeScenario('removeBg');
    render(<Inspector {...baseProps} onUpdateEffectClipConfig={onUpdate} project={project} selectedClipId={effectClipId} assets={[asset]} />);
    screen.getByText('🖼 Keep background').closest('button')!.click();
    expect(onUpdate).toHaveBeenCalledWith(effectClipId, expect.objectContaining({ cutoutMode: 'removePerson' }));
  });
});
