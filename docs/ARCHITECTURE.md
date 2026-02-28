# Element & Effect Architecture

## Core Principle

Every visual element type (video clip, text, rectangle, lyrics) lives in **ONE file** that contains **both** its preview implementation (Canvas 2D, browser) and its export implementation (FFmpeg filters, Node.js).

This means:
- When a text clip doesn't show in export → look in `packages/elements/src/clips/TextClip.ts`
- When BeatZoom doesn't work in export → look in `packages/elements/src/effects/BeatZoom.ts`
- No more searching in two separate codebases — **one file per element or effect**

---

## Package Structure

```
packages/elements/           ← Single source of truth for all visual rendering
  src/
    types.ts                 ← All shared types (ClipElementDefinition, EffectDefinition, ...)
    index.ts                 ← CLIP_REGISTRY + EFFECT_REGISTRY + public exports
    clips/
      index.ts               ← CLIP_REGISTRY (ordered, dispatch table)
      VideoClip.ts           ← preview + export in one file
      TextClip.ts            ← preview + export in one file
      RectangleClip.ts       ← preview + export in one file
      LyricsClip.ts          ← preview + export in one file
    effects/
      BeatZoom.ts            ← preview + export in one file
      Cutout.ts              ← preview + export in one file
      Cartoon.ts             ← preview + export in one file
      ColorGrade.ts          ← preview + export in one file

packages/shared/             ← Data types, utility functions
  src/
    types.ts                 ← Project, Clip, Track, Asset, etc.
    elementUtils.ts          ← getActiveEffectConfig, getOverlappingEffectConfig, ...

apps/web/src/elements/       ← Preview pipeline orchestration (thin layer only)
  PreviewPipeline.ts         ← Uses CLIP_REGISTRY, iterates tracks/clips

apps/api/src/elements/       ← Export pipeline orchestration (thin layer only)
  ExportPipeline.ts          ← Uses CLIP_REGISTRY, collects FFmpeg inputs
```

---

## CLIP_REGISTRY — Top-Level Element Dispatch

The `CLIP_REGISTRY` is the central dispatch table for all visual elements.
Both pipelines use it identically:

```typescript
// Preview (PreviewPipeline.ts):
const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track));
element?.preview.render(ctx, clip, track, transform, context);

// Export (ExportPipeline.ts):
const element = CLIP_REGISTRY.find(e => e.canHandle(clip, track));
const result = element?.export.buildFilter(prevPad, clip, track, filterIdx, context);
if (result) {
  filterParts.push(...result.filters);
  prevPad = result.outputPad;
  filterIdx = result.nextFilterIdx;
}
```

### Registry order (priority — first match wins)

```typescript
export const CLIP_REGISTRY: readonly ClipElementDefinition[] = [
  RectangleClipElement, // 1. clips with rectangleStyle
  TextClipElement,      // 2. clips with textContent
  LyricsClipElement,    // 3. clips on lyrics tracks
  VideoClipElement,     // 4. all other video track clips (catch-all)
];
```

**Order matters**: TextClipElement must come before VideoClipElement because text clips can live on video tracks and would otherwise be caught by VideoClipElement.

### ClipElementDefinition interface

```typescript
interface ClipElementDefinition {
  clipType: string;           // 'video' | 'text' | 'rectangle' | 'lyrics'
  canHandle(clip, track): boolean;

  preview: {
    render(ctx, clip, track, transform, context): void;
    getBounds?(clip, track, transform, context): Bounds | null;
  };

  export: {
    buildFilter(prevPad, clip, track, filterIdx, context): ClipFilterResult | null;
  };
}

interface ClipFilterResult {
  filters: string[];      // FFmpeg filter graph fragments
  outputPad: string;      // output pad name after compositing
  nextFilterIdx: number;  // updated counter for next element
}
```

---

## EFFECT_REGISTRY — Video Clip Sub-Effects

Effects are applied **within VideoClip rendering** only. The `EFFECT_REGISTRY` handles:
- Per-clip effects like BeatZoom (transform modifier) and Cutout/Cartoon/ColorGrade (pixel effects)
- Both preview (Canvas 2D) and export (FFmpeg) are in the same effect file

### Registry order (order matters)

```typescript
export const EFFECT_REGISTRY: readonly EffectDefinition[] = [
  BeatZoomEffect,   // Phase 1: modifies transform scale before bounds computed
  CutoutEffect,     // Phase 2: draws background, returns masked canvas
  CartoonEffect,    // Phase 2: edge detection + color simplification
  ColorGradeEffect, // Phase 2: contrast/brightness/saturation/hue
];
```

### Preview (inside VideoClip.preview.render)

```
Phase 1 — Transform modifiers (before bounds computed):
  for each effect in EFFECT_REGISTRY:
    if active: effect.preview.modifyTransform(transform, ...)

  → bounds = getVideoBounds(effectiveTransform, ...)

Phase 2 — Pixel effects:
  source = videoElement
  for each effect in EFFECT_REGISTRY:
    if active: source = effect.preview.applyRender(ctx, source, bounds, ...) ?? source

  → ctx.drawImage(source, ...)
```

### Export (inside VideoClip.export.buildFilter)

```
Base modifier loop (inline into trim chain):
  for each effect in EFFECT_REGISTRY:
    if active: baseModifier += effect.export.buildBaseModifier(clip, ...) ?? ''

Filter chain loop (separate FFmpeg nodes):
  currentPad = baseClipPad
  for each effect in EFFECT_REGISTRY:
    if active:
      result = effect.export.buildFilter(currentPad, ...)
      filterParts += result.filters
      currentPad = result.outputPad
```

### EffectDefinition interface

```typescript
interface EffectDefinition {
  readonly type: EffectType;
  readonly preview: EffectPreviewApi;  // Canvas 2D
  readonly export: EffectExportApi;    // FFmpeg filters
}

interface EffectPreviewApi {
  isActive(clip, track, context): boolean;
  modifyTransform?(transform, clip, track, context): void;  // Phase 1
  applyRender?(ctx, source, bounds, clip, track, context): EffectSource | null;  // Phase 2
}

interface EffectExportApi {
  isActive(clip, track, context): boolean;
  buildBaseModifier?(clip, track, context): string | null;  // inline trim chain
  buildFilter?(inputPad, clip, track, filterIdx, context): EffectFilterResult | null;  // separate nodes
}
```

---

## Export Pipeline Flow

```
ExportPipeline.build()
  │
  ├── 1. Collect FFmpeg inputs
  │     - assetPathMap:         assetId → file path
  │     - assetInputIdxMap:     assetId → FFmpeg -i index
  │     - clipAudioWavMap:      assetId → WAV -i index
  │     - assetMaskInputIdxMap: assetId → mask -i index (Cutout effect)
  │
  ├── 2. Build filter context (ExportFilterContext)
  │
  ├── 3. Filter complex construction
  │     a. Base canvas:  color=c=black:s=WxH:r=30[base]
  │
  │     b. ALL visual clips (reversed track order):
  │          for each track (visual, non-muted):
  │            for each clip:
  │              element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))
  │              result = element.export.buildFilter(prevPad, clip, track, filterIdx, ctx)
  │              ─ VideoClip:     trim → [BeatZoom crop] → scale → [effects] → overlay
  │              ─ TextClip:      [drawbox bg] → drawtext
  │              ─ RectangleClip: drawbox fill → [drawbox border]
  │              ─ LyricsClip:    write ASS → subtitles filter
  │
  │     c. Audio mixing: atrim + adelay + amix
  │
  │     d. Project lyrics overlay: generateAssContent → subtitles filter (if project.lyrics enabled)
  │
  └── 4. Return { inputArgs, filterComplex, videoOutPad, audioOutPad }
```

---

## Preview Pipeline Flow

```
PreviewPipeline.renderFrame()
  │
  ├── 1. Build asset proxy maps (assetProxyPaths, maskPaths)
  │
  ├── 2. Clear canvas (white background)
  │
  ├── 3. Render all visual clips (reversed track order):
  │     for each track (non-audio, non-effect, non-muted):
  │       for each clip visible at currentTime:
  │         element = CLIP_REGISTRY.find(e => e.canHandle(clip, track))
  │         element.preview.render(ctx, clip, track, transform, context)
  │         ─ VideoClip:     sync video time → Phase1 effects → Phase2 effects → drawImage
  │         ─ TextClip:      [fillRect bg] → fillText with shadow
  │         ─ RectangleClip: beginPath → fill → [stroke border]
  │         ─ LyricsClip:    drawLyricsWords (chunk display)
  │
  └── 4. Project lyrics overlay (rendered last, on top):
        renderProjectLyricsOverlay() if project.lyrics.enabled
```

---

## Adding a New Element Type

1. Create `packages/elements/src/clips/MyElement.ts`
2. Implement `ClipElementDefinition` — both `preview.render` and `export.buildFilter` in one file
3. Add it to `CLIP_REGISTRY` in `packages/elements/src/clips/index.ts` at the right priority position
4. **Done** — no changes needed in `apps/web` or `apps/api`

---

## Adding a New Effect (applies to video clips only)

1. Create `packages/elements/src/effects/MyEffect.ts`
2. Implement `EffectDefinition` — both `preview` and `export` properties
3. Add it to `EFFECT_REGISTRY` in `packages/elements/src/index.ts` at the right position
4. **Done** — no changes needed anywhere else

---

## Debugging Guide

| Problem | Where to look |
|---------|---------------|
| Text clip not showing in export | `packages/elements/src/clips/TextClip.ts` → `export.buildFilter` |
| Rectangle clip not showing in export | `packages/elements/src/clips/RectangleClip.ts` → `export.buildFilter` |
| Lyrics clip not showing in export | `packages/elements/src/clips/LyricsClip.ts` → `export.buildFilter` |
| Video clip not rendering in preview | `packages/elements/src/clips/VideoClip.ts` → `preview.render` |
| Video clip FFmpeg filter wrong | `packages/elements/src/clips/VideoClip.ts` → `export.buildFilter` |
| Effect not showing in preview | `packages/elements/src/effects/<EffectName>.ts` → `preview` |
| Effect not showing in export | `packages/elements/src/effects/<EffectName>.ts` → `export` |
| Wrong effect order | `packages/elements/src/index.ts` → `EFFECT_REGISTRY` |
| Wrong element dispatch (wrong element handles clip) | `packages/elements/src/clips/index.ts` → `CLIP_REGISTRY` order |
| Cutout mask not collected | `apps/api/src/elements/ExportPipeline.ts` → mask input collection section |
| Project lyrics not showing | `packages/elements/src/clips/LyricsClip.ts` → `buildProjectLyricsFilter` |

---

## Known Preview/Export Differences

| Feature | Preview | Export |
|---------|---------|--------|
| ColorGrade shadows/highlights | ✅ Per-pixel Canvas (quadratic curve) | ✅ FFmpeg geq with identical formula (format=rgb24 conversion) |
| Rectangle border radius | ✅ Canvas arcTo | ❌ FFmpeg drawbox has no border-radius (sharp corners) |
| Font rendering | Browser system fonts | Server system fonts (must be installed) |
| Cartoon edges | Sobel kernel (Canvas) | Canny via `edgedetect` filter (visually similar) |

> **ColorGrade note**: Shadows/highlights use `format=rgb24 → geq → format=yuv420p` in export.
> The geq expression matches the preview formula exactly: `v_out = clamp(v + s*(1-v)^2 + h*v^2, 0, 1)`
