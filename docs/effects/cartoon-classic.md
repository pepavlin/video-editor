# Classic Cartoon Effect — Edge-Detection + Posterization

## Overview

The Classic mode of the Cartoon effect produces a **cel-shaded, cartoon-like** appearance by combining three techniques:

1. **Color smoothing** — Flattens gradients within regions (edge-preserving)
2. **Color posterization** — Quantizes colors to discrete flat levels (the key cartoon look)
3. **Edge outlines** — Sobel/edgedetect-based dark outlines drawn on top

This is the default mode when a cartoon effect is added.

---

## Pipeline

### Preview (Canvas 2D — real-time)

```
Source frame
    │
    ├─[Path A: Color]─────────────────────────────────────────────┐
    │  1. CSS blur (GPU-accelerated, 1–8px based on simplification)
    │  2. getImageData → posterize to N color levels (4–32)       │
    │  3. Per-pixel saturation boost (luminance-weighted)          │
    │                                                              │
    ├─[Path B: Edges]──────────────────────────────┐              │
    │  1. Draw to half-res canvas                   │              │
    │  2. Grayscale conversion                      │              │
    │  3. Sobel kernel (3×3 gradient magnitude)     │              │
    │  4. Threshold + sharp transition → black/white│              │
    │                                                │              │
    └────────────────────────────────────────────────┘              │
                                                                    │
    Multiply blend: posterized base × edge map = cartoon outlines  ─┘
```

### Export (FFmpeg)

```
[input] ─ split ─┬─[Path A]─ smartblur ─ lutrgb posterize ─ format=gbrp ─┐
                  │                                                         │
                  └─[Path B]─ edgedetect(wires) ─ negate ─ format=gbrp ───┤
                                                                            │
                        blend=multiply ─ format=yuv420p ─ eq=saturation ───┘
```

Key FFmpeg filters used:
- **smartblur** — Edge-adaptive blur that flattens gradients while preserving hard edges
- **lutrgb** — Color quantization via `trunc(val/STEP)*STEP+STEP/2` per channel
- **edgedetect(mode=wires)** — Canny-like edge detection producing white edges on black
- **negate** — Inverts to black edges on white background for multiply blend
- **blend=multiply** — Where edges are black (0), result is black (outlines); where white (255), posterized colors are preserved
- **eq=saturation** — Final saturation boost

---

## Parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| `colorSimplification` | 0–1 | 0.5 | Controls blur amount and posterization level. Higher = fewer color levels, flatter look |
| `edgeStrength` | 0–1 | 0.6 | Controls edge detection sensitivity. Higher = more/bolder outlines |
| `saturation` | 0–2 | 1.5 | Final color saturation multiplier (1 = neutral) |

### Parameter Effects on FFmpeg Filters

| Parameter | FFmpeg filter | Value mapping |
|-----------|--------------|---------------|
| `colorSimplification` | smartblur `lr` | 1.5 – 5.0 |
| `colorSimplification` | lutrgb `step` | 10 – 48 (fewer levels at higher values) |
| `edgeStrength` | edgedetect `low` | 0.02 – 0.10 |
| `edgeStrength` | edgedetect `high` | 0.05 – 0.30 |
| `saturation` | eq `saturation` | 0.0 – 3.0 (clamped) |

---

## Design Decisions

### Why posterization is essential

Without posterization, the effect is just "blur + edge overlay" which produces a blurry, degraded video. Posterization creates the **flat color regions** that define the cartoon/cel-shaded aesthetic — it's the difference between "blurry photo" and "cartoon drawing".

### Why smartblur instead of hqdn3d

`hqdn3d` is a temporal+spatial denoiser designed for video noise reduction. While it can smooth video, it operates on noise patterns rather than color gradients. `smartblur` is specifically designed as an edge-adaptive blur that smooths within flat regions while preserving hard edges — exactly what we need for cartoon color flattening.

### Why edgedetect(wires) + negate instead of edgedetect(colormix)

`edgedetect(mode=colormix)` mixes edge colors with a dark background. When multiplied with the base, non-edge areas get darkened (since they map to dark/black pixels). This produces an overall dark, muddy result.

`edgedetect(mode=wires) + negate` produces clean black edges on white background. Multiply blend with this means: edges → dark outlines, non-edges → original colors preserved. This is the correct behavior for cartoon outlines.

### Why gbrp color space for blending

Multiply blend in YUV color space causes chroma corruption artifacts because Y, U, V channels have different semantics (luminance vs chroma). Converting to planar RGB (gbrp) ensures the multiply operation is mathematically correct across all channels.

---

## File Locations

| Component | File |
|-----------|------|
| Effect implementation | `packages/elements/src/effects/Cartoon.ts` |
| Type definitions | `packages/shared/src/types.ts` — `EffectClipConfig` cartoon fields |
| UI controls | `apps/web/src/components/Inspector.tsx` — Classic mode sliders |
| Tests | `packages/elements/src/__tests__/effectRegistry.test.ts` |
