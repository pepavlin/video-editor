# AI Style Effect — AnimeGANv2 Cartoon Stylization

## Overview

The AI Style mode extends the Cartoon effect with a second mode that produces **genuine cartoon/anime** video stylization using **AnimeGANv2** (ONNX Runtime). Unlike neural style transfer which applies painterly textures from reference paintings, AnimeGANv2 is a GAN specifically trained to convert real photos/video into cartoon art — producing flat color regions, clean edges, and stylized shading. This is true cartoonization, not just filter effects.

The effect uses two modes accessible through the Cartoon effect panel:
- **Classic** — Edge-detection cartoon (existing, default)
- **AI Style** — AnimeGANv2 cartoon stylization with temporal consistency

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
            Load AnimeGANv2 ONNX model (from workspace/models/)
                    │
                    ▼
            Select keyframes (every 5 frames + scene boundaries)
                    │
                    ▼
            Cartoonize keyframes with AnimeGANv2:
              1. Resize preserving aspect ratio (dims divisible by 8)
              2. Normalize to [-1, 1] (AnimeGANv2 input range)
              3. ONNX Runtime inference (AnimeGANv2 model)
              4. Denormalize from [-1, 1] to [0, 255]
              5. Upscale back to original resolution (Lanczos4)
              6. HSV color vibrance post-processing
              7. Blend with original (styleStrength)
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
            Assemble cartoonized frames → Output MP4
```

### Preview (Real-time Approximation)

The preview uses a Canvas 2D approximation simulating cartoon output:

1. Bilateral-style smoothing (downscale + upscale) for flat color regions
2. Light blur for smooth cartoon regions
3. Strong posterization for cel-shaded look
4. Preset-specific color tint overlay
5. Edge detection overlay for cartoon outlines
6. Blend with original based on strength

### Export

When a pre-processed AI style video exists (`asset.aiStylePath`):
- It is added as an FFmpeg input alongside the original
- The cartoon effect blends original and stylized using: `blend=all_expr='A*(1-strength)+B*strength'`

When no pre-processed video exists:
- Falls back to an FFmpeg-based approximation using `smartblur + eq` filters

---

## Style Presets

Each preset maps to an AnimeGANv2 ONNX model trained on a specific anime/cartoon style:

| Preset | Style | Description |
|--------|-------|-------------|
| `hayao` | Studio Ghibli / Hayao Miyazaki | Soft colors, natural scenery, gentle cartoon look |
| `shinkai` | Makoto Shinkai | Vivid sky colors, crisp details, vibrant palette |
| `paprika` | Satoshi Kon / Paprika | Dreamy, expressive colors, stylized look |
| `celeb` | Portrait-focused | Optimized for faces and portraits |

### Obtaining Models

Models are **automatically downloaded** on first use. When a style preset is selected and
no local model exists, the processing script downloads it from the configured model server
(default: Hugging Face `bryandlee/animegan2-pytorch` repository). If the primary source is
unavailable (e.g. gated/private), the downloader automatically falls back to publicly
accessible mirror repositories on HuggingFace (vumichien, akhaliq).

Models are stored in:
- `$WORKSPACE_DIR/models/style_transfer/` (if `WORKSPACE_DIR` is set)
- `~/.cache/video-editor/models/style_transfer/` (otherwise)

#### Auto-download (default)

Simply start an AI style job — the model will be downloaded automatically if missing.
The UI will show a "Model not downloaded" indicator with a **Download** button in the
Inspector's Preprocessing section.

#### Pre-download (CLI)

```bash
# Download all models
python3 scripts/download_ai_models.py

# Download a specific model
python3 scripts/download_ai_models.py hayao

# Check which models are available
python3 scripts/download_ai_models.py --status
```

#### API download

```
POST /api/ai-style/download-model
Body: { "preset": "hayao" }
Response: { "jobId": "...", "preset": "hayao" }

GET /api/ai-style/model-status
Response: { "models": { "hayao": { "available": true, "size": 8500000 }, ... } }
```

#### Manual placement

Models can also be manually placed in the models directory:
- `workspace/models/style_transfer/animeganv2_hayao.onnx`
- `workspace/models/style_transfer/animeganv2_shinkai.onnx`
- `workspace/models/style_transfer/animeganv2_paprika.onnx`
- `workspace/models/style_transfer/animeganv2_celeb.onnx`

#### Configuration

| Environment Variable | Description |
|---------------------|-------------|
| `AI_STYLE_MODEL_BASE_URL` | Override the model download base URL |
| `HF_TOKEN` | HuggingFace access token for authenticated downloads (get one at https://huggingface.co/settings/tokens) |

For HuggingFace URLs, the downloader automatically appends `?download=true` (required by HuggingFace for direct file downloads) and tries multiple URL patterns with fallback. When the primary `bryandlee/animegan2-pytorch` repository returns 401/403 (gated or private), the downloader automatically tries publicly accessible mirror repositories. If all mirrors also fail, set `HF_TOKEN` with a valid HuggingFace access token.

Typical model size: ~8-15 MB each.

---

## Parameters

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| `stylePreset` | enum | `'hayao'` | AnimeGANv2 model preset |
| `styleStrength` | 0–1 | 0.8 | Blend weight between original and cartoonized (1 = full cartoon) |
| `brushSize` | 0–1 | 0.5 | Controls detail level via input resolution |
| `colorVibrance` | 0–2 | 1.3 | Color vibrancy of the cartoon output (1 = normal) |

### How brushSize works

The `brushSize` parameter controls the resolution at which the AnimeGANv2 model processes each frame:
- **brushSize = 0**: Process at higher resolution → finer cartoon details
- **brushSize = 1**: Process at 50% resolution → broader, more stylized cartoon

Lower resolution input produces more abstract/stylized cartoon output with less fine detail.
All dimensions are aligned to multiples of 8 (required by the AnimeGANv2 architecture).

---

## Dependencies

All dependencies are already in the Docker image (no new installs required):

- **onnxruntime** (>=1.16.0) — ONNX model inference for AnimeGANv2
- **opencv-python-headless** — Optical flow (DIS), frame warping, color conversion
- **numpy** — Array operations, flow warping, frame blending
- **ffmpeg** — Frame extraction and video assembly

---

## API

### Check Model Status

```
GET /api/ai-style/model-status
Response: {
  models: {
    hayao: { available: boolean, path: string, size?: number },
    shinkai: { available: boolean, path: string, size?: number },
    ...
  }
}
```

### Download Model

```
POST /api/ai-style/download-model
Body: { preset: string }  // 'hayao' | 'shinkai' | 'paprika' | 'celeb'
Response: { jobId: string, preset: string }
```

### Start AI Style Processing

```
POST /api/assets/:id/ai-style
Body: {
  styleStrength?: number,  // 0–1, default 0.8
  brushSize?: number,      // 0–1, default 0.5
  colorVibrance?: number,  // 0–2, default 1.3
  stylePreset?: string     // 'hayao' | 'shinkai' | 'paprika' | 'celeb'
}
Response: { jobId: string }
```

The job can be polled via `GET /api/jobs/:jobId/status`.

### Output

The cartoonized video is stored at `assets/{assetId}/ai_style.mp4` and the `asset.aiStylePath` field is updated on completion.

---

## File Locations

| Component | File |
|-----------|------|
| Type definitions | `packages/shared/src/types.ts` — `AiStylePreset`, `CartoonMode`, `EffectClipConfig` |
| Python processing | `scripts/ai_style.py` — AnimeGANv2 cartoonization pipeline |
| Model downloader | `scripts/download_ai_models.py` — Standalone model download CLI |
| Python tests | `scripts/test_ai_style.py` — Unit tests for pure functions + download |
| Effect implementation | `packages/elements/src/effects/Cartoon.ts` — Preview + export for both modes |
| API route | `apps/api/src/routes/assets.ts` — `POST /assets/:id/ai-style` |
| Export pipeline | `apps/api/src/elements/ExportPipeline.ts` — AI style input collection |
| UI controls | `apps/web/src/components/Inspector.tsx` — Style preset selector + sliders + preprocessing buttons |
| Effect preview | `apps/web/src/components/effects/CartoonEffectPreview.tsx` — Frame capture + filter preview |
| Frontend API | `apps/web/src/lib/api.ts` — `startAiStyle()` |
| Editor wiring | `apps/web/src/components/Editor.tsx` — Job tracking + polling |
| Tests (effects) | `packages/elements/src/__tests__/effectRegistry.test.ts` — AI style filter tests |
| Tests (UI) | `apps/web/src/__tests__/InspectorAiStyleStatus.test.tsx` — Inspector AI style UI tests |
| Tests (preview) | `apps/web/src/components/effects/CartoonEffectPreview.test.tsx` — Preview component tests |

---

## Effect Preview

The cartoon effect settings panel includes a live preview that captures a frame from the video and applies the actual cartoon filter (classic or AI style) in real-time as the user adjusts parameters.

### How it works

1. A hidden `<video>` element loads the proxy video and seeks to 25% of the clip duration
2. The captured frame is drawn to an offscreen canvas
3. The same `processCartoonFrame()` / `processAiStyleFrame()` functions used by the real-time preview pipeline are applied
4. A before/after split view allows comparison (draggable divider)
5. Processing is debounced (50ms) when parameters change

### View modes
- **Split** — Draggable divider shows effect on left, original on right
- **Original** — Full original frame

### Component
`apps/web/src/components/effects/CartoonEffectPreview.tsx`

---

## Preprocessing Buttons

The AI Style section includes a dedicated preprocessing panel with:

1. **Generate Stylized Video** — Main button using current settings (preset, strength, brush, vibrance)
2. **Quick preset buttons** — Grid of 4 buttons (Ghibli, Shinkai, Paprika, Portrait) that switch to the preset and immediately start processing
3. **Status indicators** — Shows "Stylized video ready" (green) or "Processing [preset] style..." (amber spinner) with disabled buttons during processing

---

## Temporal Consistency

The AnimeGANv2 approach provides inherently good temporal consistency because:

1. **Deterministic model output**: Same input always produces the same cartoonized output
2. **Dense keyframes**: Every 5 frames (~6 per second) for minimal inter-keyframe drift
3. **Flow propagation with high temporal weight (0.85)**: Smooth blending between frames
4. **Improved confidence function**: Smoother sigmoid-based confidence curve instead of exponential decay
5. **Scene-cut awareness**: Never propagates across detected scene boundaries

This eliminates the flickering and jittering common with per-frame filter-based approaches.

---

## Why AnimeGANv2 over Neural Style Transfer

The previous implementation used Fast Neural Style Transfer models (Johnson et al. 2016) from the ONNX Model Zoo. These models apply artistic textures from reference paintings but don't produce a convincing cartoon look — they tend to look more like blurred/textured versions of the original.

AnimeGANv2 is purpose-built for cartoonization:
- **Flat color regions** — like real cartoons, not gradients with texture overlays
- **Clean edges** — proper cartoon outlines, not just edge-detected artifacts
- **Stylized shading** — anime-style light/shadow separation
- **Face-aware** — models trained with face detection to preserve facial features
- **Multiple styles** — each model captures a specific anime director's visual style
