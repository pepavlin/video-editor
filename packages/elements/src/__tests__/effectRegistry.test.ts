/**
 * Effect Registry Tests
 *
 * Verifies EFFECT_REGISTRY structure, circular-dependency-free import, and
 * the export implementations of each effect.
 *
 * These tests focus on the export side (pure FFmpeg filter string generation).
 * The preview side requires browser DOM APIs (Canvas, HTMLVideoElement) which
 * are not available in the Node.js test environment.
 */

import { describe, it, expect } from 'vitest';
import { EFFECT_REGISTRY } from '../effects/index';
import type { Clip, Track, Project, BeatsData } from '@video-editor/shared';
import type { ExportFilterContext } from '../types';

// ─── Test helpers ─────────────────────────────────────────────────────────────

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

function makeEffectClip(
  effectType: 'beatZoom' | 'cutout' | 'cartoon' | 'colorGrade',
  extraConfig = {}
): Clip {
  return makeClip({
    effectConfig: {
      effectType,
      enabled: true,
      ...extraConfig,
    },
  });
}

function makeEffectTrack(parentTrackId: string, effectType: 'beatZoom' | 'cutout' | 'cartoon' | 'colorGrade'): Track {
  return {
    id: `effect-track-${effectType}`,
    type: 'effect',
    name: `${effectType} effect track`,
    effectType,
    parentTrackId,
    clips: [],
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
    writeFile: () => {},
    ...overrides,
  };
}

// ─── EFFECT_REGISTRY structure tests ─────────────────────────────────────────

describe('EFFECT_REGISTRY', () => {
  it('is importable from effects/index without circular dependency issues', () => {
    // This import itself verifies there is no circular dependency at module load time
    expect(EFFECT_REGISTRY).toBeDefined();
    expect(Array.isArray(EFFECT_REGISTRY)).toBe(true);
  });

  it('has exactly 4 effects in the correct order', () => {
    expect(EFFECT_REGISTRY).toHaveLength(4);
    expect(EFFECT_REGISTRY[0].type).toBe('beatZoom');
    expect(EFFECT_REGISTRY[1].type).toBe('cutout');
    expect(EFFECT_REGISTRY[2].type).toBe('cartoon');
    expect(EFFECT_REGISTRY[3].type).toBe('colorGrade');
  });

  it('every effect has both preview and export properties', () => {
    for (const effect of EFFECT_REGISTRY) {
      expect(effect.preview, `${effect.type} should have preview`).toBeDefined();
      expect(effect.preview.isActive, `${effect.type}.preview.isActive should be a function`).toBeTypeOf('function');
      expect(effect.export, `${effect.type} should have export`).toBeDefined();
      expect(effect.export.isActive, `${effect.type}.export.isActive should be a function`).toBeTypeOf('function');
    }
  });

  it('BeatZoom has modifyTransform (Phase 1) but no applyRender (Phase 2)', () => {
    const beatZoom = EFFECT_REGISTRY.find(e => e.type === 'beatZoom')!;
    expect(beatZoom.preview.modifyTransform).toBeTypeOf('function');
    expect(beatZoom.preview.applyRender).toBeUndefined();
  });

  it('Cutout, Cartoon, ColorGrade have applyRender (Phase 2) but no modifyTransform (Phase 1)', () => {
    const phase2Effects = EFFECT_REGISTRY.filter(e => e.type !== 'beatZoom');
    for (const effect of phase2Effects) {
      expect(effect.preview.applyRender, `${effect.type} should have applyRender`).toBeTypeOf('function');
      expect(effect.preview.modifyTransform, `${effect.type} should NOT have modifyTransform`).toBeUndefined();
    }
  });

  it('BeatZoom has buildBaseModifier but no buildFilter (export)', () => {
    const beatZoom = EFFECT_REGISTRY.find(e => e.type === 'beatZoom')!;
    expect(beatZoom.export.buildBaseModifier).toBeTypeOf('function');
    expect(beatZoom.export.buildFilter).toBeUndefined();
  });

  it('Cutout, Cartoon, ColorGrade have buildFilter but no buildBaseModifier (export)', () => {
    const filterEffects = EFFECT_REGISTRY.filter(e => e.type !== 'beatZoom');
    for (const effect of filterEffects) {
      expect(effect.export.buildFilter, `${effect.type} should have buildFilter`).toBeTypeOf('function');
      expect(effect.export.buildBaseModifier, `${effect.type} should NOT have buildBaseModifier`).toBeUndefined();
    }
  });
});

// ─── BeatZoom isActive tests ──────────────────────────────────────────────────

describe('BeatZoom.export.isActive', () => {
  const beatZoom = EFFECT_REGISTRY.find(e => e.type === 'beatZoom')!;

  it('returns false when no master audio clip', () => {
    const clip = makeClip();
    const track = makeTrack('video');
    const context = makeExportContext({ masterAudioClip: undefined });
    expect(beatZoom.export.isActive(clip, track, context)).toBe(false);
  });

  it('returns false when no beats data', () => {
    const clip = makeClip();
    const track = makeTrack('video', {
      id: 'video1',
      clips: [clip],
    });
    const masterClip = makeClip({ assetId: 'master', id: 'master-clip', trackId: 'audio1' });
    const effectTrack = makeEffectTrack('video1', 'beatZoom');
    effectTrack.clips = [makeEffectClip('beatZoom')];
    const project = makeProject({ tracks: [track, effectTrack] });
    const context = makeExportContext({
      project,
      masterAudioClip: masterClip,
      beatsMap: new Map(), // no beats
    });
    expect(beatZoom.export.isActive(clip, track, context)).toBe(false);
  });
});

// ─── Cartoon.export.buildFilter tests ────────────────────────────────────────

describe('Cartoon.export.buildFilter', () => {
  const cartoon = EFFECT_REGISTRY.find(e => e.type === 'cartoon')!;

  it('returns null when cartoon effect is not configured', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const context = makeExportContext({ project: makeProject({ tracks: [track] }) });
    // No effect track → isActive returns false → but we test buildFilter directly
    const result = cartoon.export.buildFilter?.('clip0', clip, track, 0, context);
    expect(result).toBeNull();
  });

  it('generates split → hqdn3d → edgedetect → blend → eq filter chain', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const effectTrack = makeEffectTrack('video1', 'cartoon');
    effectTrack.clips = [makeEffectClip('cartoon', {
      colorSimplification: 0.3,
      edgeStrength: 0.5,
      saturation: 1.4,
    })];
    const project = makeProject({ tracks: [track, effectTrack] });
    const context = makeExportContext({ project });

    const result = cartoon.export.buildFilter?.('clip0', clip, track, 5, context);
    expect(result).not.toBeNull();

    const filterStr = result!.filters.join('; ');
    expect(filterStr).toContain('split');
    expect(filterStr).toContain('hqdn3d');
    expect(filterStr).toContain('edgedetect');
    expect(filterStr).toContain('blend');
    expect(filterStr).toContain('eq=saturation=');
    expect(result!.outputPad).toBe('cz_5');
  });
});

// ─── ColorGrade.export.buildFilter tests ─────────────────────────────────────

describe('ColorGrade.export.buildFilter', () => {
  const colorGrade = EFFECT_REGISTRY.find(e => e.type === 'colorGrade')!;

  it('returns null when colorGrade effect is not configured', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const context = makeExportContext({ project: makeProject({ tracks: [track] }) });
    const result = colorGrade.export.buildFilter?.('clip0', clip, track, 0, context);
    expect(result).toBeNull();
  });

  it('generates eq filter for contrast+brightness+saturation', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const effectTrack = makeEffectTrack('video1', 'colorGrade');
    effectTrack.clips = [makeEffectClip('colorGrade', {
      contrast: 1.2,
      brightness: 1.1,
      colorSaturation: 1.5,
      hue: 0,
    })];
    const project = makeProject({ tracks: [track, effectTrack] });
    const context = makeExportContext({ project });

    const result = colorGrade.export.buildFilter?.('clip0', clip, track, 3, context);
    expect(result).not.toBeNull();

    const filterStr = result!.filters.join('; ');
    expect(filterStr).toContain('eq=');
    expect(filterStr).toContain('contrast=');
    expect(filterStr).toContain('saturation=');
    // Output pad is cg0_3 (node index 0, filterIdx 3)
    expect(result!.outputPad).toBe('cg0_3');
  });

  it('generates hue filter when only hue is changed', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const effectTrack = makeEffectTrack('video1', 'colorGrade');
    effectTrack.clips = [makeEffectClip('colorGrade', {
      contrast: 1,
      brightness: 1,
      colorSaturation: 1,
      hue: 45,
    })];
    const project = makeProject({ tracks: [track, effectTrack] });
    const context = makeExportContext({ project });

    const result = colorGrade.export.buildFilter?.('clip0', clip, track, 7, context);
    expect(result).not.toBeNull();

    const filterStr = result!.filters.join('; ');
    expect(filterStr).toContain('hue=h=45');
    // Output pad is cg0_7 (node index 0, filterIdx 7)
    expect(result!.outputPad).toBe('cg0_7');
  });

  it('generates both eq and hue filters when multiple params are set', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const effectTrack = makeEffectTrack('video1', 'colorGrade');
    effectTrack.clips = [makeEffectClip('colorGrade', {
      contrast: 1.2,
      colorSaturation: 1.5,
      hue: 30,
    })];
    const project = makeProject({ tracks: [track, effectTrack] });
    const context = makeExportContext({ project });

    const result = colorGrade.export.buildFilter?.('clip0', clip, track, 2, context);
    expect(result).not.toBeNull();

    const filterStr = result!.filters.join('; ');
    expect(filterStr).toContain('eq=');
    expect(filterStr).toContain('hue=h=30');
    // eq is node 0, hue is node 1
    expect(result!.outputPad).toBe('cg1_2');
    expect(result!.filters).toHaveLength(2);
  });

  it('returns empty filters with inputPad as output when all params are neutral', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const effectTrack = makeEffectTrack('video1', 'colorGrade');
    effectTrack.clips = [makeEffectClip('colorGrade', {
      contrast: 1,
      brightness: 1,
      colorSaturation: 1,
      hue: 0,
    })];
    const project = makeProject({ tracks: [track, effectTrack] });
    const context = makeExportContext({ project });

    const result = colorGrade.export.buildFilter?.('clip0', clip, track, 0, context);
    // All neutral values → returns passthrough with empty filters
    expect(result).not.toBeNull();
    expect(result!.filters).toHaveLength(0);
    expect(result!.outputPad).toBe('clip0'); // returns inputPad unchanged
  });

  it('generates geq filter for shadows (lifts darks)', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const effectTrack = makeEffectTrack('video1', 'colorGrade');
    effectTrack.clips = [makeEffectClip('colorGrade', {
      contrast: 1,
      brightness: 1,
      colorSaturation: 1,
      hue: 0,
      shadows: 0.5,
    })];
    const project = makeProject({ tracks: [track, effectTrack] });
    const context = makeExportContext({ project });

    const result = colorGrade.export.buildFilter?.('clip0', clip, track, 5, context);
    expect(result).not.toBeNull();

    const filterStr = result!.filters.join('; ');
    // Should contain format conversion and geq
    expect(filterStr).toContain('format=rgb24');
    expect(filterStr).toContain('geq=r=');
    expect(filterStr).toContain('format=yuv420p');
    // shadows=0.5, highlights=0 → formula: v + 0.5*(1-v)^2 + 0*v^2
    expect(filterStr).toContain('0.500000');
    // Output pad is cg0_5
    expect(result!.outputPad).toBe('cg0_5');
  });

  it('generates geq filter for highlights (boosts brights)', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const effectTrack = makeEffectTrack('video1', 'colorGrade');
    effectTrack.clips = [makeEffectClip('colorGrade', {
      contrast: 1,
      brightness: 1,
      colorSaturation: 1,
      hue: 0,
      highlights: -0.3,
    })];
    const project = makeProject({ tracks: [track, effectTrack] });
    const context = makeExportContext({ project });

    const result = colorGrade.export.buildFilter?.('clip0', clip, track, 1, context);
    expect(result).not.toBeNull();

    const filterStr = result!.filters.join('; ');
    expect(filterStr).toContain('geq=r=');
    expect(filterStr).toContain('-0.300000');
    expect(result!.outputPad).toBe('cg0_1');
  });

  it('chains eq + geq when both basic and shadows/highlights params are active', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const effectTrack = makeEffectTrack('video1', 'colorGrade');
    effectTrack.clips = [makeEffectClip('colorGrade', {
      contrast: 1.3,
      colorSaturation: 1.2,
      hue: 0,
      shadows: 0.2,
      highlights: 0.1,
    })];
    const project = makeProject({ tracks: [track, effectTrack] });
    const context = makeExportContext({ project });

    const result = colorGrade.export.buildFilter?.('clip0', clip, track, 4, context);
    expect(result).not.toBeNull();

    const filterStr = result!.filters.join('; ');
    expect(filterStr).toContain('eq=');
    expect(filterStr).toContain('geq=r=');
    // eq is node 0, geq is node 1
    expect(result!.filters).toHaveLength(2);
    expect(result!.outputPad).toBe('cg1_4');
  });
});

// ─── Cutout.export.isActive + buildFilter tests ───────────────────────────────

describe('Cutout.export', () => {
  const cutout = EFFECT_REGISTRY.find(e => e.type === 'cutout')!;

  it('isActive returns false when no mask input registered', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const effectTrack = makeEffectTrack('video1', 'cutout');
    effectTrack.clips = [makeEffectClip('cutout')];
    const project = makeProject({ tracks: [track, effectTrack] });
    const context = makeExportContext({
      project,
      assetMaskInputIdxMap: new Map(), // no mask for asset1
    });
    expect(cutout.export.isActive(clip, track, context)).toBe(false);
  });

  it('buildFilter generates split+negate+multiply+addition blend chain (removeBg)', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const effectTrack = makeEffectTrack('video1', 'cutout');
    effectTrack.clips = [makeEffectClip('cutout', { cutoutMode: 'removeBg', background: { type: 'solid', color: '#000000' } })];
    const project = makeProject({ tracks: [track, effectTrack] });
    const context = makeExportContext({
      project,
      assetMaskInputIdxMap: new Map([['asset1', 2]]), // mask input at index 2
    });

    const result = cutout.export.buildFilter?.('clip0', clip, track, 4, context);
    expect(result).not.toBeNull();

    const filterStr = result!.filters.join('; ');
    expect(filterStr).toContain('[2:v]'); // mask input
    // Must have split to duplicate the mask — avoids double-consuming the same pad
    expect(filterStr).toContain('split');
    expect(filterStr).toContain('negate'); // inverted mask for background
    expect(filterStr).toContain('blend=all_mode=multiply'); // multiply for subject
    expect(filterStr).toContain('blend=all_mode=addition'); // addition to composite
    expect(result!.outputPad).toBe('cut_out_4');

    // Each pad must appear as output exactly once and as input at most once
    // (verify no double-consumption of labeled pads)
    const padOutputRegex = /\[([^\]]+)\](?=\s*$|\s*;)/g;
    const padInputRegex = /(?:^|;[^[]*)\[([^\]]+)\](?=[a-z])/g;
    // Simpler: count occurrences of the trimmed mask pad in filter string
    const trimmedMaskPad = 'cut_maskt_4';
    const occurrences = (filterStr.match(new RegExp(`\\[${trimmedMaskPad}\\]`, 'g')) ?? []).length;
    // trimmedMaskPad should appear exactly twice: once as output of trim, once as input to split
    expect(occurrences).toBe(2);
  });

  it('buildFilter generates split+negate+multiply+addition blend chain (removePerson)', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const effectTrack = makeEffectTrack('video1', 'cutout');
    effectTrack.clips = [makeEffectClip('cutout', { cutoutMode: 'removePerson', background: { type: 'solid', color: '#ffffff' } })];
    const project = makeProject({ tracks: [track, effectTrack] });
    const context = makeExportContext({
      project,
      assetMaskInputIdxMap: new Map([['asset1', 3]]),
    });

    const result = cutout.export.buildFilter?.('clip0', clip, track, 7, context);
    expect(result).not.toBeNull();

    const filterStr = result!.filters.join('; ');
    expect(filterStr).toContain('[3:v]');
    expect(filterStr).toContain('split');
    expect(filterStr).toContain('negate');
    expect(filterStr).toContain('blend=all_mode=multiply');
    expect(filterStr).toContain('blend=all_mode=addition');
    expect(result!.outputPad).toBe('cut_out_7');

    // The trimmed mask pad must only be consumed once (by split)
    const trimmedMaskPad = 'cut_maskt_7';
    const occurrences = (filterStr.match(new RegExp(`\\[${trimmedMaskPad}\\]`, 'g')) ?? []).length;
    expect(occurrences).toBe(2); // once as output, once as input to split
  });

  it('isActive returns true when mask is registered and effect is enabled', () => {
    const clip = makeClip();
    const track = makeTrack('video', { id: 'video1', clips: [clip] });
    const effectTrack = makeEffectTrack('video1', 'cutout');
    effectTrack.clips = [makeEffectClip('cutout')];
    const project = makeProject({ tracks: [track, effectTrack] });
    const context = makeExportContext({
      project,
      assetMaskInputIdxMap: new Map([['asset1', 2]]),
    });
    expect(cutout.export.isActive(clip, track, context)).toBe(true);
  });
});
