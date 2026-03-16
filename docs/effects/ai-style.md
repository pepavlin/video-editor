# AI Style Effect — Neural Style Transfer Video Stylization

## Overview

The AI Style mode extends the Cartoon effect with a second mode that produces **genuinely painted, brush-stroke** video stylization using **neural style transfer** (ONNX Runtime). It uses pre-trained Fast Neural Style Transfer models (Johnson et al. 2016) from the ONNX Model Zoo — each model is trained on a specific famous painting to produce real artistic brush-stroke textures, not just filter approximations.

The effect uses two modes accessible through the Cartoon effect panel:
- **Classic** — Edge-detection cartoon (existing, default)
- **AI Style** — Neural style transfer with temporal consistency

---

## Architecture

### Two-Phase Processing

1. **Offline preprocessing** (`scripts/ai_style.py`) — ONNX inference + optical flow, runs as background job
2. **Real-time preview** (Canvas 2D approximation) — Immediate visual feedback
3. **Export integration** (FFmpeg blend) — Uses pre-processed video when available

### Pipeline (Offline)

```
Input proxy → Extract frames → Detect scene cuts
                                     │
                    ┌────────────────┘
                    ▼
            Download ONNX model (cached in workspace/models/)
                    │
                    ▼
            Select keyframes (every 5 frames + scene boundaries)
                    │
                    ▼
            Stylize keyframes with neural style transfer:
              1. Downscale based on brushSize (controls brush stroke size)
              2. ONNX Runtime inference (Fast Neural Style Transfer model)
              3. Upscale back to original resolution (Lanczos4)
              4. HSV color vibrance post-processing
              5. Blend with original (styleStrength)
                    │
                    ▼
            Propagate via optical flow (DIS FAST algorithm):
              - Compute dense flow between consecutive frames
              - Warp previous stylized frame forward
              - Temporal blending with 0.85 weight for smooth transitions
              - Confidence-weighted occlusion handling
              - Scene-cut aware (never propagates across cuts)
                    │
                    ▼
            Assemble stylized frames → Output MP4
```

### Preview (Real-time Approximation)

The preview uses a Canvas 2D approximation with preset-specific tinting:

1. Downscale + upscale to simulate brush stroke size (based on brushSize)
2. Blur for smooth color regions
3. Saturation/vibrance boost
4. Preset-specific color tint overlay (each preset has a characteristic color cast)
5. Posterization to reduce color levels
6. Blend with original based on strength

### Export

When a pre-processed AI style video exists (`asset.aiStylePath`):
- It is added as an FFmpeg input alongside the original
- The cartoon effect blends original and stylized using: `blend=all_expr='A*(1-strength)+B*strength'`

When no pre-processed video exists:
- Falls back to an FFmpeg-based approximation using `smartblur + eq` filters

---

## Style Presets

Each preset maps to a pre-trained ONNX neural style transfer model, producing genuinely different artistic styles:

| Preset | Model | Description |
|--------|-------|-------------|
| `impressionist` | Rain Princess | Watercolor/impressionist brush strokes |
| `bold` | Candy | Bold, colorful brush strokes |
| `abstract` | Udnie (Francis Picabia) | Abstract brush strokes |
| `mosaic` | Mosaic | Cubist/mosaic pattern |
| `expressive` | Pointilism | Expressive pointillist strokes |

Models are downloaded on first use from the ONNX Model Zoo (~6-8 MB each) and cached in `workspace/models/style_transfer/`.

---

## Parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| `stylePreset` | enum | `'impressionist'` | Neural style transfer model preset |
| `styleStrength` | 0–1 | 0.8 | Blend weight between original and stylized (1 = full style) |
| `brushSize` | 0–1 | 0.5 | Controls brush stroke coarseness via downscale ratio |
| `colorVibrance` | 0–2 | 1.3 | Color vibrancy of the painterly output (1 = normal) |

### How brushSize works

The `brushSize` parameter controls the resolution at which the neural model processes each frame:
- **brushSize = 0**: Process at full resolution → fine, detailed brush strokes
- **brushSize = 1**: Process at 40% resolution → large, coarse brush strokes

Lower resolution input to the model naturally produces larger brush-stroke effects when upscaled back, similar to painting with a wider brush.

---

## Dependencies

All dependencies are already in the Docker image (no new installs required):

- **onnxruntime** (>=1.16.0) — ONNX model inference for neural style transfer
- **opencv-python-headless** — Optical flow (DIS), frame warping, color conversion
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
  colorVibrance?: number,  // 0–2, default 1.3
  stylePreset?: string     // 'impressionist' | 'bold' | 'abstract' | 'mosaic' | 'expressive'
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
| Type definitions | `packages/shared/src/types.ts` — `AiStylePreset`, `CartoonMode`, `EffectClipConfig` |
| Python processing | `scripts/ai_style.py` — ONNX neural style transfer pipeline |
| Python tests | `scripts/test_ai_style.py` — Unit tests for pure functions |
| Effect implementation | `packages/elements/src/effects/Cartoon.ts` — Preview + export for both modes |
| API route | `apps/api/src/routes/assets.ts` — `POST /assets/:id/ai-style` |
| Export pipeline | `apps/api/src/elements/ExportPipeline.ts` — AI style input collection |
| UI controls | `apps/web/src/components/Inspector.tsx` — Style preset selector + sliders |
| Frontend API | `apps/web/src/lib/api.ts` — `startAiStyle()` |
| Editor wiring | `apps/web/src/components/Editor.tsx` — Job tracking + polling |
| Tests (effects) | `packages/elements/src/__tests__/effectRegistry.test.ts` — AI style filter tests |
| Tests (UI) | `apps/web/src/__tests__/InspectorAiStyleStatus.test.tsx` — Inspector AI style UI tests |

---

## Temporal Consistency

The neural style transfer approach provides inherently better temporal consistency than the previous bilateral-filter approach, because:

1. **Deterministic model output**: Same input always produces the same stylized output
2. **Dense keyframes**: Every 5 frames (~6 per second) for minimal inter-keyframe drift
3. **Flow propagation with high temporal weight (0.85)**: Smooth blending between frames
4. **Improved confidence function**: Smoother sigmoid-based confidence curve instead of exponential decay
5. **Scene-cut awareness**: Never propagates across detected scene boundaries

This eliminates the flickering and jittering common with per-frame filter-based approaches.
