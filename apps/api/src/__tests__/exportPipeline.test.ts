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

  it('handles audio output pad correctly with aformat normalization', () => {
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

    // Audio pad should be present and use the normalized pad name
    expect(result.audioOutPad).not.toBeNull();
    expect(result.audioOutPad).toContain('anorm');
    // Should include aformat for reliable AAC encoding
    expect(result.filterComplex).toContain('aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo');
  });

  // ─── Export robustness fixes ─────────────────────────────────────────────────

  it('base canvas uses explicit format=yuv420p', () => {
    const clip = makeClip();
    const videoTrack = makeVideoTrack([clip]);
    const project = makeProject([videoTrack]);
    const pipeline = new ExportPipeline();

    const result = pipeline.build(project, { outputPath: '/tmp/out.mp4' }, new Map(), new Set());

    // Base canvas should have explicit format=yuv420p to avoid yuv444p negotiation issues
    expect(result.filterComplex).toContain('color=c=black:s=1080x1920:r=30,format=yuv420p[base]');
  });

  it('produces even dimensions when scale is non-integer', () => {
    // Use a clip with a non-1.0 scale that would produce odd dimensions
    // E.g., 1080 * 0.73 = 788.4 → Math.round = 788 (even), but 1920 * 0.73 = 1401.6 → old: 1402, new: 1402 (even)
    // More importantly: 1080 * 0.33 = 356.4 → 356 (even), 1920 * 0.33 = 633.6 → old: 634, new: 634 (even)
    // Edge case: 1080 * 0.5005 = 540.54 → 541 (ODD!) → should become 540 or 542
    const clip = makeClip({
      transform: { scale: 0.5005, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const videoTrack = makeVideoTrack([clip]);
    const project = makeProject([videoTrack]);
    const pipeline = new ExportPipeline();

    const result = pipeline.build(project, { outputPath: '/tmp/out.mp4' }, new Map(), new Set());

    // Extract scale dimensions from filter complex
    const scaleMatch = result.filterComplex.match(/scale=(\d+):(\d+):force_original_aspect_ratio/);
    expect(scaleMatch).not.toBeNull();
    const w = parseInt(scaleMatch![1]);
    const h = parseInt(scaleMatch![2]);
    // Both dimensions must be even
    expect(w % 2).toBe(0);
    expect(h % 2).toBe(0);
    // And the crop dimensions must match
    const cropMatch = result.filterComplex.match(/crop=(\d+):(\d+)/);
    expect(cropMatch).not.toBeNull();
    expect(parseInt(cropMatch![1]) % 2).toBe(0);
    expect(parseInt(cropMatch![2]) % 2).toBe(0);
  });

  it('handles project with no audio tracks (video only)', () => {
    const clip = makeClip();
    const videoTrack = makeVideoTrack([clip]);
    const project = makeProject([videoTrack]);
    const pipeline = new ExportPipeline();

    const result = pipeline.build(project, { outputPath: '/tmp/out.mp4' }, new Map(), new Set());

    // No audio pad when no audio tracks
    expect(result.audioOutPad).toBeNull();
    // Video should still work
    expect(result.videoOutPad).toBeTruthy();
    expect(result.filterComplex).toContain('overlay=');
  });

  it('handles project with no clips (empty project)', () => {
    const project = makeProject([]);
    const pipeline = new ExportPipeline();

    const result = pipeline.build(project, { outputPath: '/tmp/out.mp4' }, new Map(), new Set());

    // Should still produce a base canvas
    expect(result.filterComplex).toContain('color=c=black');
    expect(result.videoOutPad).toBe('base');
    expect(result.audioOutPad).toBeNull();
  });

  it('includes aformat in multi-audio amix output', () => {
    const clip = makeClip({ useClipAudio: true });
    const videoTrack = makeVideoTrack([clip]);

    // Create audio asset and video asset audio WAV
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

    // Video asset needs an audioPath for useClipAudio
    const asset1Dir = ws.getAssetDir('asset1');
    fs.writeFileSync(path.join(asset1Dir, 'audio.wav'), 'fake-wav');
    ws.upsertAsset({
      id: 'asset1',
      name: 'test.mp4',
      type: 'video',
      originalPath: 'assets/asset1/proxy.mp4',
      proxyPath: 'assets/asset1/proxy.mp4',
      audioPath: 'assets/asset1/audio.wav',
      maskPath: 'assets/asset1/mask.mp4',
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

    // Multi-audio: should have amix followed by aformat
    expect(result.filterComplex).toContain('amix=inputs=2');
    expect(result.filterComplex).toContain('aformat=sample_fmts=fltp');
    expect(result.audioOutPad).toBe('[aout]');
  });
});
