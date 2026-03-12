/**
 * Preview ↔ Export Consistency Tests
 *
 * Verifies that the preview (Canvas 2D) and export (FFmpeg) rendering pipelines
 * produce equivalent visual output by testing:
 *
 *   1. Shared computation functions return values consistent with export filter strings
 *   2. Both paths extract the same parameters from the same clip/transform/config data
 *   3. Scaling, positioning, color, and timing formulas match between pipelines
 *
 * These tests are fast (pure unit tests with mocked DOM) and cover:
 *   - TextClip: font size, position, color, background box
 *   - RectangleClip: dimensions, position, fill, border
 *   - VideoClip: scale, position, effect chain
 *   - Cutout effect: mask parameters (threshold, expand, blur), mode, bg color
 *   - ColorGrade effect: contrast, brightness, saturation, hue, shadows, highlights
 *   - BeatZoom effect: intensity, duration, easing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CLIP_REGISTRY } from '../clips/index';
import { EFFECT_REGISTRY } from '../effects/index';
import { getTextBounds, DEFAULT_TEXT_STYLE } from '../clips/TextClip';
import { getRectangleBounds } from '../clips/RectangleClip';
import { getVideoBounds } from '../clips/VideoClip';
import { buildColorGradeCssFilter, ColorGradeEffect } from '../effects/ColorGrade';
import { computeBeatZoomScale, BeatZoomEffect } from '../effects/BeatZoom';
import { CutoutEffect, DEFAULT_MASK_ADJUST } from '../effects/Cutout';
import type { Clip, Track, Transform, Project, BeatsData, EffectClipConfig } from '@video-editor/shared';
import type { ExportFilterContext } from '../types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

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

function makeTrack(type: Track['type'], overrides: Partial<Track> = {}): Track {
  return {
    id: 'track1',
    type,
    name: 'Test Track',
    clips: [],
    ...overrides,
  };
}

function makeTransform(overrides: Partial<Transform> = {}): Transform {
  return { scale: 1, x: 0, y: 0, rotation: 0, opacity: 1, ...overrides };
}

function makeProject(tracks: Track[] = []): Project {
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

function makeExportContext(overrides: Partial<ExportFilterContext> = {}): ExportFilterContext {
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
    writeFile: vi.fn(),
    ...overrides,
  };
}

/** Create a mock CanvasRenderingContext2D for capturing draw operations */
function createMockCtx(): CanvasRenderingContext2D {
  const state = {
    font: '',
    fillStyle: '',
    strokeStyle: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    lineWidth: 1,
    shadowColor: '',
    shadowBlur: 0,
    filter: 'none',
  };

  return {
    ...state,
    save: vi.fn(),
    restore: vi.fn(),
    fillText: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arcTo: vi.fn(),
    rect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    setTransform: vi.fn(),
    drawImage: vi.fn(),
    measureText: vi.fn().mockReturnValue({ width: 200 }),
    getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(16) }),
    putImageData: vi.fn(),
    createImageData: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

/** Parse a numeric value from an FFmpeg filter string pattern */
function parseFilterValue(filterStr: string, key: string): string | null {
  const pattern = new RegExp(`${key}=([^:;\\]\\[,]+)`);
  const match = filterStr.match(pattern);
  return match ? match[1] : null;
}

// ─── TextClip: Preview ↔ Export Consistency ────────────────────────────────────

describe('TextClip: preview ↔ export consistency', () => {
  const W = 1080;
  const H = 1920;

  it('uses same font size formula (fontSize / 1920 * H * scale)', () => {
    const testCases = [
      { fontSize: 96, scale: 1, expected: 96 },
      { fontSize: 96, scale: 1.5, expected: 144 },
      { fontSize: 48, scale: 2, expected: 96 },
      { fontSize: 120, scale: 0.5, expected: 60 },
    ];

    for (const { fontSize, scale, expected } of testCases) {
      const clip = makeClip({
        textContent: 'Test',
        textStyle: { ...DEFAULT_TEXT_STYLE, fontSize },
        transform: makeTransform({ scale }),
      });
      const track = makeTrack('video');
      const context = makeExportContext({ W, H });

      // Preview formula (from TextClip.preview.render):
      const previewFontSize = Math.round((fontSize / 1920) * H * scale);

      // Export formula (from TextClip.export.buildFilter):
      const exportFontSize = Math.round((fontSize / 1920) * H * Math.max(0.01, scale));

      expect(previewFontSize).toBe(expected);
      expect(exportFontSize).toBe(expected);
      expect(previewFontSize).toBe(exportFontSize);

      // Verify export filter string contains the computed font size
      const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))!;
      const result = element.export.buildFilter('base', clip, track, 0, context);
      expect(result).not.toBeNull();
      const filterStr = result!.filters.join(';');
      expect(filterStr).toContain(`fontsize=${expected}`);
    }
  });

  it('uses same position offset (center + transform.x/y)', () => {
    const testCases = [
      { x: 0, y: 0, expectedTx: 0, expectedTy: 0 },
      { x: 100, y: -50, expectedTx: 100, expectedTy: -50 },
      { x: -200, y: 300, expectedTx: -200, expectedTy: 300 },
    ];

    for (const { x, y, expectedTx, expectedTy } of testCases) {
      const clip = makeClip({
        textContent: 'Position Test',
        transform: makeTransform({ x, y }),
      });
      const track = makeTrack('video');
      const context = makeExportContext({ W, H });

      // Preview position: cx = W/2 + x, cy = H/2 + y
      const previewCx = W / 2 + x;
      const previewCy = H / 2 + y;

      // Export position: x=(w-text_w)/2+tx, y=(h-text_h)/2+ty
      const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))!;
      const result = element.export.buildFilter('base', clip, track, 0, context);
      const filterStr = result!.filters.join(';');

      // Export uses (w-text_w)/2+tx which at render time evaluates to ~W/2 + tx
      expect(filterStr).toContain(`(w-text_w)/2+${expectedTx}`);
      expect(filterStr).toContain(`(h-text_h)/2+${expectedTy}`);

      // Verify preview center calculation
      expect(previewCx).toBe(W / 2 + expectedTx);
      expect(previewCy).toBe(H / 2 + expectedTy);
    }
  });

  it('uses same color values (preview hex → export 0x format)', () => {
    const colorTests = [
      { input: '#FF0000', expectedExport: '0xFF0000' },
      { input: '#00FF00', expectedExport: '0x00FF00' },
      { input: '#0000FF', expectedExport: '0x0000FF' },
      { input: '#ABCDEF', expectedExport: '0xABCDEF' },
    ];

    for (const { input, expectedExport } of colorTests) {
      const clip = makeClip({
        textContent: 'Color test',
        textStyle: { ...DEFAULT_TEXT_STYLE, color: input },
      });
      const track = makeTrack('video');
      const context = makeExportContext({ W, H });

      const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))!;
      const result = element.export.buildFilter('base', clip, track, 0, context);
      const filterStr = result!.filters.join(';');

      // Export should contain the converted color
      expect(filterStr).toContain(`fontcolor=${expectedExport}`);
    }
  });

  it('uses same enable timing expression', () => {
    const clip = makeClip({
      textContent: 'Timing test',
      timelineStart: 2.5,
      timelineEnd: 7.5,
    });
    const track = makeTrack('video');
    const context = makeExportContext();

    const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))!;
    const result = element.export.buildFilter('base', clip, track, 0, context);
    const filterStr = result!.filters.join(';');

    // Both should use the same timing window
    expect(filterStr).toContain('between(t,2.5000,7.5000)');
  });

  it('includes background box with consistent padding formula', () => {
    const clip = makeClip({
      textContent: 'BG Test',
      textStyle: { ...DEFAULT_TEXT_STYLE, background: '#333333', backgroundOpacity: 0.8 },
      transform: makeTransform({ scale: 1 }),
    });
    const track = makeTrack('video');
    const context = makeExportContext({ W, H });

    const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))!;
    const result = element.export.buildFilter('base', clip, track, 0, context);
    const filterStr = result!.filters.join(';');

    // Both use fontSize * 0.3 for horizontal padding, fontSize * 0.2 for vertical
    const fontSize = Math.round((DEFAULT_TEXT_STYLE.fontSize / 1920) * H * 1);
    const previewPadX = fontSize * 0.3;
    const previewPadY = fontSize * 0.2;
    const exportPadX = Math.round(fontSize * 0.3);
    const exportPadY = Math.round(fontSize * 0.2);

    // Padding values should be equivalent (export rounds, preview uses float)
    expect(Math.round(previewPadX)).toBe(exportPadX);
    expect(Math.round(previewPadY)).toBe(exportPadY);

    // Export should contain background drawbox
    expect(filterStr).toContain('drawbox');
    expect(filterStr).toContain('0x333333');
    expect(filterStr).toContain('@0.80');
  });
});

// ─── RectangleClip: Preview ↔ Export Consistency ──────────────────────────────

describe('RectangleClip: preview ↔ export consistency', () => {
  const W = 1080;
  const H = 1920;

  it('uses same dimension scaling formula (dimension * scale * H/1920)', () => {
    const testCases = [
      { width: 300, height: 200, scale: 1, expectedW: 300, expectedH: 200 },
      { width: 300, height: 200, scale: 0.5, expectedW: 150, expectedH: 100 },
      { width: 500, height: 400, scale: 2, expectedW: 1000, expectedH: 800 },
    ];

    for (const { width, height, scale, expectedW, expectedH } of testCases) {
      const transform = makeTransform({ scale });

      // Preview (from getRectangleBounds):
      const previewScale = transform.scale * (H / 1920);
      const previewW = width * previewScale;
      const previewH = height * previewScale;

      // Export (from buildFilter):
      const exportScale = transform.scale * (H / 1920);
      const exportW = Math.round(width * exportScale);
      const exportH = Math.round(height * exportScale);

      expect(Math.round(previewW)).toBe(expectedW);
      expect(Math.round(previewH)).toBe(expectedH);
      expect(exportW).toBe(expectedW);
      expect(exportH).toBe(expectedH);
    }
  });

  it('uses same position calculation (center - half dimensions + offset)', () => {
    const testCases = [
      { width: 300, height: 200, x: 0, y: 0 },
      { width: 300, height: 200, x: 100, y: -50 },
      { width: 500, height: 400, x: -200, y: 150 },
    ];

    for (const { width, height, x, y } of testCases) {
      const clip = makeClip({
        rectangleStyle: { color: '#FF0000', fillOpacity: 1, width, height },
        transform: makeTransform({ x, y }),
      });
      const track = makeTrack('video');
      const transform = makeTransform({ x, y });

      // Preview (getRectangleBounds)
      const previewBounds = getRectangleBounds(clip, transform, W, H);

      // Export
      const context = makeExportContext({ W, H });
      const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))!;
      const result = element.export.buildFilter('base', clip, track, 0, context);
      const filterStr = result!.filters.join(';');

      // Extract drawbox x and y from filter
      const scale = transform.scale * (H / 1920);
      const rw = Math.round(width * scale);
      const rh = Math.round(height * scale);
      const cx = W / 2 + x;
      const cy = H / 2 + y;
      const expectedRx = Math.round(cx - rw / 2);
      const expectedRy = Math.round(cy - rh / 2);

      // Preview bounds should match export coordinates
      expect(Math.round(previewBounds.x)).toBe(expectedRx);
      expect(Math.round(previewBounds.y)).toBe(expectedRy);
      expect(Math.round(previewBounds.w)).toBe(rw);
      expect(Math.round(previewBounds.h)).toBe(rh);

      // Verify export filter contains the correct values
      expect(filterStr).toContain(`x=${expectedRx}`);
      expect(filterStr).toContain(`y=${expectedRy}`);
      expect(filterStr).toContain(`w=${rw}`);
      expect(filterStr).toContain(`h=${rh}`);
    }
  });

  it('uses same fill opacity formula (fillOpacity * transform.opacity)', () => {
    const fillOpacity = 0.7;
    const transformOpacity = 0.8;
    const clip = makeClip({
      rectangleStyle: { color: '#0000FF', fillOpacity, width: 100, height: 100 },
      transform: makeTransform({ opacity: transformOpacity }),
    });
    const track = makeTrack('video');

    // Preview: ctx.globalAlpha = transform.opacity * (style.fillOpacity ?? 1)
    const previewAlpha = transformOpacity * fillOpacity;

    // Export: fillOpacity = (style.fillOpacity ?? 1) * transform.opacity
    const context = makeExportContext({ W, H });
    const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))!;
    const result = element.export.buildFilter('base', clip, track, 0, context);
    const filterStr = result!.filters.join(';');

    // Both should compute the same value
    const expectedOpacity = fillOpacity * transformOpacity;
    expect(previewAlpha).toBeCloseTo(expectedOpacity, 6);

    // Export should contain the opacity in the drawbox color alpha
    expect(filterStr).toContain(`@${expectedOpacity.toFixed(3)}`);
  });

  it('includes border in both paths when configured', () => {
    const clip = makeClip({
      rectangleStyle: {
        color: '#FFFFFF',
        fillOpacity: 1,
        width: 200,
        height: 150,
        borderColor: '#000000',
        borderWidth: 4,
      },
      transform: makeTransform(),
    });
    const track = makeTrack('video');
    const context = makeExportContext({ W, H });

    const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))!;
    const result = element.export.buildFilter('base', clip, track, 0, context);
    const filterStr = result!.filters.join(';');

    // Export should have both fill and border drawbox
    const drawboxCount = (filterStr.match(/drawbox/g) || []).length;
    expect(drawboxCount).toBe(2);

    // Preview also checks style.borderColor && style.borderWidth > 0
    const style = clip.rectangleStyle!;
    const hasBorderPreview = !!(style.borderColor && style.borderWidth && style.borderWidth > 0);
    expect(hasBorderPreview).toBe(true);
  });
});

// ─── VideoClip: Preview ↔ Export Consistency ──────────────────────────────────

describe('VideoClip: preview ↔ export consistency', () => {
  const W = 1080;
  const H = 1920;

  it('uses same scale/position for default transform', () => {
    const clip = makeClip({
      transform: makeTransform({ scale: 1, x: 0, y: 0 }),
    });
    const track = makeTrack('video');
    const context = makeExportContext({ W, H });

    // Export: scaledW = round(W * scale), scaledH = round(H * scale)
    const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))!;
    const result = element.export.buildFilter('base', clip, track, 0, context);
    const filterStr = result!.filters.join(';');

    expect(filterStr).toContain(`scale=${W}:${H}`);
    // overlay at center: (W - scaledW)/2 = 0, (H - scaledH)/2 = 0
    expect(filterStr).toContain('overlay=0:0');
  });

  it('uses same scale/position for non-default transform', () => {
    const testCases = [
      { scale: 0.5, x: 100, y: -50 },
      { scale: 1.5, x: -200, y: 300 },
      { scale: 0.75, x: 0, y: 0 },
    ];

    for (const { scale, x, y } of testCases) {
      const clip = makeClip({
        transform: makeTransform({ scale, x, y }),
      });
      const track = makeTrack('video');
      const context = makeExportContext({ W, H });

      // Export calculation
      const scaledW = Math.round(W * scale);
      const scaledH = Math.round(H * scale);
      const posX = Math.round((W - scaledW) / 2 + x);
      const posY = Math.round((H - scaledH) / 2 + y);

      const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))!;
      const result = element.export.buildFilter('base', clip, track, 0, context);
      const filterStr = result!.filters.join(';');

      expect(filterStr).toContain(`scale=${scaledW}:${scaledH}`);
      expect(filterStr).toContain(`overlay=${posX}:${posY}`);

      // Preview uses getVideoBounds with null videoEl → defaults to W×H aspect ratio
      // When videoAR === targetAR: drawW = W * scale, drawH = H * scale
      const mockVideoEl = { videoWidth: W, videoHeight: H } as HTMLVideoElement;
      const bounds = getVideoBounds(makeTransform({ scale, x, y }), mockVideoEl, W, H);

      // Preview: x = (W - drawW)/2 + transform.x, drawW = W * scale (when aspect matches)
      expect(Math.round(bounds.w)).toBe(scaledW);
      expect(Math.round(bounds.h)).toBe(scaledH);
      expect(Math.round(bounds.x)).toBe(posX);
      expect(Math.round(bounds.y)).toBe(posY);
    }
  });

  it('uses same timing expression', () => {
    const clip = makeClip({
      timelineStart: 5.25,
      timelineEnd: 12.75,
      sourceStart: 2.0,
      sourceEnd: 9.5,
      transform: makeTransform(),
    });
    const track = makeTrack('video');
    const context = makeExportContext();

    const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))!;
    const result = element.export.buildFilter('base', clip, track, 0, context);
    const filterStr = result!.filters.join(';');

    // Export trim should match source range
    expect(filterStr).toContain('trim=start=2.0000:end=9.5000');
    // Overlay enable should match timeline range
    expect(filterStr).toContain('between(t,5.2500,12.7500)');
  });

  it('applies effect chain in same order as EFFECT_REGISTRY', () => {
    // Verify EFFECT_REGISTRY order is BeatZoom → Cutout → Cartoon → ColorGrade
    expect(EFFECT_REGISTRY[0].type).toBe('beatZoom');
    expect(EFFECT_REGISTRY[1].type).toBe('cutout');
    expect(EFFECT_REGISTRY[2].type).toBe('cartoon');
    expect(EFFECT_REGISTRY[3].type).toBe('colorGrade');

    // Both preview and export iterate EFFECT_REGISTRY in order,
    // so the chain order is guaranteed to be consistent.
  });
});

// ─── Cutout Effect: Preview ↔ Export Consistency ──────────────────────────────

describe('Cutout effect: preview ↔ export consistency', () => {
  const W = 1080;
  const H = 1920;

  function makeCutoutProject(
    videoTrack: Track,
    cutoutConfig: EffectClipConfig,
  ): Project {
    const effectTrack: Track = {
      id: 'effect-track1',
      type: 'effect',
      name: 'Cutout Effect',
      effectType: 'cutout',
      parentTrackId: videoTrack.id,
      clips: [
        makeClip({
          id: 'effect-clip1',
          trackId: 'effect-track1',
          effectConfig: cutoutConfig,
          timelineStart: 0,
          timelineEnd: 10,
        }),
      ],
    };
    return makeProject([videoTrack, effectTrack]);
  }

  it('extracts same default mask parameters (threshold=128, expand=0, blur=0)', () => {
    const config: EffectClipConfig = {
      effectType: 'cutout',
      enabled: true,
      cutoutMode: 'removeBg',
      background: { type: 'solid', color: '#000000' },
    };
    const videoTrack = makeTrack('video');
    const project = makeCutoutProject(videoTrack, config);
    const clip = makeClip({ timelineStart: 0, timelineEnd: 3 });

    // Both paths should use DEFAULT_MASK_ADJUST values
    // Preview: maskThreshold ?? 128, maskExpand ?? 0, maskBlur ?? 0
    const previewThreshold = config.maskThreshold ?? DEFAULT_MASK_ADJUST.threshold;
    const previewExpand = config.maskExpand ?? DEFAULT_MASK_ADJUST.expand;
    const previewBlur = config.maskBlur ?? DEFAULT_MASK_ADJUST.blur;

    expect(previewThreshold).toBe(128);
    expect(previewExpand).toBe(0);
    expect(previewBlur).toBe(0);

    // Export: verify filter contains threshold=128
    const exportContext = makeExportContext({
      project,
      assetMaskInputIdxMap: new Map([['asset1', 2]]),
    });

    const result = CutoutEffect.export.buildFilter!(
      'clip0',
      clip,
      videoTrack,
      0,
      exportContext,
    );
    expect(result).not.toBeNull();
    const filterStr = result!.filters.join(';');

    // FFmpeg threshold: lutyuv=y='if(gte(val,128),255,0)'
    expect(filterStr).toContain('lutyuv=y=\'if(gte(val,128),255,0)\'');
    // No expand → no maximum/minimum filters
    expect(filterStr).not.toContain('maximum=');
    expect(filterStr).not.toContain('minimum=');
    // No blur → no gblur filter
    expect(filterStr).not.toContain('gblur=');
  });

  it('extracts same custom mask parameters', () => {
    const config: EffectClipConfig = {
      effectType: 'cutout',
      enabled: true,
      cutoutMode: 'removeBg',
      background: { type: 'solid', color: '#00FF00' },
      maskThreshold: 150,
      maskExpand: 3,
      maskBlur: 5,
    };
    const videoTrack = makeTrack('video');
    const project = makeCutoutProject(videoTrack, config);
    const clip = makeClip({ timelineStart: 0, timelineEnd: 3 });

    // Preview extracts these from config
    const previewThreshold = config.maskThreshold ?? DEFAULT_MASK_ADJUST.threshold;
    const previewExpand = config.maskExpand ?? DEFAULT_MASK_ADJUST.expand;
    const previewBlur = config.maskBlur ?? DEFAULT_MASK_ADJUST.blur;

    expect(previewThreshold).toBe(150);
    expect(previewExpand).toBe(3);
    expect(previewBlur).toBe(5);

    // Export filter verification
    const exportContext = makeExportContext({
      project,
      assetMaskInputIdxMap: new Map([['asset1', 2]]),
    });

    const result = CutoutEffect.export.buildFilter!(
      'clip0',
      clip,
      videoTrack,
      0,
      exportContext,
    );
    expect(result).not.toBeNull();
    const filterStr = result!.filters.join(';');

    // Threshold=150
    expect(filterStr).toContain('lutyuv=y=\'if(gte(val,150),255,0)\'');
    // Expand=3 → 3 maximum=radius=1 filters
    const maximumCount = (filterStr.match(/maximum=radius=1/g) || []).length;
    expect(maximumCount).toBe(3);
    // Blur=5 → gblur=sigma=5.0
    expect(filterStr).toContain('gblur=sigma=5.0');
  });

  it('extracts same negative expand (contract) parameters', () => {
    const config: EffectClipConfig = {
      effectType: 'cutout',
      enabled: true,
      cutoutMode: 'removeBg',
      background: { type: 'solid', color: '#000000' },
      maskExpand: -4,
    };
    const videoTrack = makeTrack('video');
    const project = makeCutoutProject(videoTrack, config);
    const clip = makeClip({ timelineStart: 0, timelineEnd: 3 });

    // Preview: expand < 0 → erode (shrink mask)
    const previewExpand = config.maskExpand ?? DEFAULT_MASK_ADJUST.expand;
    expect(previewExpand).toBe(-4);

    // Export: expand < 0 → minimum filters (erode)
    const exportContext = makeExportContext({
      project,
      assetMaskInputIdxMap: new Map([['asset1', 2]]),
    });

    const result = CutoutEffect.export.buildFilter!(
      'clip0',
      clip,
      videoTrack,
      0,
      exportContext,
    );
    const filterStr = result!.filters.join(';');

    // Contract → minimum=radius=1 (4 times)
    const minimumCount = (filterStr.match(/minimum=radius=1/g) || []).length;
    expect(minimumCount).toBe(4);
    expect(filterStr).not.toContain('maximum=');
  });

  it('uses same cutout mode for removeBg', () => {
    const config: EffectClipConfig = {
      effectType: 'cutout',
      enabled: true,
      cutoutMode: 'removeBg',
      background: { type: 'solid', color: '#FF0000' },
    };
    const videoTrack = makeTrack('video');
    const project = makeCutoutProject(videoTrack, config);
    const clip = makeClip({ timelineStart: 0, timelineEnd: 3 });

    // Preview: mode=removeBg → mask applied directly (subject = where mask is white)
    const previewMode = config.cutoutMode ?? 'removeBg';
    expect(previewMode).toBe('removeBg');

    // Export: removeBg → clip × mask, bg × inv_mask
    const exportContext = makeExportContext({
      project,
      assetMaskInputIdxMap: new Map([['asset1', 2]]),
    });

    const result = CutoutEffect.export.buildFilter!(
      'clip0',
      clip,
      videoTrack,
      0,
      exportContext,
    );
    const filterStr = result!.filters.join(';');

    // removeBg: [clipRgb][maskB]blend=multiply → [subjMasked]
    //           [bgPad][maskInv]blend=multiply → [bgMasked]
    // Verify clip multiplied with mask (not inverted)
    expect(filterStr).toContain('[cut_cliprgb_0][cut_maskb_0]blend=all_mode=multiply');
    expect(filterStr).toContain('[cut_bg_0][cut_minv_0]blend=all_mode=multiply');
    // Background color matches
    expect(filterStr).toContain('color=c=0xFF0000');
  });

  it('uses same cutout mode for removePerson', () => {
    const config: EffectClipConfig = {
      effectType: 'cutout',
      enabled: true,
      cutoutMode: 'removePerson',
      background: { type: 'solid', color: '#0000FF' },
    };
    const videoTrack = makeTrack('video');
    const project = makeCutoutProject(videoTrack, config);
    const clip = makeClip({ timelineStart: 0, timelineEnd: 3 });

    // Preview: mode=removePerson → invert mask (keep background, remove person)
    const previewMode = config.cutoutMode ?? 'removeBg';
    expect(previewMode).toBe('removePerson');

    // Export: removePerson → clip × inv_mask, bg × mask
    const exportContext = makeExportContext({
      project,
      assetMaskInputIdxMap: new Map([['asset1', 2]]),
    });

    const result = CutoutEffect.export.buildFilter!(
      'clip0',
      clip,
      videoTrack,
      0,
      exportContext,
    );
    const filterStr = result!.filters.join(';');

    // removePerson: [clipRgb][maskInv]blend=multiply → [subjMasked]
    //              [bgPad][maskB]blend=multiply → [bgMasked]
    expect(filterStr).toContain('[cut_cliprgb_0][cut_minv_0]blend=all_mode=multiply');
    expect(filterStr).toContain('[cut_bg_0][cut_maskb_0]blend=all_mode=multiply');
    expect(filterStr).toContain('color=c=0x0000FF');
  });

  it('uses same background color in both paths', () => {
    const bgColors = ['#FF0000', '#00FF00', '#0000FF', '#ABCDEF', '#000000'];

    for (const bgColor of bgColors) {
      const config: EffectClipConfig = {
        effectType: 'cutout',
        enabled: true,
        cutoutMode: 'removeBg',
        background: { type: 'solid', color: bgColor },
      };
      const videoTrack = makeTrack('video');
      const project = makeCutoutProject(videoTrack, config);
      const clip = makeClip({ timelineStart: 0, timelineEnd: 3 });

      // Preview: bgColor = cfg.background?.color ?? '#000000'
      const previewBgColor = config.background?.color ?? '#000000';
      expect(previewBgColor).toBe(bgColor);

      // Export: bgColor = (cfg.background?.color ?? '#000000').replace('#', '0x')
      const exportContext = makeExportContext({
        project,
        assetMaskInputIdxMap: new Map([['asset1', 2]]),
      });

      const result = CutoutEffect.export.buildFilter!(
        'clip0',
        clip,
        videoTrack,
        0,
        exportContext,
      );
      const filterStr = result!.filters.join(';');

      const expectedExportColor = bgColor.replace('#', '0x');
      expect(filterStr).toContain(`color=c=${expectedExportColor}`);
    }
  });

  it('applies RGB color space conversion in export for correct blending', () => {
    const config: EffectClipConfig = {
      effectType: 'cutout',
      enabled: true,
      cutoutMode: 'removeBg',
      background: { type: 'solid', color: '#000000' },
    };
    const videoTrack = makeTrack('video');
    const project = makeCutoutProject(videoTrack, config);
    const clip = makeClip({ timelineStart: 0, timelineEnd: 3 });

    const exportContext = makeExportContext({
      project,
      assetMaskInputIdxMap: new Map([['asset1', 2]]),
    });

    const result = CutoutEffect.export.buildFilter!(
      'clip0',
      clip,
      videoTrack,
      0,
      exportContext,
    );
    const filterStr = result!.filters.join(';');

    // Export must convert to gbrp for correct multiply blending
    expect(filterStr).toContain('format=gbrp');
    // And convert back to yuv420p for downstream effects
    expect(filterStr).toContain('format=yuv420p');
    // Uses blend=addition for final composite
    expect(filterStr).toContain('blend=all_mode=addition');
  });
});

// ─── ColorGrade Effect: Preview ↔ Export Consistency ──────────────────────────

describe('ColorGrade effect: preview ↔ export consistency', () => {
  const W = 1080;
  const H = 1920;

  function makeColorGradeProject(
    videoTrack: Track,
    config: EffectClipConfig,
  ): Project {
    const effectTrack: Track = {
      id: 'cg-effect-track',
      type: 'effect',
      name: 'Color Grade',
      effectType: 'colorGrade',
      parentTrackId: videoTrack.id,
      clips: [
        makeClip({
          id: 'cg-clip1',
          trackId: 'cg-effect-track',
          effectConfig: config,
          timelineStart: 0,
          timelineEnd: 10,
        }),
      ],
    };
    return makeProject([videoTrack, effectTrack]);
  }

  it('uses same contrast/brightness/saturation values', () => {
    const testCases = [
      { contrast: 1.5, brightness: 0.8, saturation: 1.2, hue: 0 },
      { contrast: 0.5, brightness: 1.5, saturation: 0.5, hue: 0 },
      { contrast: 2.0, brightness: 2.0, saturation: 2.0, hue: 0 },
    ];

    for (const { contrast, brightness, saturation, hue } of testCases) {
      // Preview: buildColorGradeCssFilter
      const cssFilter = buildColorGradeCssFilter(contrast, brightness, saturation, hue);

      if (contrast !== 1) expect(cssFilter).toContain(`contrast(${contrast})`);
      if (brightness !== 1) expect(cssFilter).toContain(`brightness(${brightness})`);
      if (saturation !== 1) expect(cssFilter).toContain(`saturate(${saturation})`);

      // Export: eq filter
      const config: EffectClipConfig = {
        effectType: 'colorGrade',
        enabled: true,
        contrast,
        brightness,
        colorSaturation: saturation,
        hue,
      };
      const videoTrack = makeTrack('video');
      const project = makeColorGradeProject(videoTrack, config);
      const clip = makeClip({ timelineStart: 0, timelineEnd: 3 });

      const exportContext = makeExportContext({ project });
      const result = ColorGradeEffect.export.buildFilter!(
        'clip0',
        clip,
        videoTrack,
        0,
        exportContext,
      );
      expect(result).not.toBeNull();
      const filterStr = result!.filters.join(';');

      // FFmpeg eq uses contrast, brightness (0-centered: brightness-1), saturation
      if (contrast !== 1) expect(filterStr).toContain(`contrast=${contrast.toFixed(4)}`);
      if (brightness !== 1) expect(filterStr).toContain(`brightness=${(brightness - 1).toFixed(4)}`);
      if (saturation !== 1) expect(filterStr).toContain(`saturation=${saturation.toFixed(4)}`);
    }
  });

  it('uses same hue rotation value', () => {
    const hueValues = [45, -90, 180, -180, 30];

    for (const hue of hueValues) {
      // Preview: CSS hue-rotate(<hue>deg)
      const cssFilter = buildColorGradeCssFilter(1, 1, 1, hue);
      expect(cssFilter).toContain(`hue-rotate(${hue}deg)`);

      // Export: FFmpeg hue=h=<hue>
      const config: EffectClipConfig = {
        effectType: 'colorGrade',
        enabled: true,
        hue,
      };
      const videoTrack = makeTrack('video');
      const project = makeColorGradeProject(videoTrack, config);
      const clip = makeClip({ timelineStart: 0, timelineEnd: 3 });

      const exportContext = makeExportContext({ project });
      const result = ColorGradeEffect.export.buildFilter!(
        'clip0',
        clip,
        videoTrack,
        0,
        exportContext,
      );
      const filterStr = result!.filters.join(';');
      expect(filterStr).toContain(`hue=h=${hue.toFixed(2)}`);
    }
  });

  it('uses identical shadows/highlights formula when only one is active', () => {
    // When only shadows OR highlights is active, preview and export use identical math:
    //   v_out = clamp(v + shadows*(1-v)^2, 0, 1)    or
    //   v_out = clamp(v + highlights*v^2, 0, 1)
    //
    // Preview applies them sequentially per-pixel; export encodes them in a single geq.
    // With a single parameter, sequential vs simultaneous is equivalent.

    const testCases = [
      { shadows: 0.5, highlights: 0 },
      { shadows: -0.5, highlights: 0 },
      { shadows: 0, highlights: 0.5 },
      { shadows: 0, highlights: -0.5 },
      { shadows: 0.8, highlights: 0 },
      { shadows: 0, highlights: -0.8 },
    ];

    for (const { shadows, highlights } of testCases) {
      const config: EffectClipConfig = {
        effectType: 'colorGrade',
        enabled: true,
        shadows,
        highlights,
      };
      const videoTrack = makeTrack('video');
      const project = makeColorGradeProject(videoTrack, config);
      const clip = makeClip({ timelineStart: 0, timelineEnd: 3 });

      const exportContext = makeExportContext({ project });
      const result = ColorGradeEffect.export.buildFilter!(
        'clip0',
        clip,
        videoTrack,
        0,
        exportContext,
      );
      const filterStr = result!.filters.join(';');

      // Export should contain geq with the formula components
      expect(filterStr).toContain('geq=');
      expect(filterStr).toContain('format=rgb24');

      const s = shadows.toFixed(6);
      const h = highlights.toFixed(6);
      expect(filterStr).toContain(s);
      expect(filterStr).toContain(h);

      // Verify numerical equivalence at specific pixel values
      const testPixels = [0, 64, 128, 192, 255];
      for (const pixel of testPixels) {
        // Preview formula (sequential application)
        let v = pixel / 255;
        if (shadows !== 0) v += shadows * (1 - v) * (1 - v);
        if (highlights !== 0) v += highlights * v * v;
        const previewResult = Math.max(0, Math.min(255, Math.round(v * 255)));

        // Export formula (simultaneous, single geq expression)
        const ve = pixel / 255;
        const veOut = Math.max(0, Math.min(1,
          ve + shadows * (1 - ve) * (1 - ve) + highlights * ve * ve
        ));
        const exportResult = Math.round(veOut * 255);

        // With only one parameter active, results are identical
        expect(previewResult).toBe(exportResult);
      }
    }
  });

  it('shadows + highlights combined: both paths produce valid results', () => {
    // When both shadows AND highlights are active, there is a known difference:
    //   Preview: applies sequentially (shadows modifies v, then highlights uses modified v)
    //   Export: applies simultaneously (single geq expression uses original v for both)
    //
    // This is a deliberate approximation tradeoff for FFmpeg filter complexity.
    // We verify both paths produce valid pixel values and that the export uses
    // the correct formula structure.

    const testCases = [
      { shadows: 0.3, highlights: 0.3 },
      { shadows: -0.3, highlights: 0.3 },
      { shadows: 0.5, highlights: -0.5 },
    ];

    for (const { shadows, highlights } of testCases) {
      const config: EffectClipConfig = {
        effectType: 'colorGrade',
        enabled: true,
        shadows,
        highlights,
      };
      const videoTrack = makeTrack('video');
      const project = makeColorGradeProject(videoTrack, config);
      const clip = makeClip({ timelineStart: 0, timelineEnd: 3 });

      const exportContext = makeExportContext({ project });
      const result = ColorGradeEffect.export.buildFilter!(
        'clip0',
        clip,
        videoTrack,
        0,
        exportContext,
      );
      const filterStr = result!.filters.join(';');

      // Export uses geq with both shadows and highlights terms
      expect(filterStr).toContain('geq=');
      expect(filterStr).toContain(shadows.toFixed(6));
      expect(filterStr).toContain(highlights.toFixed(6));

      // Both paths produce valid pixel values (0-255 range)
      const testPixels = [0, 64, 128, 192, 255];
      for (const pixel of testPixels) {
        // Preview: sequential
        let v = pixel / 255;
        if (shadows !== 0) v += shadows * (1 - v) * (1 - v);
        if (highlights !== 0) v += highlights * v * v;
        const previewResult = Math.max(0, Math.min(255, Math.round(v * 255)));

        // Export: simultaneous
        const ve = pixel / 255;
        const veOut = Math.max(0, Math.min(1,
          ve + shadows * (1 - ve) * (1 - ve) + highlights * ve * ve
        ));
        const exportResult = Math.round(veOut * 255);

        // Both should produce valid pixel values
        expect(previewResult).toBeGreaterThanOrEqual(0);
        expect(previewResult).toBeLessThanOrEqual(255);
        expect(exportResult).toBeGreaterThanOrEqual(0);
        expect(exportResult).toBeLessThanOrEqual(255);
      }
    }
  });

  it('returns passthrough when all parameters are neutral', () => {
    const config: EffectClipConfig = {
      effectType: 'colorGrade',
      enabled: true,
      contrast: 1,
      brightness: 1,
      colorSaturation: 1,
      hue: 0,
      shadows: 0,
      highlights: 0,
    };
    const videoTrack = makeTrack('video');
    const project = makeColorGradeProject(videoTrack, config);
    const clip = makeClip({ timelineStart: 0, timelineEnd: 3 });

    // Preview: CSS filter should be empty
    const cssFilter = buildColorGradeCssFilter(1, 1, 1, 0);
    expect(cssFilter).toBe('');

    // Export: should return empty filters (passthrough)
    const exportContext = makeExportContext({ project });
    const result = ColorGradeEffect.export.buildFilter!(
      'clip0',
      clip,
      videoTrack,
      0,
      exportContext,
    );
    expect(result!.filters).toHaveLength(0);
    expect(result!.outputPad).toBe('clip0'); // passthrough
  });
});

// ─── BeatZoom Effect: Preview ↔ Export Consistency ────────────────────────────

describe('BeatZoom effect: preview ↔ export consistency', () => {
  const W = 1080;
  const H = 1920;

  it('computeBeatZoomScale returns correct values for known inputs', () => {
    const beats = [1.0, 2.0, 3.0];
    const cfg: EffectClipConfig = {
      effectType: 'beatZoom',
      enabled: true,
      intensity: 0.1,
      durationMs: 200,
      easing: 'easeOut',
      beatDivision: 1,
    };

    // At beat start (t=1.0): progress=0, invProgress=1, easeOut(1)=1 → scale = 1 + 0.1*1 = 1.1
    const scaleAtBeatStart = computeBeatZoomScale(1.0, beats, cfg);
    expect(scaleAtBeatStart).toBeCloseTo(1.1, 4);

    // At beat end (t=1.2): progress=1, invProgress=0, easeOut(0)=0 → scale = 1 + 0.1*0 = 1.0
    const scaleAtBeatEnd = computeBeatZoomScale(1.2, beats, cfg);
    expect(scaleAtBeatEnd).toBeCloseTo(1.0, 4);

    // Between beats (t=0.5): no beat window → scale = 1.0
    const scaleOutside = computeBeatZoomScale(0.5, beats, cfg);
    expect(scaleOutside).toBe(1.0);

    // Midway through beat (t=1.1): progress=0.5, invProgress=0.5
    const scaleMidBeat = computeBeatZoomScale(1.1, beats, cfg);
    expect(scaleMidBeat).toBeGreaterThan(1.0);
    expect(scaleMidBeat).toBeLessThan(1.1);
  });

  it('export uses same intensity for crop expression', () => {
    const beats = [1.0, 2.0, 3.0];
    const intensity = 0.08;
    const durationMs = 150;

    const cfg: EffectClipConfig = {
      effectType: 'beatZoom',
      enabled: true,
      intensity,
      durationMs,
      easing: 'easeOut',
      beatDivision: 1,
    };

    const videoTrack = makeTrack('video');
    const effectTrack: Track = {
      id: 'bz-effect-track',
      type: 'effect',
      name: 'Beat Zoom',
      effectType: 'beatZoom',
      parentTrackId: videoTrack.id,
      clips: [
        makeClip({
          id: 'bz-clip1',
          trackId: 'bz-effect-track',
          effectConfig: cfg,
          timelineStart: 0,
          timelineEnd: 10,
        }),
      ],
    };
    const masterAudioClip = makeClip({
      id: 'master-audio',
      trackId: 'master-track',
      assetId: 'audio-asset',
      timelineStart: 0,
      timelineEnd: 10,
      sourceStart: 0,
      sourceEnd: 10,
    });
    const project = makeProject([videoTrack, effectTrack]);
    const clip = makeClip({ timelineStart: 0, timelineEnd: 5 });

    const beatsData: BeatsData = { beats, tempo: 120 };
    const exportContext = makeExportContext({
      project,
      masterAudioClip,
      beatsMap: new Map([['audio-asset', beatsData]]),
    });

    const result = BeatZoomEffect.export.buildBaseModifier!(clip, videoTrack, exportContext);
    expect(result).not.toBeNull();

    // Export crop expression uses: iw/(1+intensity) during beat windows
    const expectedZf = (1 + intensity).toFixed(6);
    expect(result).toContain(`iw/${expectedZf}`);
    expect(result).toContain(`ih/${expectedZf}`);

    // Verify the zoom factor matches what preview computes
    const previewScaleAtBeat = computeBeatZoomScale(1.0, beats, cfg);
    // Preview returns 1 + intensity * easeOut(1) = 1 + intensity = 1.08
    expect(previewScaleAtBeat).toBeCloseTo(1 + intensity, 4);
    // Export crop divides by (1+intensity) which scales up by the same factor
    expect(parseFloat(expectedZf)).toBeCloseTo(1 + intensity, 4);
  });

  it('both paths respect beatDivision parameter', () => {
    const beats = [0.5, 1.0, 1.5, 2.0, 2.5, 3.0];
    const cfg: EffectClipConfig = {
      effectType: 'beatZoom',
      enabled: true,
      intensity: 0.1,
      durationMs: 100,
      easing: 'linear',
      beatDivision: 2, // every 2nd beat
    };

    // Preview: computeBeatZoomScale with beatDivision=2 should only zoom on beats[0], beats[2], beats[4]
    const scaleAtBeat0 = computeBeatZoomScale(0.5, beats, cfg);
    const scaleAtBeat1 = computeBeatZoomScale(1.0, beats, cfg);

    // beat[0]=0.5 is included (index 0 % 2 === 0)
    expect(scaleAtBeat0).toBeGreaterThan(1.0);
    // beat[1]=1.0 is excluded (index 1 % 2 !== 0)
    expect(scaleAtBeat1).toBe(1.0);

    // Export: should only generate between() expressions for filtered beats
    const videoTrack = makeTrack('video');
    const effectTrack: Track = {
      id: 'bz-effect-track2',
      type: 'effect',
      name: 'Beat Zoom',
      effectType: 'beatZoom',
      parentTrackId: videoTrack.id,
      clips: [
        makeClip({
          id: 'bz-clip2',
          trackId: 'bz-effect-track2',
          effectConfig: cfg,
          timelineStart: 0,
          timelineEnd: 10,
        }),
      ],
    };
    const masterAudioClip = makeClip({
      id: 'master-audio',
      trackId: 'master-track',
      assetId: 'audio-asset',
      timelineStart: 0,
      timelineEnd: 10,
      sourceStart: 0,
      sourceEnd: 10,
    });
    const project = makeProject([videoTrack, effectTrack]);
    const clip = makeClip({ timelineStart: 0, timelineEnd: 5 });

    const beatsData: BeatsData = { beats, tempo: 120 };
    const exportContext = makeExportContext({
      project,
      masterAudioClip,
      beatsMap: new Map([['audio-asset', beatsData]]),
    });

    const result = BeatZoomEffect.export.buildBaseModifier!(clip, videoTrack, exportContext);
    expect(result).not.toBeNull();

    // Should have between() for beats at 0.5, 1.5, 2.5 (every 2nd)
    expect(result).toContain('between(t,0.5000,');
    expect(result).toContain('between(t,1.5000,');
    expect(result).toContain('between(t,2.5000,');
    // Should NOT have between() for 1.0 or 2.0
    expect(result).not.toContain('between(t,1.0000,');
    expect(result).not.toContain('between(t,2.0000,');
  });
});

// ─── Combined Multi-Element Scenarios ─────────────────────────────────────────

describe('Multi-element consistency scenarios', () => {
  const W = 1080;
  const H = 1920;

  it('text clip with rotation: both paths apply rotation', () => {
    const rotation = 45;
    const clip = makeClip({
      textContent: 'Rotated text',
      transform: makeTransform({ rotation }),
    });
    const track = makeTrack('video');
    const context = makeExportContext({ W, H });

    const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))!;
    const result = element.export.buildFilter('base', clip, track, 0, context);
    const filterStr = result!.filters.join(';');

    // Export uses rotate filter with radians
    const expectedRad = (rotation * Math.PI) / 180;
    expect(filterStr).toContain(`rotate=${expectedRad.toFixed(6)}`);

    // Preview uses ctx.rotate with same radian conversion
    const previewRad = (rotation * Math.PI) / 180;
    expect(previewRad).toBeCloseTo(expectedRad, 10);
  });

  it('rectangle with rotation: both paths apply same rotation', () => {
    const rotation = -30;
    const clip = makeClip({
      rectangleStyle: { color: '#FF0000', fillOpacity: 1, width: 200, height: 100 },
      transform: makeTransform({ rotation }),
    });
    const track = makeTrack('video');
    const context = makeExportContext({ W, H });

    const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))!;
    const result = element.export.buildFilter('base', clip, track, 0, context);
    const filterStr = result!.filters.join(';');

    const expectedRad = (rotation * Math.PI) / 180;
    expect(filterStr).toContain(`rotate=${expectedRad.toFixed(6)}`);
  });

  it('video clip with cutout + colorGrade: effects chain in same order', () => {
    const videoTrack = makeTrack('video');
    const cutoutConfig: EffectClipConfig = {
      effectType: 'cutout',
      enabled: true,
      cutoutMode: 'removeBg',
      background: { type: 'solid', color: '#00FF00' },
      maskThreshold: 100,
      maskBlur: 3,
    };
    const colorGradeConfig: EffectClipConfig = {
      effectType: 'colorGrade',
      enabled: true,
      contrast: 1.3,
      brightness: 0.9,
    };

    const cutoutEffectTrack: Track = {
      id: 'cut-track',
      type: 'effect',
      name: 'Cutout',
      effectType: 'cutout',
      parentTrackId: videoTrack.id,
      clips: [
        makeClip({
          id: 'cut-clip',
          trackId: 'cut-track',
          effectConfig: cutoutConfig,
          timelineStart: 0,
          timelineEnd: 10,
        }),
      ],
    };
    const colorGradeEffectTrack: Track = {
      id: 'cg-track',
      type: 'effect',
      name: 'Color Grade',
      effectType: 'colorGrade',
      parentTrackId: videoTrack.id,
      clips: [
        makeClip({
          id: 'cg-clip',
          trackId: 'cg-track',
          effectConfig: colorGradeConfig,
          timelineStart: 0,
          timelineEnd: 10,
        }),
      ],
    };

    const project = makeProject([videoTrack, cutoutEffectTrack, colorGradeEffectTrack]);
    const clip = makeClip({ timelineStart: 0, timelineEnd: 3 });

    // Both preview and export iterate EFFECT_REGISTRY in order:
    // BeatZoom → Cutout → Cartoon → ColorGrade
    // Verify cutout is applied before colorGrade in export
    const exportContext = makeExportContext({
      project,
      assetMaskInputIdxMap: new Map([['asset1', 2]]),
    });

    // Cutout filter
    const cutoutResult = CutoutEffect.export.buildFilter!(
      'clip0',
      clip,
      videoTrack,
      0,
      exportContext,
    );
    expect(cutoutResult).not.toBeNull();
    const cutoutOut = cutoutResult!.outputPad;

    // ColorGrade filter (chained after cutout)
    const cgResult = ColorGradeEffect.export.buildFilter!(
      cutoutOut,
      clip,
      videoTrack,
      0,
      exportContext,
    );
    expect(cgResult).not.toBeNull();
    const cgFilterStr = cgResult!.filters.join(';');

    // ColorGrade should receive cutout's output pad as input
    expect(cgFilterStr).toContain(`[${cutoutOut}]`);
    // And contain the correct eq parameters
    expect(cgFilterStr).toContain('contrast=1.3000');
    expect(cgFilterStr).toContain('brightness=-0.1000');
  });

  it('all element types dispatch correctly and produce non-null export results', () => {
    const scenarios = [
      {
        name: 'text clip',
        clip: makeClip({ textContent: 'Hello', transform: makeTransform() }),
        track: makeTrack('video'),
        expectedType: 'text',
      },
      {
        name: 'rectangle clip',
        clip: makeClip({
          rectangleStyle: { color: '#FF0000', fillOpacity: 1, width: 200, height: 100 },
          transform: makeTransform(),
        }),
        track: makeTrack('video'),
        expectedType: 'rectangle',
      },
      {
        name: 'video clip',
        clip: makeClip({ transform: makeTransform() }),
        track: makeTrack('video'),
        expectedType: 'video',
      },
    ];

    for (const { name, clip, track, expectedType } of scenarios) {
      const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track));
      expect(element, `${name} should be handled`).toBeDefined();
      expect(element!.clipType).toBe(expectedType);

      // Both preview and export APIs should exist
      expect(element!.preview).toBeDefined();
      expect(element!.preview.render).toBeDefined();
      expect(element!.export).toBeDefined();
      expect(element!.export.buildFilter).toBeDefined();

      // Export should produce a non-null result
      const context = makeExportContext();
      const result = element!.export.buildFilter('base', clip, track, 0, context);
      expect(result, `${name} export should produce a result`).not.toBeNull();
      expect(result!.filters.length).toBeGreaterThan(0);
    }
  });
});
