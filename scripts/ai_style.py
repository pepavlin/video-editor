#!/usr/bin/env python3
"""
AI Style — Neural style transfer video stylization with temporal consistency.

Uses ONNX Runtime with pre-trained Fast Neural Style Transfer models (Johnson et al.)
from the PyTorch/ONNX model zoo. Each model was trained on a specific painting and
produces genuine brush-stroke textures — not just filter approximations.

Usage:
    python3 ai_style.py <input_video> <output_video> [style_strength] [brush_size] [color_vibrance] [style_preset]

Parameters:
    input_video     Path to the proxy video (MP4)
    output_video    Path for the stylized output (MP4)
    style_strength  0.0–1.0  Blend weight between original and stylized (default 0.8)
    brush_size      0.0–1.0  Controls brush stroke coarseness via downscale (default 0.5)
    color_vibrance  0.0–2.0  Color vibrancy of painterly output (default 1.3)
    style_preset    Model preset name (default 'impressionist')
                    Options: impressionist, bold, abstract, mosaic, expressive

Pipeline:
    1. Download ONNX style transfer model (if not cached)
    2. Extract frames from input video
    3. Detect scene cuts for propagation boundaries
    4. Stylize keyframes with neural style transfer model via ONNX Runtime
    5. Propagate style between keyframes using optical flow with temporal blending
    6. Apply color vibrance post-processing
    7. Assemble stylized frames into output video

Dependencies (all already in Docker):
    - onnxruntime (>=1.16.0)
    - opencv-python-headless (cv2)
    - numpy
    - pillow (PIL)
"""

import sys
import os
import subprocess
import tempfile
import math
import urllib.request

import numpy as np
import cv2

# ─── Model configuration ────────────────────────────────────────────────────

# Map of preset names to ONNX model URLs (PyTorch/ONNX Model Zoo)
# These are Fast Neural Style Transfer models from Johnson et al. 2016,
# trained on specific paintings to produce genuine artistic brush strokes.
STYLE_MODELS = {
    'impressionist': {
        'url': 'https://github.com/onnx/models/raw/main/validated/vision/style_transfer/fast_neural_style/model/rain-princess-9.onnx',
        'filename': 'rain_princess_9.onnx',
        'description': 'Watercolor/impressionist brush strokes',
    },
    'bold': {
        'url': 'https://github.com/onnx/models/raw/main/validated/vision/style_transfer/fast_neural_style/model/candy-9.onnx',
        'filename': 'candy_9.onnx',
        'description': 'Bold, colorful brush strokes',
    },
    'abstract': {
        'url': 'https://github.com/onnx/models/raw/main/validated/vision/style_transfer/fast_neural_style/model/udnie-9.onnx',
        'filename': 'udnie_9.onnx',
        'description': 'Abstract brush strokes (Francis Picabia)',
    },
    'mosaic': {
        'url': 'https://github.com/onnx/models/raw/main/validated/vision/style_transfer/fast_neural_style/model/mosaic-9.onnx',
        'filename': 'mosaic_9.onnx',
        'description': 'Cubist/mosaic pattern',
    },
    'expressive': {
        'url': 'https://github.com/onnx/models/raw/main/validated/vision/style_transfer/fast_neural_style/model/pointilism-9.onnx',
        'filename': 'pointilism_9.onnx',
        'description': 'Expressive pointillist brush strokes',
    },
}


def _get_models_dir() -> str:
    """Get or create the models cache directory."""
    # Use workspace/models/style_transfer/ if WORKSPACE_DIR is set,
    # otherwise fall back to ~/.cache/video-editor/models/style_transfer/
    workspace = os.environ.get('WORKSPACE_DIR', '')
    if workspace:
        models_dir = os.path.join(workspace, 'models', 'style_transfer')
    else:
        models_dir = os.path.join(
            os.path.expanduser('~'), '.cache', 'video-editor', 'models', 'style_transfer'
        )
    os.makedirs(models_dir, exist_ok=True)
    return models_dir


def download_model(preset: str) -> str:
    """Download the ONNX model for the given preset if not already cached."""
    if preset not in STYLE_MODELS:
        print(f"WARNING: Unknown preset '{preset}', falling back to 'impressionist'",
              flush=True)
        preset = 'impressionist'

    model_info = STYLE_MODELS[preset]
    models_dir = _get_models_dir()
    model_path = os.path.join(models_dir, model_info['filename'])

    if os.path.exists(model_path):
        print(f"[ai_style] Model '{preset}' already cached: {model_path}", flush=True)
        return model_path

    url = model_info['url']
    print(f"[ai_style] Downloading model '{preset}' ({model_info['description']})...",
          flush=True)
    print(f"[ai_style] URL: {url}", flush=True)

    try:
        urllib.request.urlretrieve(url, model_path)
        file_size = os.path.getsize(model_path)
        print(f"[ai_style] Model downloaded: {file_size / 1024 / 1024:.1f} MB", flush=True)
    except Exception as e:
        print(f"ERROR: Failed to download model: {e}", flush=True)
        # Clean up partial download
        if os.path.exists(model_path):
            os.remove(model_path)
        sys.exit(1)

    return model_path


# ─── FFmpeg helpers ──────────────────────────────────────────────────────────

def _run_ffmpeg(args: list, label: str) -> None:
    """Run ffmpeg, print stderr on failure."""
    try:
        subprocess.run(args, check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        stderr_text = e.stderr.decode(errors='replace').strip()
        print(f"ERROR: {label} failed (exit {e.returncode}):", flush=True)
        if stderr_text:
            for line in stderr_text.splitlines():
                print(f"  ffmpeg: {line}", flush=True)
        sys.exit(1)
    except FileNotFoundError:
        print("ERROR: ffmpeg not found. Please install ffmpeg.", flush=True)
        sys.exit(1)


def _get_fps(input_path: str) -> float:
    """Extract FPS from input video using ffprobe."""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate",
            "-of", "default=noprint_wrappers=1:nokey=1",
            input_path,
        ],
        capture_output=True, text=True,
    )
    fps_str = result.stdout.strip()
    try:
        num, den = fps_str.split("/")
        return float(num) / float(den)
    except Exception:
        return 30.0


# ─── Neural style transfer ──────────────────────────────────────────────────

def create_style_session(model_path: str):
    """Create an ONNX Runtime inference session for style transfer."""
    import onnxruntime as ort

    # Prefer CPU provider for deterministic and consistent results
    providers = ['CPUExecutionProvider']
    session = ort.InferenceSession(model_path, providers=providers)
    return session


def stylize_frame_neural(frame: np.ndarray, session,
                         brush_size: float) -> np.ndarray:
    """
    Apply neural style transfer to a single frame using ONNX model.

    The brush_size parameter controls the input downscale ratio:
    - brush_size=0 → process at full resolution (fine brush strokes)
    - brush_size=1 → process at 40% resolution (large, coarse brush strokes)

    Processing at lower resolution and upscaling back creates naturally
    larger brush strokes, similar to painting with a wider brush.
    """
    h, w = frame.shape[:2]

    # brush_size controls downscale: 0→100%, 1→40% (larger brush = lower res input)
    scale_factor = max(0.4, 1.0 - brush_size * 0.6)
    proc_w = max(64, int(w * scale_factor))
    proc_h = max(64, int(h * scale_factor))

    # Resize for processing (controls brush stroke size)
    if scale_factor < 0.99:
        proc_frame = cv2.resize(frame, (proc_w, proc_h), interpolation=cv2.INTER_AREA)
    else:
        proc_frame = frame

    # Convert BGR→RGB and reshape for ONNX: [1, 3, H, W] float32
    rgb = cv2.cvtColor(proc_frame, cv2.COLOR_BGR2RGB).astype(np.float32)
    input_tensor = np.transpose(rgb, (2, 0, 1))  # HWC → CHW
    input_tensor = np.expand_dims(input_tensor, axis=0)  # add batch dim

    # Run inference
    input_name = session.get_inputs()[0].name
    output_name = session.get_outputs()[0].name
    result = session.run([output_name], {input_name: input_tensor})[0]

    # Convert output: [1, 3, H, W] → [H, W, 3] BGR uint8
    output = result[0]  # remove batch dim
    output = np.transpose(output, (1, 2, 0))  # CHW → HWC
    output = np.clip(output, 0, 255).astype(np.uint8)
    output = cv2.cvtColor(output, cv2.COLOR_RGB2BGR)

    # Upscale back to original resolution if downscaled
    if output.shape[:2] != (h, w):
        output = cv2.resize(output, (w, h), interpolation=cv2.INTER_LANCZOS4)

    return output


def enhance_colors(frame: np.ndarray, color_vibrance: float) -> np.ndarray:
    """Post-process: boost color vibrance in HSV space."""
    if abs(color_vibrance - 1.0) < 0.05:
        return frame

    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * color_vibrance, 0, 255)
    # Slight brightness adjustment for painterly warmth
    hsv[:, :, 2] = np.clip(hsv[:, :, 2] * (0.95 + color_vibrance * 0.05), 0, 255)
    return cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)


# ─── Optical flow for temporal consistency ───────────────────────────────────

def compute_optical_flow(prev_gray: np.ndarray,
                         curr_gray: np.ndarray) -> np.ndarray:
    """
    Compute dense optical flow using DIS algorithm (FAST preset for speed).
    Returns a 2-channel flow map (dx, dy).
    """
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_FAST)
    dis.setVariationalRefinementIterations(3)
    flow = dis.calc(prev_gray, curr_gray, None)
    return flow


def warp_frame(frame: np.ndarray, flow: np.ndarray) -> np.ndarray:
    """Warp a frame according to the given optical flow field."""
    h, w = flow.shape[:2]
    x_coords, y_coords = np.meshgrid(np.arange(w), np.arange(h))
    map_x = (x_coords + flow[:, :, 0]).astype(np.float32)
    map_y = (y_coords + flow[:, :, 1]).astype(np.float32)
    warped = cv2.remap(frame, map_x, map_y, cv2.INTER_LINEAR,
                       borderMode=cv2.BORDER_REFLECT_101)
    return warped


def compute_flow_confidence(flow: np.ndarray) -> np.ndarray:
    """
    Estimate confidence of optical flow.
    Uses smoother sigmoid mapping for better temporal blending.
    Returns a single-channel map in [0, 1].
    """
    magnitude = np.sqrt(flow[:, :, 0] ** 2 + flow[:, :, 1] ** 2)
    # Smoother confidence curve: gentle drop-off for moderate motion
    confidence = 1.0 / (1.0 + (magnitude / 15.0) ** 2)
    return confidence.astype(np.float32)


def detect_scene_changes(frames_dir: str, frames: list,
                         threshold: float = 30.0) -> set:
    """Detect scene cuts by computing MAD between consecutive frames."""
    boundaries = {0}
    for i in range(1, len(frames)):
        prev = cv2.imread(os.path.join(frames_dir, frames[i - 1]),
                          cv2.IMREAD_GRAYSCALE)
        curr = cv2.imread(os.path.join(frames_dir, frames[i]),
                          cv2.IMREAD_GRAYSCALE)
        if prev is None or curr is None:
            continue
        prev_small = cv2.resize(prev, (160, 90))
        curr_small = cv2.resize(curr, (160, 90))
        mad = np.mean(np.abs(prev_small.astype(float) - curr_small.astype(float)))
        if mad > threshold:
            boundaries.add(i)
    return boundaries


# ─── Main pipeline ───────────────────────────────────────────────────────────

def process_ai_style(input_path: str, output_path: str,
                     style_strength: float = 0.8,
                     brush_size: float = 0.5,
                     color_vibrance: float = 1.3,
                     style_preset: str = 'impressionist') -> None:
    """
    Main AI style processing pipeline.

    Uses neural style transfer (ONNX) for genuine brush-stroke textures,
    with optical flow propagation for smooth temporal consistency.
    """
    print(f"[ai_style] Input: {input_path}", flush=True)
    print(f"[ai_style] Output: {output_path}", flush=True)
    print(f"[ai_style] Params: strength={style_strength}, "
          f"brush={brush_size}, vibrance={color_vibrance}, "
          f"preset={style_preset}", flush=True)

    if not os.path.exists(input_path):
        print(f"ERROR: Input file not found: {input_path}", flush=True)
        sys.exit(1)

    # Download model if needed
    model_path = download_model(style_preset)

    # Create ONNX session
    print("[ai_style] Loading ONNX model...", flush=True)
    session = create_style_session(model_path)
    print("[ai_style] Model loaded.", flush=True)

    fps = _get_fps(input_path)
    print(f"[ai_style] FPS: {fps:.2f}", flush=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        frames_dir = os.path.join(tmpdir, "frames")
        styled_dir = os.path.join(tmpdir, "styled")
        os.makedirs(frames_dir)
        os.makedirs(styled_dir)

        # --- Extract frames ---
        print("[ai_style] Extracting frames...", flush=True)
        _run_ffmpeg(
            [
                "ffmpeg", "-y",
                "-i", input_path,
                "-q:v", "2",
                os.path.join(frames_dir, "frame_%06d.jpg"),
            ],
            "Frame extraction",
        )

        frames = sorted(f for f in os.listdir(frames_dir) if f.endswith(".jpg"))
        total = len(frames)
        if total == 0:
            print("ERROR: No frames extracted from input video.", flush=True)
            sys.exit(1)
        print(f"[ai_style] Processing {total} frames...", flush=True)

        # --- Detect scene changes ---
        scene_boundaries = detect_scene_changes(frames_dir, frames)
        sorted_boundaries = sorted(scene_boundaries)
        n_scenes = len(scene_boundaries)
        print(f"[ai_style] Found {n_scenes} scene(s) / "
              f"{n_scenes - 1} cut(s).", flush=True)

        # --- Determine keyframe interval ---
        # Denser keyframes for better quality: every 5 frames (~6 per second at 30fps)
        # This is more aggressive than the old approach but the neural model
        # produces consistent output so propagation between keyframes is smoother.
        keyframe_interval = 5
        print(f"[ai_style] Keyframe interval: every {keyframe_interval} frames",
              flush=True)

        # Build keyframe set: scene starts + regular intervals
        keyframe_indices = set()
        for b in sorted_boundaries:
            keyframe_indices.add(b)
        for i in range(0, total, keyframe_interval):
            keyframe_indices.add(i)
        keyframe_indices.add(total - 1)

        # --- Pass 1: Stylize all keyframes with neural style transfer ---
        print("[ai_style] Stylizing keyframes with neural style transfer...",
              flush=True)
        keyframe_styled = {}
        kf_sorted = sorted(keyframe_indices)
        for ki, idx in enumerate(kf_sorted):
            frame_path = os.path.join(frames_dir, frames[idx])
            frame = cv2.imread(frame_path)
            if frame is None:
                continue

            # Neural style transfer
            styled = stylize_frame_neural(frame, session, brush_size)

            # Post-process: color vibrance
            styled = enhance_colors(styled, color_vibrance)

            # Blend with original based on style_strength
            blended = cv2.addWeighted(styled, style_strength, frame,
                                      1.0 - style_strength, 0)
            keyframe_styled[idx] = blended

            pct = int((ki + 1) / len(kf_sorted) * 50)  # First 50% for keyframes
            print(f"[ai_style] {pct}% (keyframe {ki + 1}/{len(kf_sorted)})",
                  flush=True)

        print(f"[ai_style] Stylized {len(keyframe_styled)} keyframes.", flush=True)

        # --- Pass 2: Propagate style using optical flow ---
        print("[ai_style] Propagating style with optical flow...", flush=True)

        def scene_range(idx):
            start = 0
            for b in sorted_boundaries:
                if b <= idx:
                    start = b
            end = total
            for b in sorted_boundaries:
                if b > idx:
                    end = b
                    break
            return start, end

        prev_gray = None
        prev_styled = None

        for i in range(total):
            frame_path = os.path.join(frames_dir, frames[i])
            frame = cv2.imread(frame_path)
            if frame is None:
                continue

            curr_gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            s_start, s_end = scene_range(i)

            if i in keyframe_styled:
                # Keyframe — use pre-computed neural stylization
                result = keyframe_styled[i]
            elif prev_styled is not None and prev_gray is not None and i > s_start:
                # Propagate from previous frame using optical flow
                flow = compute_optical_flow(prev_gray, curr_gray)
                warped = warp_frame(prev_styled, flow)
                confidence = compute_flow_confidence(flow)

                # Find nearest keyframe for blending anchor
                # (provides independent reference to prevent drift)
                nearest_kf = None
                for kf in kf_sorted:
                    if kf <= i and kf >= s_start:
                        nearest_kf = kf
                    elif kf > i:
                        break

                if nearest_kf is not None and nearest_kf in keyframe_styled:
                    # Distance-based weight: closer to keyframe = trust keyframe more
                    dist = i - nearest_kf
                    kf_weight = max(0.1, 1.0 - dist / (keyframe_interval * 2))
                else:
                    kf_weight = 0.0

                # Blend warped + keyframe anchor for stability
                conf_3ch = confidence[:, :, np.newaxis]

                # Higher temporal weight (0.85) for smoother transitions
                temporal_weight = 0.85
                blend_weight = conf_3ch * temporal_weight

                result = (warped.astype(np.float32) * blend_weight +
                          prev_styled.astype(np.float32) * (1.0 - blend_weight))
                result = np.clip(result, 0, 255).astype(np.uint8)
            else:
                # First frame of a new scene or no previous context
                styled = stylize_frame_neural(frame, session, brush_size)
                styled = enhance_colors(styled, color_vibrance)
                result = cv2.addWeighted(styled, style_strength, frame,
                                         1.0 - style_strength, 0)

            # Save styled frame
            out_name = frames[i].replace(".jpg", ".png")
            cv2.imwrite(os.path.join(styled_dir, out_name), result)

            prev_gray = curr_gray
            prev_styled = result

            pct = 50 + int((i + 1) / total * 50)  # Second 50% for propagation
            print(f"[ai_style] {pct}% ({i + 1}/{total})", flush=True)

        # --- Assemble styled frames into output video ---
        print("[ai_style] Assembling output video...", flush=True)
        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        _run_ffmpeg(
            [
                "ffmpeg", "-y",
                "-framerate", str(fps),
                "-i", os.path.join(styled_dir, "frame_%06d.png"),
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "18",
                "-pix_fmt", "yuv420p",
                output_path,
            ],
            "Output video assembly",
        )

    print(f"[ai_style] Done: {output_path}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 3 or len(sys.argv) > 7:
        print(
            f"Usage: {sys.argv[0]} <input_video> <output_mp4> "
            f"[style_strength] [brush_size] [color_vibrance] [style_preset]",
            file=sys.stderr,
        )
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    strength = float(sys.argv[3]) if len(sys.argv) > 3 else 0.8
    brush = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
    vibrance = float(sys.argv[5]) if len(sys.argv) > 5 else 1.3
    preset = sys.argv[6] if len(sys.argv) > 6 else 'impressionist'

    # Clamp parameters
    strength = max(0.0, min(1.0, strength))
    brush = max(0.0, min(1.0, brush))
    vibrance = max(0.0, min(2.0, vibrance))

    # Validate preset
    if preset not in STYLE_MODELS:
        print(f"WARNING: Unknown preset '{preset}', using 'impressionist'",
              file=sys.stderr)
        preset = 'impressionist'

    process_ai_style(input_path, output_path, strength, brush, vibrance, preset)
