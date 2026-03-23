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
  │     - assetAiStyleInputIdxMap: assetId → AI-style -i index (Cartoon AI Style mode)
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

## Lyrics Clip — Timing Model

### Individual Lyrics Chunks as Clips

After lyrics alignment (Whisper word-level timing), lyrics are **automatically split into individual per-chunk clips** on the lyrics track. Each clip represents one chunk of words (controlled by `lyricsStyle.wordsPerChunk`, default 3).

This means the user can **drag and reposition individual lyrics chunks** in the timeline to manually adjust timing. The rendering uses each clip's timeline position, not the original WAV timestamps.

### Explode Flow

1. User adds lyrics text and triggers alignment (Whisper)
2. Whisper returns word-level timestamps (WAV-relative)
3. `explodeLyricsClipToChunks()` splits the single clip into per-chunk clips:
   - Each clip gets its subset of words
   - Word timestamps are shifted to be **clip-relative** (first word starts at 0)
   - `clip.timelineStart/End` is set based on WAV→timeline time conversion
4. User can now drag each chunk clip independently in the timeline
5. The Inspector also offers a manual "Split to individual clips" button

### Time Domains

| Domain | Description | Example |
|--------|-------------|---------|
| **Clip-relative time** | Seconds from the start of the clip (0 = clip start) | `word.start`, `word.end` in `clip.lyricsWords` |
| **Video timeline time** | Seconds from position 0 on the video timeline | `clip.timelineStart`, `currentTime` |

**Conversion: clip-relative → video timeline time**
```
videoTime = clip.timelineStart + word.start
```

**Conversion: video timeline time → clip-relative (for preview)**
```
clipLocalTime = currentTime - clip.timelineStart
```

### Chunk-Based Display

Each clip after explosion contains exactly one chunk of words. Within a clip, words are highlighted based on clip-relative timing:

- **Word highlight** extends from `word.start` to the next word's `start` (fills the gap between words)
- The entire chunk is visible whenever the playhead is within the clip's `timelineStart..timelineEnd`

### ASS Export Timing

For FFmpeg export, clip-relative word timestamps are converted back to absolute video timeline time by adding `clip.timelineStart`. The `generateAssContent()` function handles this via `AssGenerationOptions`:

```typescript
// Words are clip-relative, convert to absolute for ASS
const absoluteWords = clip.lyricsWords.map(w => ({
  word: w.word,
  start: w.start + clip.timelineStart,
  end: w.end + clip.timelineStart,
}));
```

### Moving a Lyrics Chunk Clip

When the user drags a lyrics chunk clip to a new position on the timeline, the words move with it. The word timestamps are clip-relative, so they automatically render at the new position. No reprocessing or re-alignment is needed.

### Timeline Visualization

The timeline renders colored blocks for each word chunk inside the lyrics clip row (lower 55% of the clip height). Alternating purple shades show which groups of words display together. Block positions are computed from clip-relative timestamps + `clip.timelineStart`.

### Project-Level Lyrics Overlay

`project.lyrics` (the global overlay) still uses WAV-relative timestamps and renders on top of all tracks. This is separate from clip-level lyrics on lyrics tracks.

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
| Lyrics words wrong timing in preview | `apps/web/src/components/Preview.tsx` → `drawClipLyricsOverlay` (check clip-relative `clipLocalTime`) |
| Lyrics words wrong timing in export | `packages/elements/src/clips/LyricsClip.ts` → export buildFilter (clip-relative → absolute conversion) |
| Lyrics words disappear between chunks | `packages/elements/src/clips/LyricsClip.ts` → chunk end calculation (use next chunk first word) |
| Lyrics words missing after alignment | `scripts/align_lyrics.py` → `_map_to_provided_lyrics` guarantees ALL input words appear in output |
| Lyrics timeline blocks missing | `apps/web/src/components/Timeline.tsx` → lyrics word-chunk visualization block |
| Effect-parent visual grouping broken | `apps/web/src/lib/utils.ts` → `buildEffectGroups()`, `computeTrackYPositions()` + `Timeline.tsx` group rendering section |
| Effect track connector lines wrong | `Timeline.tsx` → "Draw effect-parent group backgrounds & connectors" section |
| Effect coverage indicator on video track wrong | `Timeline.tsx` → "Always-visible effect coverage indicator on parent tracks" section |

---

## Timeline Effect-Parent Visual Grouping

Effect tracks are visually connected to their parent video tracks through several rendering features in `Timeline.tsx`:

1. **Group background band** — Subtle tinted background spanning the entire group (effect tracks + parent video track)
2. **Left accent bar** — Colored 3px bar on the left edge of the group, using the primary effect color
3. **Dashed connector line** — Vertical dashed line in the header area connecting effect tracks to their parent, with horizontal ticks to each track
4. **Header indentation** — Effect track labels shifted right to accommodate connector lines; parent track labels slightly indented for alignment
5. **Parent track indicator** — Small "▲ N FX" label on parent video track headers showing how many effect tracks are attached
6. **Coverage indicator strips** — Thin colored strips at the top of parent video tracks showing exactly where effects are applied (always visible, not just on selection)
7. **Downward connector ticks** — Dashed vertical lines from effect clip edges down to the parent track, creating visual connection between specific effect clips and the track they apply to

The grouping logic is extracted into reusable utilities in `apps/web/src/lib/utils.ts`:
- `buildEffectGroups(tracks)` — Computes a `Map<parentTrackId, EffectGroup>` with parent index, effect indices, and per-effect RGB colors
- `computeTrackYPositions(tracks, rulerHeight, scrollTop, getHeight)` — Computes Y pixel positions for each track
- `EFFECT_COLOR_MAP` — Maps effect type names to RGB color strings

---

## Preview Canvas Display System

The preview is rendered on a `<canvas>` element whose **internal resolution** is fixed at a scaled-down version of the project's `outputResolution` (capped at 1280 px on the longest axis). This ensures `transform.x / transform.y` coordinates are always in stable, panel-size-independent pixels.

### Key invariant: CSS = internal resolution

The canvas CSS dimensions (`canvas.style.width / height`) are **always equal to the canvas's internal pixel dimensions** — they are never derived from or changed by the panel / container size. This makes the preview completely stable:

- Resizing the preview panel does **not** move or rescale video elements.
- The user uses the zoom / pan controls (scroll wheel, + / − buttons) to navigate.
- On project load the view is auto-fitted so the canvas fills the container.

### Visual scaling via viewZoom

All visual scaling is done by a CSS `transform: scale(viewZoom)` on the zoom-wrapper `<div>` that wraps the canvas. Because CSS transforms are applied after layout, the canvas's layout dimensions (= internal resolution) remain stable while the visual appearance changes.

| Aspect | Mechanism |
|--------|-----------|
| Visual scaling | `transform: scale(viewZoom)` on zoom wrapper |
| Canvas CSS size | Fixed = internal resolution (never changes on resize) |
| Mouse → canvas coords | `canvas.getBoundingClientRect()` accounts for CSS transform scale |
| SVG overlay coords | `viewBox="0 0 W H"` matches internal resolution; scales with CSS transform |
| Inline textarea position | Positioned in zoom wrapper's coordinate space (same as internal pixels) |

### Fit to window

`resetView()` and the ⊡ button calculate `fitZoom = min(containerW/canvasW, containerH/canvasH)` and apply it as `viewZoom`. This fills the container at the correct aspect ratio without touching the canvas CSS dimensions.

---

## Known Preview/Export Differences

| Feature | Preview | Export |
|---------|---------|--------|
| ColorGrade shadows/highlights | ✅ Per-pixel Canvas (quadratic curve) | ✅ FFmpeg geq with identical formula (format=rgb24 conversion) |
| Cutout mask refinement | ✅ Canvas threshold + blur filter + pixel ops | ✅ FFmpeg lutyuv + maximum/minimum + gblur |
| Cutout blending | Canvas 2D destination-in composite | FFmpeg multiply+addition blend in **gbrp** (planar RGB) |
| Cartoon blending | Canvas 2D multiply composite | FFmpeg multiply blend in **gbrp** (planar RGB) |
| Rectangle border radius | ✅ Canvas arcTo | ❌ FFmpeg drawbox has no border-radius (sharp corners) |
| Font rendering | Browser system fonts | Server system fonts (must be installed) |
| Cartoon edges | Sobel kernel (Canvas) | Canny via `edgedetect` filter (visually similar) |
| Cartoon AI Style | Canvas 2D blur+posterize+warm tones (approximation) | Pre-processed stylized video via Python (if available), or FFmpeg smartblur fallback |

> **ColorGrade note**: Shadows/highlights use `format=rgb24 → geq → format=yuv420p` in export.
> The geq expression matches the preview formula exactly: `v_out = clamp(v + s*(1-v)^2 + h*v^2, 0, 1)`
>
> **Cutout/Cartoon blending note**: Both effects perform their multiply blends in planar RGB (gbrp) color space,
> not in YUV420p. This is necessary because grayscale mask values have U=128, V=128 in YUV — multiplying in YUV
> would halve chroma channels, causing severe color desaturation. In gbrp, white is R=G=B=255 and black is
> R=G=B=0, so multiply correctly preserves all color channels.

---

## Cutout Effect — Mask Processing Architecture

The cutout effect uses a two-stage architecture: **preprocessing** (offline) and **live refinement** (real-time).

### Stage 1: Preprocessing (`scripts/cutout.py`)

Generates a raw grayscale mask video per asset:
- Runs rembg with `u2net_human_seg` model on each frame
- Outputs full-range (0-255) alpha confidence values — **no spatial processing** (no threshold, erosion, or blur)
- Applies temporal smoothing only (neighbour blending: 0.15/0.70/0.15) to reduce inter-frame jitter
- Scene-cut-aware: never blends across detected scene boundaries

### Stage 2: Live Refinement (effect settings)

Three adjustable parameters in the effect UI, applied per-frame in real-time:

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| `maskThreshold` | 0-255 | 128 | Binarization threshold — higher = tighter mask, lower = more generous |
| `maskExpand` | -10..10 | 0 | Expand (+) or contract (-) mask edges in pixels |
| `maskBlur` | 0-20 | 0 | Edge feathering / smoothing radius |

**Preview processing order** (Canvas 2D):
1. Draw raw mask → apply threshold (pixel loop)
2. If expand ≠ 0: blur mask at `|expand|*1.5px` radius → re-threshold (lower for expand, higher for contract)
3. If blur > 0: apply Gaussian blur via `ctx.filter`
4. Convert processed luminance → alpha channel

**Export processing order** (FFmpeg filters):
1. `lutyuv=y='if(gte(val,T),255,0)'` — threshold (in YUV, operates on Y channel)
2. `maximum=radius=1` (repeated N times) for expand, or `minimum=radius=1` for contract
3. `gblur=sigma=B` — edge feathering
4. `format=gbrp` — convert processed mask to planar RGB for correct blending

**Export compositing** (after mask processing):
- Mask, clip, and background are all converted to `gbrp` (planar RGB)
- `blend=all_mode=multiply` in RGB correctly masks both luminance and color channels
- `blend=all_mode=addition` composites the subject and background regions
- Final output is converted back to `format=yuv420p` for downstream effects
