/**
 * Clip Registry Tests
 *
 * Verifies the CLIP_REGISTRY dispatch logic and individual clip element export implementations.
 *
 * These tests focus on the export side (pure FFmpeg filter string generation)
 * since the preview side requires browser DOM APIs (Canvas, HTMLVideoElement)
 * which are not available in the Node.js test environment.
 */

import { describe, it, expect, vi } from 'vitest';
import { CLIP_REGISTRY, generateAssContent } from '../index';
import type { Clip, Track, Project, BeatsData } from '@video-editor/shared';
import type { ExportFilterContext } from '../types';

// ─── Test helpers ──────────────────────────────────────────────────────────────

function makeTrack(type: Track['type'], overrides: Partial<Track> = {}): Track {
  return {
    id: 'track1',
    type,
    name: 'Test Track',
    clips: [],
    ...overrides,
  };
}

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

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj1',
    name: 'Test Project',
    duration: 10,
    aspectRatio: '9:16',
    outputResolution: { w: 1080, h: 1920 },
    tracks: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeExportContext(overrides: Partial<ExportFilterContext> = {}): ExportFilterContext {
  const writtenFiles = new Map<string, string>();
  return {
    project: makeProject(),
    assetPathMap: new Map([['asset1', '/tmp/asset1.mp4']]),
    assetInputIdxMap: new Map([['asset1', 1]]),
    clipAudioWavMap: new Map(),
    assetMaskInputIdxMap: new Map(),
    W: 1080,
    H: 1920,
    beatsMap: new Map<string, BeatsData>(),
    masterAudioClip: undefined,
    projectDir: '/tmp/project',
    writeFile: (path, content) => { writtenFiles.set(path, content); },
    ...overrides,
  };
}

// ─── CLIP_REGISTRY dispatch tests ────────────────────────────────────────────

describe('CLIP_REGISTRY', () => {
  it('has 4 registered elements', () => {
    expect(CLIP_REGISTRY).toHaveLength(4);
  });

  it('dispatches text clips to TextClipElement (not VideoClipElement)', () => {
    const clip = makeClip({ textContent: 'Hello' });
    const track = makeTrack('video');
    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track));
    expect(element?.clipType).toBe('text');
  });

  it('dispatches rectangle clips to RectangleClipElement', () => {
    const clip = makeClip({
      rectangleStyle: { color: '#ff0000', fillOpacity: 1, width: 100, height: 100 },
    });
    const track = makeTrack('video');
    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track));
    expect(element?.clipType).toBe('rectangle');
  });

  it('dispatches lyrics track clips to LyricsClipElement', () => {
    const clip = makeClip({
      lyricsWords: [{ word: 'Hello', start: 0, end: 0.5 }],
    });
    const track = makeTrack('lyrics');
    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track));
    expect(element?.clipType).toBe('lyrics');
  });

  it('dispatches plain video clips to VideoClipElement', () => {
    const clip = makeClip(); // no text, rectangle, or lyrics
    const track = makeTrack('video');
    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track));
    expect(element?.clipType).toBe('video');
  });

  it('prefers rectangle over video for clips with rectangleStyle on video track', () => {
    const clip = makeClip({
      rectangleStyle: { color: '#00ff00', fillOpacity: 0.5, width: 200, height: 200 },
    });
    const track = makeTrack('video');
    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track));
    expect(element?.clipType).toBe('rectangle');
  });

  it('prefers text over video for clips with textContent on video track', () => {
    const clip = makeClip({ textContent: 'Test text' });
    const track = makeTrack('video');
    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track));
    expect(element?.clipType).toBe('text');
  });

  it('returns undefined for clips on audio tracks', () => {
    const clip = makeClip();
    const track = makeTrack('audio');
    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track));
    // No element should handle audio clips
    expect(element).toBeUndefined();
  });

  it('does NOT dispatch lyrics clip without lyricsWords to LyricsClipElement', () => {
    const clip = makeClip({ lyricsWords: [] }); // empty words
    const track = makeTrack('lyrics');
    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track));
    // LyricsClipElement requires non-empty lyricsWords
    expect(element?.clipType).not.toBe('lyrics');
  });
});

// ─── TextClip export tests ─────────────────────────────────────────────────────

describe('TextClip.export.buildFilter', () => {
  it('generates drawtext filter for a text clip', () => {
    const clip = makeClip({
      textContent: 'Hello World',
      transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const track = makeTrack('video');
    const context = makeExportContext();

    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track))!;
    expect(element.clipType).toBe('text');

    const result = element.export.buildFilter('base', clip, track, 0, context);
    expect(result).not.toBeNull();
    expect(result!.filters.length).toBeGreaterThan(0);
    const filterStr = result!.filters.join('; ');
    expect(filterStr).toContain('drawtext');
    expect(filterStr).toContain('Hello World');
    expect(filterStr).toContain("between(t,0.0000,3.0000)");
    expect(result!.outputPad).toBe('txt0');
    expect(result!.nextFilterIdx).toBe(1);
  });

  it('includes font color in drawtext filter', () => {
    const clip = makeClip({
      textContent: 'Colored text',
      textStyle: {
        fontFamily: 'Arial',
        fontSize: 96,
        color: '#FF0000',
        bold: false,
        italic: false,
        align: 'center',
      },
    });
    const track = makeTrack('video');
    const result = CLIP_REGISTRY.find((e) => e.canHandle(clip, track))!
      .export.buildFilter('base', clip, track, 5, makeExportContext());
    const filterStr = result!.filters.join('; ');
    expect(filterStr).toContain('0xFF0000');
    expect(result!.outputPad).toBe('txt5');
    expect(result!.nextFilterIdx).toBe(6);
  });

  it('returns null for clip without textContent', () => {
    const clip = makeClip(); // no textContent
    const track = makeTrack('video');
    const element = CLIP_REGISTRY.find((e) => e.clipType === 'text')!;
    const result = element.export.buildFilter('base', clip, track, 0, makeExportContext());
    expect(result).toBeNull();
  });

  it('escapes special characters in text', () => {
    const clip = makeClip({ textContent: "It's a test: colon" });
    const track = makeTrack('video');
    const result = CLIP_REGISTRY.find((e) => e.canHandle(clip, track))!
      .export.buildFilter('base', clip, track, 0, makeExportContext());
    const filterStr = result!.filters.join('; ');
    // Apostrophe and colon should be escaped
    expect(filterStr).toContain("\\'");
    expect(filterStr).toContain('\\:');
  });
});

// ─── RectangleClip export tests ───────────────────────────────────────────────

describe('RectangleClip.export.buildFilter', () => {
  it('generates drawbox filter for a rectangle clip', () => {
    const clip = makeClip({
      rectangleStyle: {
        color: '#0000FF',
        fillOpacity: 1,
        width: 300,
        height: 200,
      },
      transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const track = makeTrack('video');
    const context = makeExportContext();

    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track))!;
    expect(element.clipType).toBe('rectangle');

    const result = element.export.buildFilter('base', clip, track, 0, context);
    expect(result).not.toBeNull();
    const filterStr = result!.filters.join('; ');
    expect(filterStr).toContain('drawbox');
    expect(filterStr).toContain('0x0000FF');
    expect(filterStr).toContain("between(t,0.0000,3.0000)");
    expect(result!.outputPad).toBe('recto0');
    expect(result!.nextFilterIdx).toBe(1);
  });

  it('includes border filter when border is configured', () => {
    const clip = makeClip({
      rectangleStyle: {
        color: '#FFFFFF',
        fillOpacity: 0.5,
        width: 100,
        height: 100,
        borderColor: '#000000',
        borderWidth: 4,
      },
    });
    const track = makeTrack('video');
    const result = CLIP_REGISTRY.find((e) => e.canHandle(clip, track))!
      .export.buildFilter('base', clip, track, 0, makeExportContext());
    const filterStr = result!.filters.join('; ');
    // Should have both fill and border drawbox
    expect(filterStr.match(/drawbox/g)?.length).toBeGreaterThanOrEqual(2);
    expect(filterStr).toContain('0x000000');
  });

  it('returns null for clip without rectangleStyle', () => {
    const clip = makeClip();
    const track = makeTrack('video');
    const element = CLIP_REGISTRY.find((e) => e.clipType === 'rectangle')!;
    const result = element.export.buildFilter('base', clip, track, 0, makeExportContext());
    expect(result).toBeNull();
  });
});

// ─── LyricsClip export tests ───────────────────────────────────────────────────

describe('LyricsClip.export.buildFilter', () => {
  it('generates subtitles filter and writes ASS file', () => {
    const writtenFiles = new Map<string, string>();
    const clip = makeClip({
      lyricsWords: [
        { word: 'Hello', start: 0.0, end: 0.5 },
        { word: 'World', start: 0.5, end: 1.0 },
      ],
      lyricsContent: 'Hello World',
    });
    const track = makeTrack('lyrics');
    const context = makeExportContext({
      writeFile: (path, content) => writtenFiles.set(path, content),
    });

    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track))!;
    expect(element.clipType).toBe('lyrics');

    const result = element.export.buildFilter('base', clip, track, 2, context);
    expect(result).not.toBeNull();
    expect(result!.outputPad).toBe('lyr2');
    expect(result!.nextFilterIdx).toBe(3);

    const filterStr = result!.filters.join('; ');
    expect(filterStr).toContain('subtitles=');
    expect(filterStr).toContain('lyrics_2.ass');

    // Verify ASS file was written
    expect(writtenFiles.size).toBe(1);
    const assContent = writtenFiles.values().next().value;
    expect(assContent).toContain('[Script Info]');
    expect(assContent).toContain('Dialogue:');
    expect(assContent).toContain('Hello');
    expect(assContent).toContain('World');
  });

  it('returns null for clip without lyricsWords', () => {
    const clip = makeClip();
    const track = makeTrack('lyrics');
    const element = CLIP_REGISTRY.find((e) => e.clipType === 'lyrics')!;
    const result = element.export.buildFilter('base', clip, track, 0, makeExportContext());
    expect(result).toBeNull();
  });

  it('returns null for clip with empty lyricsWords', () => {
    const clip = makeClip({ lyricsWords: [] });
    const track = makeTrack('lyrics');
    const element = CLIP_REGISTRY.find((e) => e.clipType === 'lyrics')!;
    const result = element.export.buildFilter('base', clip, track, 0, makeExportContext());
    expect(result).toBeNull();
  });
});

// ─── VideoClip export tests ───────────────────────────────────────────────────

describe('VideoClip.export.buildFilter', () => {
  it('generates trim+scale+overlay filter chain for a video clip', () => {
    const clip = makeClip({
      transform: { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1 },
    });
    const track = makeTrack('video');
    const context = makeExportContext();

    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track))!;
    expect(element.clipType).toBe('video');

    const result = element.export.buildFilter('base', clip, track, 0, context);
    expect(result).not.toBeNull();

    const filterStr = result!.filters.join('; ');
    expect(filterStr).toContain('[1:v]trim=');
    expect(filterStr).toContain('setpts=');
    expect(filterStr).toContain('scale=');
    expect(filterStr).toContain('overlay=');
    expect(filterStr).toContain("between(t,0.0000,3.0000)");
    expect(result!.outputPad).toBe('ov0');
    expect(result!.nextFilterIdx).toBe(1);
  });

  it('returns null when asset is not in assetInputIdxMap', () => {
    const clip = makeClip({ assetId: 'unknown-asset' });
    const track = makeTrack('video');
    const context = makeExportContext(); // assetInputIdxMap has 'asset1' but not 'unknown-asset'
    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track))!;
    const result = element.export.buildFilter('base', clip, track, 0, context);
    expect(result).toBeNull();
  });

  it('chains prevPad correctly', () => {
    const clip = makeClip();
    const track = makeTrack('video');
    const context = makeExportContext();
    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track))!;

    const result = element.export.buildFilter('myPrevPad', clip, track, 3, context);
    expect(result).not.toBeNull();
    const filterStr = result!.filters.join('; ');
    // The overlay filter should use our prevPad
    expect(filterStr).toContain('[myPrevPad]');
    expect(result!.outputPad).toBe('ov3');
    expect(result!.nextFilterIdx).toBe(4);
  });

  it('applies transform.scale and transform.x/y offset', () => {
    const clip = makeClip({
      transform: { scale: 0.5, x: 100, y: -50, rotation: 0, opacity: 1 },
    });
    const track = makeTrack('video');
    const context = makeExportContext();
    const element = CLIP_REGISTRY.find((e) => e.canHandle(clip, track))!;
    const result = element.export.buildFilter('base', clip, track, 0, context);
    const filterStr = result!.filters.join('; ');

    // scale=0.5 on 1080x1920 → 540x960
    expect(filterStr).toContain('scale=540:960');
    // overlay position: (W - scaledW)/2 + tx = (1080-540)/2 + 100 = 370
    expect(filterStr).toContain('overlay=370');
  });
});

// ─── generateAssContent tests ─────────────────────────────────────────────────

describe('generateAssContent', () => {
  it('generates valid ASS header', () => {
    const lyrics = {
      text: 'Hello World',
      words: [
        { word: 'Hello', start: 0.0, end: 0.5 },
        { word: 'World', start: 0.5, end: 1.0 },
      ],
    };
    const content = generateAssContent(lyrics);
    expect(content).toContain('[Script Info]');
    expect(content).toContain('[V4+ Styles]');
    expect(content).toContain('[Events]');
    expect(content).toContain('Format: Layer, Start, End');
  });

  it('generates Dialogue entries for each word', () => {
    const lyrics = {
      text: 'a b c',
      words: [
        { word: 'a', start: 0.0, end: 0.5 },
        { word: 'b', start: 0.5, end: 1.0 },
        { word: 'c', start: 1.0, end: 1.5 },
      ],
      style: {
        fontSize: 48,
        color: '#FFFFFF',
        highlightColor: '#FFE600',
        position: 'bottom' as const,
        wordsPerChunk: 3,
      },
    };
    const content = generateAssContent(lyrics);
    const dialogues = content.split('\n').filter((l) => l.startsWith('Dialogue:'));
    // 3 words in one chunk → 3 Dialogue lines (one per word, each showing the chunk)
    expect(dialogues).toHaveLength(3);
  });

  it('respects wordsPerChunk setting', () => {
    const lyrics = {
      text: 'a b c d',
      words: [
        { word: 'a', start: 0.0, end: 0.5 },
        { word: 'b', start: 0.5, end: 1.0 },
        { word: 'c', start: 1.0, end: 1.5 },
        { word: 'd', start: 1.5, end: 2.0 },
      ],
      style: {
        fontSize: 48,
        color: '#FFFFFF',
        highlightColor: '#FFE600',
        position: 'bottom' as const,
        wordsPerChunk: 2, // chunks of 2
      },
    };
    const content = generateAssContent(lyrics);
    const dialogues = content.split('\n').filter((l) => l.startsWith('Dialogue:'));
    // 4 words / 2 per chunk = 2 chunks, 2 Dialogue lines each = 4 total
    expect(dialogues).toHaveLength(4);
  });

  it('converts color to ASS format', () => {
    const lyrics = {
      text: 'test',
      words: [{ word: 'test', start: 0, end: 1 }],
      style: {
        fontSize: 48,
        color: '#FFFFFF',
        highlightColor: '#FFE600',
        position: 'bottom' as const,
        wordsPerChunk: 3,
      },
    };
    const content = generateAssContent(lyrics);
    // #FFFFFF → &H00FFFFFF& in ASS format (BGR)
    expect(content).toContain('&H00FFFFFF&');
    // #FFE600 in ASS: &H0000E6FF& (reversed byte order)
    expect(content).toContain('&H0000E6FF&');
  });

  it('uses bottom alignment by default', () => {
    const lyrics = { text: 'test', words: [{ word: 'test', start: 0, end: 1 }] };
    const content = generateAssContent(lyrics);
    // Bottom alignment = 2 in ASS
    expect(content).toMatch(/Style:.*,2,/);
  });

  it('uses top alignment when configured', () => {
    const lyrics = {
      text: 'test',
      words: [{ word: 'test', start: 0, end: 1 }],
      style: {
        fontSize: 48,
        color: '#FFFFFF',
        highlightColor: '#FFE600',
        position: 'top' as const,
        wordsPerChunk: 3,
      },
    };
    const content = generateAssContent(lyrics);
    // Top alignment = 8 in ASS
    expect(content).toMatch(/Style:.*,8,/);
  });
});
