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

function makeCartoonScenario(overrides: {
  cartoonMode?: 'classic' | 'aiStyle';
  aiStylePath?: string;
  aiStyleJobStatus?: string;
} = {}) {
  const asset = makeAsset({
    id: 'asset_1',
    aiStylePath: overrides.aiStylePath,
  });

  const videoTrack = {
    id: 'track_video',
    type: 'video' as const,
    name: 'Video 1',
    muted: false,
    clips: [{
      id: 'clip_video',
      assetId: 'asset_1',
      trackId: 'track_video',
      timelineStart: 0,
      timelineEnd: 10,
      sourceStart: 0,
      sourceEnd: 10,
    }],
  };

  const effectClipId = 'clip_cartoon';
  const effectTrack = {
    id: 'track_effect',
    type: 'effect' as const,
    effectType: 'cartoon' as const,
    parentTrackId: 'track_video',
    name: 'Cartoon',
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
        effectType: 'cartoon' as const,
        enabled: true,
        cartoonMode: overrides.cartoonMode ?? 'classic',
      },
    }],
  };

  const assetJobs = overrides.aiStyleJobStatus
    ? { asset_1: { aiStyle: { jobId: 'job_1', status: overrides.aiStyleJobStatus, progress: 50, logLines: [] } } }
    : {};

  return {
    asset,
    project: makeProject({ tracks: [effectTrack, videoTrack] }),
    effectClipId,
    assetJobs,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Inspector – cartoon mode toggle', () => {
  it('shows Classic and AI Style mode toggle buttons', () => {
    const { asset, project, effectClipId } = makeCartoonScenario();
    render(<Inspector {...baseProps} project={project} selectedClipId={effectClipId} assets={[asset]} />);
    expect(screen.getByText('Classic')).toBeDefined();
    expect(screen.getByText('AI Style')).toBeDefined();
  });

  it('defaults to Classic mode when cartoonMode is classic', () => {
    const { asset, project, effectClipId } = makeCartoonScenario({ cartoonMode: 'classic' });
    render(<Inspector {...baseProps} project={project} selectedClipId={effectClipId} assets={[asset]} />);

    // Classic mode should show classic params (Edges, Flatten, Saturation)
    expect(screen.getByText('Edges')).toBeDefined();
    expect(screen.getByText('Flatten')).toBeDefined();
  });

  it('shows AI Style controls when cartoonMode is aiStyle', () => {
    const { asset, project, effectClipId } = makeCartoonScenario({ cartoonMode: 'aiStyle' });
    render(<Inspector {...baseProps} project={project} selectedClipId={effectClipId} assets={[asset]} />);

    // AI Style mode should show AI Style params (Style, Strength, Brush, Vibrance, Process)
    expect(screen.getByText('Style')).toBeDefined();
    expect(screen.getByText('Strength')).toBeDefined();
    expect(screen.getByText('Brush')).toBeDefined();
    expect(screen.getByText('Vibrance')).toBeDefined();
    expect(screen.getByText('Process')).toBeDefined();
  });

  it('shows style preset dropdown with all presets in AI Style mode', () => {
    const { asset, project, effectClipId } = makeCartoonScenario({ cartoonMode: 'aiStyle' });
    render(<Inspector {...baseProps} project={project} selectedClipId={effectClipId} assets={[asset]} />);

    // Should have a select element with all 5 presets
    const select = screen.getByDisplayValue('Impressionist');
    expect(select).toBeDefined();
    expect(select.tagName).toBe('SELECT');

    const options = select.querySelectorAll('option');
    expect(options).toHaveLength(5);
    expect(options[0].value).toBe('impressionist');
    expect(options[1].value).toBe('bold');
    expect(options[2].value).toBe('abstract');
    expect(options[3].value).toBe('mosaic');
    expect(options[4].value).toBe('expressive');
  });

  it('calls onUpdateEffectClipConfig with aiStyle when AI Style button is clicked', () => {
    const onUpdate = vi.fn();
    const { asset, project, effectClipId } = makeCartoonScenario({ cartoonMode: 'classic' });
    render(
      <Inspector
        {...baseProps}
        onUpdateEffectClipConfig={onUpdate}
        project={project}
        selectedClipId={effectClipId}
        assets={[asset]}
      />,
    );
    screen.getByText('AI Style').closest('button')!.click();
    expect(onUpdate).toHaveBeenCalledWith(effectClipId, expect.objectContaining({ cartoonMode: 'aiStyle' }));
  });

  it('calls onUpdateEffectClipConfig with classic when Classic button is clicked', () => {
    const onUpdate = vi.fn();
    const { asset, project, effectClipId } = makeCartoonScenario({ cartoonMode: 'aiStyle' });
    render(
      <Inspector
        {...baseProps}
        onUpdateEffectClipConfig={onUpdate}
        project={project}
        selectedClipId={effectClipId}
        assets={[asset]}
      />,
    );
    screen.getByText('Classic').closest('button')!.click();
    expect(onUpdate).toHaveBeenCalledWith(effectClipId, expect.objectContaining({ cartoonMode: 'classic' }));
  });
});

describe('Inspector – AI style processing status', () => {
  it('shows "Stylized video ready" when aiStylePath exists', () => {
    const { asset, project, effectClipId } = makeCartoonScenario({
      cartoonMode: 'aiStyle',
      aiStylePath: 'styles/ai_style.mp4',
    });
    render(<Inspector {...baseProps} project={project} selectedClipId={effectClipId} assets={[asset]} />);
    expect(screen.getByText('Stylized video ready')).toBeDefined();
  });

  it('shows "Processing..." when AI style job is running', () => {
    const { asset, project, effectClipId, assetJobs } = makeCartoonScenario({
      cartoonMode: 'aiStyle',
      aiStyleJobStatus: 'RUNNING',
    });
    render(
      <Inspector
        {...baseProps}
        project={project}
        selectedClipId={effectClipId}
        assets={[asset]}
        assetJobs={assetJobs}
      />,
    );
    expect(screen.getByText('Processing...')).toBeDefined();
  });

  it('shows "Generate Stylized Video" button when no aiStylePath and no running job', () => {
    const { asset, project, effectClipId } = makeCartoonScenario({
      cartoonMode: 'aiStyle',
    });
    render(<Inspector {...baseProps} project={project} selectedClipId={effectClipId} assets={[asset]} />);
    expect(screen.getByText('Generate Stylized Video')).toBeDefined();
  });
});
