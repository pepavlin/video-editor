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

// Mock execFileSync to avoid real ffmpeg calls
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    execFileSync: vi.fn((cmd: string, args: string[]) => {
      if (args.includes('-show_streams')) {
        // Return fake ffprobe output
        return Buffer.from(JSON.stringify({
          streams: [
            {
              codec_type: 'video',
              width: 1920,
              height: 1080,
              r_frame_rate: '30/1',
            },
            {
              codec_type: 'audio',
            },
          ],
          format: {
            duration: '10.5',
          },
        }));
      }
      return Buffer.from('');
    }),
  };
});

import { config } from '../config';
import {
  probeFile,
  generateAss,
  buildExportCommand,
  type ProbeResult,
} from '../services/ffmpegService';

import type { Project, LyricsData } from '@video-editor/shared';

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 've-ff-'));
  (config as any).workspaceDir = tmpDir;
  fs.mkdirSync(path.join(tmpDir, 'projects'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'assets.json'), '[]');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── probeFile ───────────────────────────────────────────────────────────────

describe('probeFile', () => {
  it('parses video stream dimensions', () => {
    const result = probeFile('/fake/path.mp4');
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.fps).toBe(30);
    expect(result.hasVideo).toBe(true);
    expect(result.hasAudio).toBe(true);
    expect(result.duration).toBeCloseTo(10.5, 1);
  });

  it('handles fractional fps', async () => {
    const { execFileSync } = await import('child_process');
    vi.mocked(execFileSync).mockReturnValueOnce(
      Buffer.from(JSON.stringify({
        streams: [{ codec_type: 'video', width: 1080, height: 1920, r_frame_rate: '60000/1001' }],
        format: { duration: '5.0' },
      }))
    );
    const result = probeFile('/fake/60fps.mp4');
    expect(result.fps).toBeCloseTo(59.94, 1);
  });
});

// ─── generateAss ─────────────────────────────────────────────────────────────

describe('generateAss', () => {
  function makeLyrics(words: { word: string; start: number; end: number }[]): LyricsData {
    return {
      text: words.map((w) => w.word).join(' '),
      words,
      enabled: true,
      style: {
        fontSize: 48,
        color: '#FFFFFF',
        highlightColor: '#FFE600',
        position: 'bottom',
        wordsPerChunk: 3,
      },
    };
  }

  it('generates valid ASS file with header', () => {
    const lyrics = makeLyrics([
      { word: 'Hello', start: 0, end: 0.5 },
      { word: 'World', start: 0.5, end: 1.0 },
    ]);
    const outPath = path.join(tmpDir, 'test.ass');
    generateAss(lyrics, outPath);

    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('[Script Info]');
    expect(content).toContain('[V4+ Styles]');
    expect(content).toContain('[Events]');
    expect(content).toContain('Dialogue:');
  });

  it('generates correct number of dialogue events per word', () => {
    const lyrics = makeLyrics([
      { word: 'One', start: 0, end: 0.4 },
      { word: 'Two', start: 0.4, end: 0.8 },
      { word: 'Three', start: 0.8, end: 1.2 },
    ]);
    const outPath = path.join(tmpDir, 'test2.ass');
    generateAss(lyrics, outPath);

    const content = fs.readFileSync(outPath, 'utf8');
    const dialogueLines = content.split('\n').filter((l) => l.startsWith('Dialogue:'));
    // 3 words in one chunk = 3 dialogue lines (one per word highlight)
    expect(dialogueLines).toHaveLength(3);
  });

  it('highlights current word with different color', () => {
    const lyrics = makeLyrics([
      { word: 'Hello', start: 0, end: 0.5 },
      { word: 'World', start: 0.5, end: 1.0 },
    ]);
    const outPath = path.join(tmpDir, 'test3.ass');
    generateAss(lyrics, outPath);
    const content = fs.readFileSync(outPath, 'utf8');
    // Should have color override tags
    expect(content).toContain('\\c');
  });

  it('formats timestamps correctly', () => {
    const lyrics = makeLyrics([
      { word: 'At', start: 65.5, end: 66.0 }, // 1m 5.5s
    ]);
    const outPath = path.join(tmpDir, 'test4.ass');
    generateAss(lyrics, outPath);
    const content = fs.readFileSync(outPath, 'utf8');
    // Should contain 0:01:05.50 format
    expect(content).toContain('0:01:05');
  });

  it('handles empty words array gracefully', () => {
    const lyrics: LyricsData = { text: '', words: [], enabled: true };
    const outPath = path.join(tmpDir, 'empty.ass');
    expect(() => generateAss(lyrics, outPath)).not.toThrow();
    const content = fs.readFileSync(outPath, 'utf8');
    expect(content).toContain('[Script Info]');
  });

  it('splits words into chunks based on wordsPerChunk', () => {
    const words = Array.from({ length: 9 }, (_, i) => ({
      word: `word${i}`,
      start: i * 0.5,
      end: (i + 1) * 0.5,
    }));
    const lyrics = makeLyrics(words);
    lyrics.style!.wordsPerChunk = 3;
    const outPath = path.join(tmpDir, 'chunks.ass');
    generateAss(lyrics, outPath);
    const content = fs.readFileSync(outPath, 'utf8');
    const dialogueLines = content.split('\n').filter((l) => l.startsWith('Dialogue:'));
    // 9 words / 3 per chunk = 3 chunks, each with 3 dialogue lines = 9 total
    expect(dialogueLines).toHaveLength(9);
  });
});

// ─── buildExportCommand ───────────────────────────────────────────────────────

describe('buildExportCommand', () => {
  function makeProject(overrides: Partial<Project> = {}): Project {
    const now = new Date().toISOString();
    return {
      id: 'proj_test',
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

  it('produces a command with ffmpeg as the cmd', () => {
    const project = makeProject();
    const { cmd } = buildExportCommand(
      project,
      { outputPath: '/tmp/out.mp4' },
      new Map()
    );
    expect(cmd).toBe('ffmpeg');
  });

  it('includes -y flag for overwrite', () => {
    const project = makeProject();
    const { args } = buildExportCommand(project, { outputPath: '/tmp/out.mp4' }, new Map());
    expect(args[0]).toBe('-y');
  });

  it('includes output path as last argument', () => {
    const project = makeProject();
    const { args } = buildExportCommand(
      project,
      { outputPath: '/tmp/specific-output.mp4' },
      new Map()
    );
    expect(args[args.length - 1]).toBe('/tmp/specific-output.mp4');
  });

  it('includes -filter_complex', () => {
    const project = makeProject();
    const { args } = buildExportCommand(project, { outputPath: '/tmp/out.mp4' }, new Map());
    expect(args).toContain('-filter_complex');
  });

  it('includes base canvas in filter_complex', () => {
    const project = makeProject();
    const { args } = buildExportCommand(project, { outputPath: '/tmp/out.mp4' }, new Map());
    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1];
    expect(fc).toContain('color=c=black:s=1080x1920');
    expect(fc).toContain('[base]');
  });

  it('uses custom resolution', () => {
    const project = makeProject({ outputResolution: { w: 720, h: 1280 } });
    const { args } = buildExportCommand(
      project,
      { outputPath: '/tmp/out.mp4', width: 720, height: 1280 },
      new Map()
    );
    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1];
    expect(fc).toContain('720x1280');
  });

  it('includes custom CRF', () => {
    const project = makeProject();
    const { args } = buildExportCommand(
      project,
      { outputPath: '/tmp/out.mp4', crf: 28 },
      new Map()
    );
    const crfIdx = args.indexOf('-crf');
    expect(args[crfIdx + 1]).toBe('28');
  });

  it('includes custom preset', () => {
    const project = makeProject();
    const { args } = buildExportCommand(
      project,
      { outputPath: '/tmp/out.mp4', preset: 'fast' },
      new Map()
    );
    const presetIdx = args.indexOf('-preset');
    expect(args[presetIdx + 1]).toBe('fast');
  });

  it('does not include -map audio when no audio tracks', () => {
    const project = makeProject(); // no tracks
    const { args } = buildExportCommand(project, { outputPath: '/tmp/out.mp4' }, new Map());
    // Should have exactly one -map (for video)
    const mapCount = args.filter((a) => a === '-map').length;
    expect(mapCount).toBe(1);
  });

  it('filter_complex has valid beat zoom enable expression with gt()', () => {
    // Create a project with a video track (beatZoom) and a master audio track.
    // Beat zoom reads beats from the master audio asset, not the video asset.
    const videoAsset = {
      id: 'a1',
      name: 'test.mp4',
      type: 'video' as const,
      originalPath: 'assets/a1/original.mp4',
      proxyPath: 'assets/a1/proxy.mp4',
      duration: 10,
      createdAt: new Date().toISOString(),
    };
    const audioAsset = {
      id: 'audio1',
      name: 'music.mp3',
      type: 'audio' as const,
      originalPath: 'assets/audio1/original.mp3',
      duration: 10,
      createdAt: new Date().toISOString(),
    };

    // Write both assets to index
    fs.writeFileSync(
      path.join(tmpDir, 'assets.json'),
      JSON.stringify([videoAsset, audioAsset])
    );
    // Create fake proxy file path
    fs.mkdirSync(path.join(tmpDir, 'assets', 'a1'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'assets', 'a1', 'proxy.mp4'), '');
    fs.mkdirSync(path.join(tmpDir, 'assets', 'audio1'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'assets', 'audio1', 'original.mp3'), '');

    const project = makeProject({
      tracks: [
        {
          id: 'track1',
          type: 'video',
          name: 'V1',
          clips: [
            {
              id: 'clip1',
              assetId: 'a1',
              trackId: 'track1',
              timelineStart: 0,
              timelineEnd: 5,
              sourceStart: 0,
              sourceEnd: 5,
              useClipAudio: false,
              clipAudioVolume: 1,
              transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
              effects: [
                {
                  type: 'beatZoom' as const,
                  enabled: true,
                  intensity: 0.08,
                  durationMs: 120,
                  easing: 'easeOut' as const,
                },
              ],
            },
          ],
        },
        {
          id: 'track_master',
          type: 'audio',
          isMaster: true,
          name: 'Master Audio',
          clips: [
            {
              id: 'mclip1',
              assetId: 'audio1',
              trackId: 'track_master',
              timelineStart: 0,
              timelineEnd: 10,
              sourceStart: 0,
              sourceEnd: 10,
              useClipAudio: false,
              clipAudioVolume: 1,
              transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
              effects: [],
            },
          ],
        },
      ],
    });

    // Beats are keyed by master audio asset ID
    const beatsMap = new Map([['audio1', { tempo: 120, beats: [1.0, 1.5, 2.0] }]]);
    const { args } = buildExportCommand(project, { outputPath: '/tmp/out.mp4' }, beatsMap);

    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1];
    // Beat zoom: baked into the clip chain via crop=eval=frame.
    // During beat windows the crop reduces the source area (iw/ZF × ih/ZF), which
    // scale then upscales to fill the canvas — producing the zoom pulse.
    // No separate zoomed chain, no overlay+enable for zoom (unreliable in ffmpeg 8.x).
    expect(fc).toContain('crop=w='); // beat zoom crop filter is in the chain
    expect(fc).toContain('between(t,1'); // beat at 1.0s appears in crop expression
    expect(fc).not.toContain('clip0z]'); // no separate zoomed chain
    // All clips use timeline-aligned setpts so crop filter's `t` equals timeline time
    expect(fc).toContain('/TB'); // setpts=PTS-STARTPTS+timelineStart/TB
  });

  // ─── Cartoon effect ──────────────────────────────────────────────────────────

  function makeVideoProjectWithEffect(effects: any[]) {
    const videoAsset = {
      id: 'va1',
      name: 'clip.mp4',
      type: 'video' as const,
      originalPath: 'assets/va1/original.mp4',
      proxyPath: 'assets/va1/proxy.mp4',
      duration: 5,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(tmpDir, 'assets.json'), JSON.stringify([videoAsset]));
    fs.mkdirSync(path.join(tmpDir, 'assets', 'va1'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'assets', 'va1', 'proxy.mp4'), '');

    return makeProject({
      tracks: [
        {
          id: 'tr1',
          type: 'video',
          name: 'V1',
          clips: [
            {
              id: 'c1',
              assetId: 'va1',
              trackId: 'tr1',
              timelineStart: 0,
              timelineEnd: 5,
              sourceStart: 0,
              sourceEnd: 5,
              useClipAudio: false,
              clipAudioVolume: 1,
              transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
              effects,
            },
          ],
        },
      ],
    });
  }

  it('cartoon effect adds hqdn3d, edgedetect, blend and eq filters', () => {
    const project = makeVideoProjectWithEffect([
      {
        type: 'cartoon' as const,
        enabled: true,
        edgeStrength: 0.6,
        colorSimplification: 0.5,
        saturation: 1.5,
      },
    ]);

    const { args } = buildExportCommand(project, { outputPath: '/tmp/out.mp4' }, new Map());
    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1];

    expect(fc).toContain('hqdn3d=');
    expect(fc).toContain('edgedetect=');
    expect(fc).toContain('blend=all_mode=multiply');
    expect(fc).toContain('eq=saturation=');
    expect(fc).toContain('split');
  });

  it('cartoon effect disabled does not add cartoon filters', () => {
    const project = makeVideoProjectWithEffect([
      {
        type: 'cartoon' as const,
        enabled: false,
        edgeStrength: 0.6,
        colorSimplification: 0.5,
        saturation: 1.5,
      },
    ]);

    const { args } = buildExportCommand(project, { outputPath: '/tmp/out.mp4' }, new Map());
    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1];

    expect(fc).not.toContain('hqdn3d=');
    expect(fc).not.toContain('edgedetect=');
  });

  it('cartoon saturation is clamped to 0-3 range in filter', () => {
    const project = makeVideoProjectWithEffect([
      {
        type: 'cartoon' as const,
        enabled: true,
        edgeStrength: 0.5,
        colorSimplification: 0.5,
        saturation: 5.0, // over the limit
      },
    ]);

    const { args } = buildExportCommand(project, { outputPath: '/tmp/out.mp4' }, new Map());
    const fcIdx = args.indexOf('-filter_complex');
    const fc = args[fcIdx + 1];

    // Saturation should be clamped to 3.00
    expect(fc).toContain('eq=saturation=3.00');
  });

  // ─── Head Stabilization effect ───────────────────────────────────────────────

  it('head stabilization uses stabilized path when status is done', () => {
    const videoAsset = {
      id: 'hsa1',
      name: 'clip.mp4',
      type: 'video' as const,
      originalPath: 'assets/hsa1/original.mp4',
      proxyPath: 'assets/hsa1/proxy.mp4',
      headStabilizedPath: 'assets/hsa1/head_stabilized.mp4',
      duration: 5,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(tmpDir, 'assets.json'), JSON.stringify([videoAsset]));
    fs.mkdirSync(path.join(tmpDir, 'assets', 'hsa1'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'assets', 'hsa1', 'proxy.mp4'), '');
    fs.writeFileSync(path.join(tmpDir, 'assets', 'hsa1', 'head_stabilized.mp4'), '');

    const project = makeProject({
      tracks: [
        {
          id: 'tr1',
          type: 'video',
          name: 'V1',
          clips: [
            {
              id: 'c1',
              assetId: 'hsa1',
              trackId: 'tr1',
              timelineStart: 0,
              timelineEnd: 5,
              sourceStart: 0,
              sourceEnd: 5,
              useClipAudio: false,
              clipAudioVolume: 1,
              transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
              effects: [
                {
                  type: 'headStabilization' as const,
                  enabled: true,
                  smoothingX: 0.7,
                  smoothingY: 0.7,
                  smoothingZ: 0.0,
                  status: 'done' as const,
                },
              ],
            },
          ],
        },
      ],
    });

    const { args } = buildExportCommand(project, { outputPath: '/tmp/out.mp4' }, new Map());
    // The stabilized path should appear in the -i args
    expect(args).toContain(path.join(tmpDir, 'assets/hsa1/head_stabilized.mp4'));
    // The proxy path should NOT appear
    expect(args).not.toContain(path.join(tmpDir, 'assets/hsa1/proxy.mp4'));
  });

  it('head stabilization uses proxy when status is not done', () => {
    const videoAsset = {
      id: 'hsa2',
      name: 'clip.mp4',
      type: 'video' as const,
      originalPath: 'assets/hsa2/original.mp4',
      proxyPath: 'assets/hsa2/proxy.mp4',
      headStabilizedPath: 'assets/hsa2/head_stabilized.mp4',
      duration: 5,
      createdAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(tmpDir, 'assets.json'), JSON.stringify([videoAsset]));
    fs.mkdirSync(path.join(tmpDir, 'assets', 'hsa2'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'assets', 'hsa2', 'proxy.mp4'), '');

    const project = makeProject({
      tracks: [
        {
          id: 'tr1',
          type: 'video',
          name: 'V1',
          clips: [
            {
              id: 'c1',
              assetId: 'hsa2',
              trackId: 'tr1',
              timelineStart: 0,
              timelineEnd: 5,
              sourceStart: 0,
              sourceEnd: 5,
              useClipAudio: false,
              clipAudioVolume: 1,
              transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
              effects: [
                {
                  type: 'headStabilization' as const,
                  enabled: true,
                  smoothingX: 0.7,
                  smoothingY: 0.7,
                  smoothingZ: 0.0,
                  status: 'pending' as const,  // not done
                },
              ],
            },
          ],
        },
      ],
    });

    const { args } = buildExportCommand(project, { outputPath: '/tmp/out.mp4' }, new Map());
    // Should use proxy since status is not 'done'
    expect(args).toContain(path.join(tmpDir, 'assets/hsa2/proxy.mp4'));
  });
});
