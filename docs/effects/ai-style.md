# AI Style Effect — Painterly Stylization (EbSynth-like)

## Overview

The AI Style mode extends the Cartoon effect with a second mode that produces **painterly, non-photorealistic** video stylization, inspired by the EbSynth workflow. It combines AI-based frame stylization with optical-flow-based temporal propagation for smooth, coherent results.

The effect uses two modes accessible through the Cartoon effect panel:
- **Classic** — Edge-detection cartoon (existing, default)
- **AI Style** — Painterly stylization with temporal consistency

---

## Architecture

### Two-Phase Processing

1. **Offline preprocessing** (`scripts/ai_style.py`) — CPU-based, runs as background job
2. **Real-time preview** (Canvas 2D approximation) — Immediate visual feedback
3. **Export integration** (FFmpeg blend) — Uses pre-processed video when available

### Pipeline (Offline)

```
Input proxy → Extract frames → Detect scene cuts
                                     │
                    ┌────────────────┘
                    ▼
            Select keyframes (every ~1s + scene boundaries)
                    │
                    ▼
            Stylize keyframes:
              1. Bilateral filter cascade (edge-preserving smooth)
              2. OpenCV stylization (painterly brush texture)
              3. HSV color vibrance boost
              4. Subtle edge darkening (painted contour feel)
                    │
                    ▼
            Propagate via optical flow (DIS algorithm):
              - Compute dense flow between consecutive frames
              - Warp previous stylized frame forward
              - Blend with independent stylization
              - Weighted by flow confidence (occlusion-aware)
                    │
                    ▼
            Assemble stylized frames → Output MP4
```

### Preview (Real-time Approximation)

The preview uses a Canvas 2D approximation to give the user immediate feedback without waiting for offline processing:

1. Large blur for flat color regions (simulates bilateral filter)
2. Saturation/vibrance boost for painterly warmth
3. Warm-tone overlay for "hand-painted" feel
4. Posterization to reduce color levels
5. Blend with original based on strength

### Export

When a pre-processed AI style video exists (`asset.aiStylePath`):
- It is added as an FFmpeg input alongside the original
- The cartoon effect blends original and stylized using: `blend=all_expr='A*(1-strength)+B*strength'`

When no pre-processed video exists:
- Falls back to an FFmpeg-based approximation using `smartblur + eq` filters

---

## Parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| `styleStrength` | 0–1 | 0.8 | Blend weight between original and stylized (1 = full style) |
| `brushSize` | 0–1 | 0.5 | Controls brush stroke coarseness |
| `colorVibrance` | 0–2 | 1.3 | Color vibrancy of the painterly output (1 = normal) |

---

## Dependencies

All dependencies are already in the Docker image (no new installs required):

- **opencv-python-headless** — Bilateral filter, stylization, optical flow (DIS), Canny edges
- **numpy** — Array operations, flow warping, frame blending
- **ffmpeg** — Frame extraction and video assembly

---

## API

### Start AI Style Processing

```
POST /api/assets/:id/ai-style
Body: {
  styleStrength?: number,  // 0–1, default 0.8
  brushSize?: number,      // 0–1, default 0.5
  colorVibrance?: number   // 0–2, default 1.3
}
Response: { jobId: string }
```

The job can be polled via `GET /api/jobs/:jobId/status`.

### Output

The stylized video is stored at `assets/{assetId}/ai_style.mp4` and the `asset.aiStylePath` field is updated on completion.

---

## File Locations

| Component | File |
|-----------|------|
| Type definitions | `packages/shared/src/types.ts` — `CartoonMode`, `EffectClipConfig` AI style fields |
| Python processing | `scripts/ai_style.py` — Full offline pipeline |
| Effect implementation | `packages/elements/src/effects/Cartoon.ts` — Preview + export for both modes |
| API route | `apps/api/src/routes/assets.ts` — `POST /assets/:id/ai-style` |
| Export pipeline | `apps/api/src/elements/ExportPipeline.ts` — AI style input collection |
| UI controls | `apps/web/src/components/Inspector.tsx` — Mode selector + sliders |
| Frontend API | `apps/web/src/lib/api.ts` — `startAiStyle()` |
| Editor wiring | `apps/web/src/components/Editor.tsx` — Job tracking + polling |
| Tests | `packages/elements/src/__tests__/effectRegistry.test.ts` — AI style filter tests |

---

## Temporal Consistency (EbSynth-like)

The core innovation of this approach is temporal consistency via optical flow propagation:

1. **Keyframe selection**: Every ~1 second + scene boundaries
2. **Keyframe stylization**: Full painterly pipeline on selected frames
3. **Flow propagation**: For intermediate frames:
   - Compute DIS optical flow from previous to current frame
   - Warp previous stylized result using the flow field
   - Compute independent stylization for current frame
   - Blend with confidence weighting: `result = warped * conf * 0.75 + independent * (1 - conf * 0.75)`
4. **Scene-cut awareness**: Never propagates across detected scene boundaries

This produces results similar to EbSynth: smooth temporal coherence with the painted look maintained across motion changes.
