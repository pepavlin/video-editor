/**
 * ExportPipeline integration tests
 *
 * Verifies that the ExportPipeline correctly builds FFmpeg filter complexes
 * for projects with various effects, including Cutout which was previously
 * missing from the hardcoded export builder.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

let tmpDir: string;

vi.mock('../config', () => ({
  config: {
    workspaceDir: '',
    scriptsDir: '',
    pythonBin: 'python3',
    ffmpegBin: 'ffmpeg',
    ffprobeBin: 'ffprobe',
    port: 3001,
    host: '0.0.0.0',
    corsOrigin: 'http://localhost:3000',
  },
}));

import { config } from '../config';
import * as ws from '../services/workspace';
import { ExportPipeline } from '../elements/ExportPipeline';
import type { Project, Track, Clip, BeatsData, EffectClipConfig } from '@video-editor/shared';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip1',
    assetId: 'asset1',
    trackId: 'track1',
    timelineStart: 0,
    timelineEnd: 3,
    sourceStart: 0,
    sourceEnd: 3,
    ...overrides,
  };
}

function makeVideoTrack(clips: Clip[], id = 'track-v1'): Track {
  return { id, type: 'video', name: 'Video', clips };
}

function makeEffectTrack(
  parentTrackId: string,
  effectType: string,
  config: EffectClipConfig,
  id = 'track-fx1'
): Track {
  return {
    id,
    type: 'effect',
    name: `${effectType} effect`,
    effectType: effectType as any,
    parentTrackId,
    clips: [
      makeClip({
        id: `${id}-clip`,
        trackId: id,
        effectConfig: config,
        timelineStart: 0,
        timelineEnd: 10,
      }),
    ],
  };
}

function makeMasterAudioTrack(clips: Clip[]): Track {
  return { id: 'track-audio', type: 'audio', name: 'Audio', isMaster: true, clips };
}

function makeProject(tracks: Track[]): Project {
  return {
    id: 'proj1',
    name: 'Test Project',
    duration: 10,
    aspectRatio: '9:16',
    outputResolution: { w: 1080, h: 1920 },
    tracks,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-expipe-'));
  (config as any).workspaceDir = tmpDir;
  ws.ensureWorkspace();

  // Create a test video asset with proxy and mask
  const assetId = 'asset1';
  const assetDir = ws.getAssetDir(assetId);
  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(path.join(assetDir, 'proxy.mp4'), 'fake-video');
  fs.writeFileSync(path.join(assetDir, 'mask.mp4'), 'fake-mask');
  ws.upsertAsset({
    id: assetId,
    name: 'test.mp4',
    type: 'video',
    originalPath: `assets/${assetId}/proxy.mp4`,
    proxyPath: `assets/${assetId}/proxy.mp4`,
    maskPath: `assets/${assetId}/mask.mp4`,
    duration: 10,
    createdAt: new Date().toISOString(),
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ExportPipeline', () => {
  it('produces filter complex for a basic video clip (no effects)', () => {
    const clip = makeClip();
    const videoTrack = makeVideoTrack([clip]);
    const project = makeProject([videoTrack]);
    const pipeline = new ExportPipeline();

    const result = pipeline.build(project, { outputPath: '/tmp/out.mp4' }, new Map(), new Set());

    expect(result.filterComplex).toContain('color=c=black');
    expect(result.filterComplex).toContain('overlay=');
    expect(result.videoOutPad).toBeTruthy();
  });

  it('includes cutout effect filters when cutout is enabled', () => {
    const clip = makeClip();
    const videoTrack = makeVideoTrack([clip]);
    const cutoutConfig: EffectClipConfig = {
      effectType: 'cutout',
      enabled: true,
      cutoutMode: 'removeBg',
      background: { type: 'solid', color: '#00FF00' },
      maskThreshold: 128,
    };
    const effectTrack = makeEffectTrack(videoTrack.id, 'cutout', cutoutConfig);
    const project = makeProject([videoTrack, effectTrack]);
    const pipeline = new ExportPipeline();

    const result = pipeline.build(project, { outputPath: '/tmp/out.mp4' }, new Map(), new Set());

    // Cutout filter indicators: multiply blend, gbrp format conversion, negate, addition blend
    expect(result.filterComplex).toContain('blend=all_mode=multiply');
    expect(result.filterComplex).toContain('blend=all_mode=addition');
    expect(result.filterComplex).toContain('format=gbrp');
    expect(result.filterComplex).toContain('negate');
    // Background color
    expect(result.filterComplex).toContain('color=c=0x00FF00');
    // Mask threshold
    expect(result.filterComplex).toContain("lutyuv=y='if(gte(val,128),255,0)'");
  });

  it('includes mask video as a separate FFmpeg input', () => {
    const clip = makeClip();
    const videoTrack = makeVideoTrack([clip]);
    const cutoutConfig: EffectClipConfig = {
      effectType: 'cutout',
      enabled: true,
      cutoutMode: 'removeBg',
      background: { type: 'solid', color: '#000000' },
    };
    const effectTrack = makeEffectTrack(videoTrack.id, 'cutout', cutoutConfig);
    const project = makeProject([videoTrack, effectTrack]);
    const pipeline = new ExportPipeline();

    const result = pipeline.build(project, { outputPath: '/tmp/out.mp4' }, new Map(), new Set());

    // The mask video should be a separate -i input
    const maskPath = path.join(tmpDir, 'assets', 'asset1', 'mask.mp4');
    expect(result.inputArgs).toContain(maskPath);
  });

  it('uses removePerson mode correctly (swapped blend order)', () => {
    const clip = makeClip();
    const videoTrack = makeVideoTrack([clip]);
    const cutoutConfig: EffectClipConfig = {
      effectType: 'cutout',
      enabled: true,
      cutoutMode: 'removePerson',
      background: { type: 'solid', color: '#FF0000' },
    };
    const effectTrack = makeEffectTrack(videoTrack.id, 'cutout', cutoutConfig);
    const project = makeProject([videoTrack, effectTrack]);
    const pipeline = new ExportPipeline();

    const result = pipeline.build(project, { outputPath: '/tmp/out.mp4' }, new Map(), new Set());

    // removePerson: clip × inv_mask, bg × mask (swapped from removeBg)
    expect(result.filterComplex).toContain('[cut_cliprgb_0][cut_minv_0]blend=all_mode=multiply');
    expect(result.filterComplex).toContain('[cut_bg_0][cut_maskb_0]blend=all_mode=multiply');
  });

  it('applies mask expand/contract and blur parameters', () => {
    const clip = makeClip();
    const videoTrack = makeVideoTrack([clip]);
    const cutoutConfig: EffectClipConfig = {
      effectType: 'cutout',
      enabled: true,
      cutoutMode: 'removeBg',
      background: { type: 'solid', color: '#000000' },
      maskExpand: 3,
      maskBlur: 5,
      maskThreshold: 150,
    };
    const effectTrack = makeEffectTrack(videoTrack.id, 'cutout', cutoutConfig);
    const project = makeProject([videoTrack, effectTrack]);
    const pipeline = new ExportPipeline();

    const result = pipeline.build(project, { outputPath: '/tmp/out.mp4' }, new Map(), new Set());

    // Threshold=150
    expect(result.filterComplex).toContain("lutyuv=y='if(gte(val,150),255,0)'");
    // Expand=3 → 3 maximum=radius=1 filters
    const maximumCount = (result.filterComplex.match(/maximum=radius=1/g) || []).length;
    expect(maximumCount).toBe(3);
    // Blur=5 → gblur
    expect(result.filterComplex).toContain('gblur=sigma=5.0');
  });

  it('skips cutout effect when disabled', () => {
    const clip = makeClip();
    const videoTrack = makeVideoTrack([clip]);
    const cutoutConfig: EffectClipConfig = {
      effectType: 'cutout',
      enabled: false,
      cutoutMode: 'removeBg',
      background: { type: 'solid', color: '#000000' },
    };
    const effectTrack = makeEffectTrack(videoTrack.id, 'cutout', cutoutConfig);
    const project = makeProject([videoTrack, effectTrack]);
    const pipeline = new ExportPipeline();

    const result = pipeline.build(project, { outputPath: '/tmp/out.mp4' }, new Map(), new Set());

    // No cutout-specific filters should be present
    expect(result.filterComplex).not.toContain('blend=all_mode=multiply');
    expect(result.filterComplex).not.toContain('negate');
    // Basic overlay should still exist
    expect(result.filterComplex).toContain('overlay=');
  });

  it('combines cutout with other effects (beatZoom)', () => {
    const clip = makeClip();
    const videoTrack = makeVideoTrack([clip]);

    // Master audio with beats
    const audioClip = makeClip({
      id: 'audio-clip1',
      assetId: 'audio-asset1',
      trackId: 'track-audio',
    });

    const cutoutConfig: EffectClipConfig = {
      effectType: 'cutout',
      enabled: true,
      cutoutMode: 'removeBg',
      background: { type: 'solid', color: '#000000' },
    };
    const beatZoomConfig: EffectClipConfig = {
      effectType: 'beatZoom',
      enabled: true,
      intensity: 0.08,
      durationMs: 150,
    };

    const cutoutTrack = makeEffectTrack(videoTrack.id, 'cutout', cutoutConfig, 'track-fx-cutout');
    const beatZoomTrack = makeEffectTrack(videoTrack.id, 'beatZoom', beatZoomConfig, 'track-fx-beatzoom');
    const audioTrack = makeMasterAudioTrack([audioClip]);
    const project = makeProject([videoTrack, cutoutTrack, beatZoomTrack, audioTrack]);
    const pipeline = new ExportPipeline();

    const beatsMap = new Map<string, BeatsData>([
      ['audio-asset1', { beats: [1.0, 2.0], tempo: 120 }],
    ]);

    const result = pipeline.build(project, { outputPath: '/tmp/out.mp4' }, beatsMap, new Set());

    // Both effects should be present: BeatZoom crop + Cutout blend
    expect(result.filterComplex).toContain('crop=w=');  // BeatZoom
    expect(result.filterComplex).toContain('blend=all_mode=multiply');  // Cutout
  });

  it('handles audio output pad correctly', () => {
    const clip = makeClip();
    const videoTrack = makeVideoTrack([clip]);

    // Create audio asset
    const audioAssetId = 'audio-asset1';
    const audioDir = ws.getAssetDir(audioAssetId);
    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(path.join(audioDir, 'original.mp3'), 'fake-audio');
    ws.upsertAsset({
      id: audioAssetId,
      name: 'audio.mp3',
      type: 'audio',
      originalPath: `assets/${audioAssetId}/original.mp3`,
      duration: 10,
      createdAt: new Date().toISOString(),
    });

    const audioClip = makeClip({
      id: 'audio-clip1',
      assetId: audioAssetId,
      trackId: 'track-audio',
    });
    const audioTrack = makeMasterAudioTrack([audioClip]);
    const project = makeProject([videoTrack, audioTrack]);
    const pipeline = new ExportPipeline();

    const result = pipeline.build(project, { outputPath: '/tmp/out.mp4' }, new Map(), new Set());

    // Audio pad should be present
    expect(result.audioOutPad).not.toBeNull();
    expect(result.audioOutPad).toContain('maudio');
  });
});
