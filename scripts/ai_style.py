#!/usr/bin/env python3
"""
AI Style — AnimeGANv2 cartoon stylization with temporal consistency.

Uses ONNX Runtime with AnimeGANv2 models that convert real photos/video into
genuine cartoon/anime art. Unlike neural style transfer which applies painterly
textures, AnimeGANv2 is a GAN specifically trained to produce cartoon-like output
with flat color regions, clean edges, and stylized shading — true cartoonization.

Usage:
    python3 ai_style.py <input_video> <output_video> [style_strength] [brush_size] [color_vibrance] [style_preset]

Parameters:
    input_video     Path to the proxy video (MP4)
    output_video    Path for the stylized output (MP4)
    style_strength  0.0–1.0  Blend weight between original and stylized (default 0.8)
    brush_size      0.0–1.0  Controls detail level via input resolution (default 0.5)
    color_vibrance  0.0–2.0  Color vibrancy of cartoon output (default 1.3)
    style_preset    Model preset name (default 'hayao')
                    Options: hayao, shinkai, paprika, celeb

Pipeline:
    1. Download AnimeGANv2 ONNX model (if not cached)
    2. Extract frames from input video
    3. Detect scene cuts for propagation boundaries
    4. Cartoonize keyframes with AnimeGANv2 model via ONNX Runtime
    5. Propagate style between keyframes using optical flow with temporal blending
    6. Apply color vibrance post-processing
    7. Assemble cartoonized frames into output video

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
import hashlib
import urllib.request
import urllib.error
import shutil
from typing import Optional

# ─── Dependency checks ──────────────────────────────────────────────────────
_missing_deps = []
try:
    import numpy as np
except ImportError:
    _missing_deps.append('numpy')

try:
    import cv2
except ImportError:
    _missing_deps.append('opencv-python-headless')

if _missing_deps:
    print(f"ERROR: Missing Python dependencies: {', '.join(_missing_deps)}. "
          f"Install with: pip install {' '.join(_missing_deps)}",
          file=sys.stderr, flush=True)
    sys.exit(1)

# ─── Model configuration ────────────────────────────────────────────────────

# Base URL for downloading AnimeGANv2 ONNX models.
# Can be overridden with the AI_STYLE_MODEL_BASE_URL environment variable.
# The default points to the bryandlee/animegan2-pytorch Hugging Face space
# which provides pre-converted ONNX models.
_DEFAULT_MODEL_BASE_URL = (
    'https://huggingface.co/bryandlee/animegan2-pytorch/resolve/main/onnx'
)
MODEL_BASE_URL = os.environ.get('AI_STYLE_MODEL_BASE_URL', _DEFAULT_MODEL_BASE_URL)

# Fallback mirror URLs for each preset (publicly accessible HuggingFace repos).
# Used when the primary bryandlee repo is unavailable (e.g. gated/private).
_FALLBACK_URLS: dict = {
    'hayao': [
        'https://huggingface.co/vumichien/AnimeGANv2_Hayao/resolve/main/AnimeGANv2_Hayao.onnx',
    ],
    'shinkai': [
        'https://huggingface.co/vumichien/AnimeGANv2_Shinkai/resolve/main/AnimeGANv2_Shinkai.onnx',
    ],
    'paprika': [
        'https://huggingface.co/vumichien/AnimeGANv2_Paprika/resolve/main/AnimeGANv2_Paprika.onnx',
    ],
    'celeb': [
        'https://huggingface.co/akhaliq/AnimeGANv2-ONNX/resolve/main/face_paint_512_v2_0.onnx',
    ],
}

# Map of preset names to AnimeGANv2 ONNX model files.
# AnimeGANv2 is a GAN specifically trained to convert real photos/video into
# cartoon/anime art — producing flat color regions, clean edges, and stylized
# shading. Unlike neural style transfer, these models perform true cartoonization.
#
# Models are auto-downloaded on first use from MODEL_BASE_URL.
# They can also be manually placed in the models directory
# (workspace/models/style_transfer/ or ~/.cache/video-editor/models/style_transfer/).
#
# Input preprocessing:  BGR → RGB, resize (divisible by 8), normalize to [-1, 1]
# Output postprocessing: denormalize from [-1, 1] → [0, 255], RGB → BGR
STYLE_MODELS = {
    'hayao': {
        'filename': 'animeganv2_hayao.onnx',
        'description': 'Studio Ghibli / Hayao Miyazaki style — soft colors, natural scenery',
        'input_size': 512,  # recommended input size (will be adjusted to preserve aspect ratio)
        'sha256': None,  # will be verified if provided
    },
    'shinkai': {
        'filename': 'animeganv2_shinkai.onnx',
        'description': 'Makoto Shinkai style — vivid sky colors, crisp details',
        'input_size': 512,
        'sha256': None,
    },
    'paprika': {
        'filename': 'animeganv2_paprika.onnx',
        'description': 'Satoshi Kon / Paprika style — dreamy, expressive colors',
        'input_size': 512,
        'sha256': None,
    },
    'celeb': {
        'filename': 'animeganv2_celeb.onnx',
        'description': 'Portrait-focused cartoon style — optimized for faces',
        'input_size': 512,
        'sha256': None,
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


def _compute_sha256(filepath: str) -> str:
    """Compute SHA-256 hex digest for a file."""
    h = hashlib.sha256()
    with open(filepath, 'rb') as f:
        while True:
            chunk = f.read(1 << 20)  # 1 MiB
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def _build_download_urls(base_url: str, filename: str,
                         preset: Optional[str] = None) -> list:
    """
    Build a list of candidate download URLs to try in order.

    HuggingFace now requires '?download=true' for direct file downloads.
    We try multiple URL patterns to maximize compatibility:
    1. base_url/filename?download=true (HuggingFace with download flag)
    2. base_url/filename (plain URL, works for mirrors/custom servers)
    3. Fallback mirror URLs for the preset (publicly accessible repos)
    """
    base = base_url.rstrip('/')
    urls = []
    # HuggingFace requires ?download=true for authenticated/gated downloads
    if 'huggingface.co' in base:
        urls.append(f"{base}/{filename}?download=true")
    # Plain URL (works for local servers, mirrors, and older HF repos)
    urls.append(f"{base}/{filename}")
    # Append fallback mirror URLs for the preset
    if preset and preset in _FALLBACK_URLS:
        for fallback_url in _FALLBACK_URLS[preset]:
            if fallback_url not in urls:
                urls.append(fallback_url)
    return urls


def download_model(preset: str, models_dir: Optional[str] = None,
                   base_url: Optional[str] = None) -> str:
    """
    Download an AnimeGANv2 ONNX model for the given preset.

    Downloads from MODEL_BASE_URL (or the provided base_url) into models_dir.
    Uses atomic write (download to temp file, then rename) to avoid partial files.

    Supports HuggingFace authentication via HF_TOKEN environment variable.
    Automatically appends ?download=true for HuggingFace URLs.

    Returns the path to the downloaded model file.
    Raises RuntimeError if download fails.
    """
    if preset not in STYLE_MODELS:
        raise ValueError(f"Unknown preset: '{preset}'. "
                         f"Available: {', '.join(STYLE_MODELS.keys())}")

    model_info = STYLE_MODELS[preset]
    if models_dir is None:
        models_dir = _get_models_dir()
    if base_url is None:
        base_url = MODEL_BASE_URL

    filename = model_info['filename']
    model_path = os.path.join(models_dir, filename)
    urls = _build_download_urls(base_url, filename, preset=preset)

    # HuggingFace authentication token (optional, needed for gated/private repos)
    hf_token = os.environ.get('HF_TOKEN', '').strip()

    os.makedirs(models_dir, exist_ok=True)

    # Try each candidate URL in order
    last_error = None
    for url in urls:
        print(f"[ai_style] Downloading model '{preset}' from {url} ...", flush=True)

        # Download to a temp file first (atomic write to avoid partial files)
        tmp_path = model_path + '.download'
        try:
            headers = {
                'User-Agent': 'video-editor/1.0 (AnimeGANv2 model download)',
            }
            if hf_token and 'huggingface.co' in url:
                headers['Authorization'] = f'Bearer {hf_token}'

            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=120) as resp:
                total = resp.headers.get('Content-Length')
                total = int(total) if total else None
                downloaded = 0
                last_pct = -1

                with open(tmp_path, 'wb') as out:
                    while True:
                        chunk = resp.read(1 << 18)  # 256 KiB
                        if not chunk:
                            break
                        out.write(chunk)
                        downloaded += len(chunk)

                        if total:
                            pct = int(downloaded / total * 100)
                            if pct != last_pct and pct % 10 == 0:
                                print(f"[ai_style] Download: {pct}% "
                                      f"({downloaded // 1024}/{total // 1024} KiB)",
                                      flush=True)
                                last_pct = pct

            # Verify file size (should be at least 1 MiB for an ONNX model)
            file_size = os.path.getsize(tmp_path)
            if file_size < 1024 * 1024:
                raise RuntimeError(
                    f"Downloaded file is too small ({file_size} bytes). "
                    f"Expected at least 1 MiB for an ONNX model."
                )

            # Verify SHA-256 if available
            expected_hash = model_info.get('sha256')
            if expected_hash:
                actual_hash = _compute_sha256(tmp_path)
                if actual_hash != expected_hash:
                    raise RuntimeError(
                        f"SHA-256 mismatch for '{filename}': "
                        f"expected {expected_hash[:16]}..., got {actual_hash[:16]}..."
                    )
                print(f"[ai_style] SHA-256 verified: {actual_hash[:16]}...",
                      flush=True)

            # Atomic rename
            shutil.move(tmp_path, model_path)
            print(f"[ai_style] Model '{preset}' downloaded: {model_path} "
                  f"({file_size // 1024} KiB)", flush=True)
            return model_path

        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
            # Clean up partial download
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            last_error = e
            # If it's a 401/403 and we have more URLs to try, continue
            is_auth_error = (isinstance(e, urllib.error.HTTPError)
                             and e.code in (401, 403))
            if is_auth_error:
                print(f"[ai_style] Auth error ({e.code}) for {url}, "
                      f"trying next URL...", flush=True)
            else:
                print(f"[ai_style] Download failed for {url}: {e}", flush=True)
            continue
        except RuntimeError as e:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
            last_error = e
            continue

    # All URLs failed
    hint = ""
    if isinstance(last_error, urllib.error.HTTPError) and last_error.code in (401, 403):
        hint = (" | Hint: Set the HF_TOKEN environment variable with a "
                "HuggingFace access token for authenticated downloads. "
                "Get one at https://huggingface.co/settings/tokens")
    raise RuntimeError(
        f"Failed to download model '{preset}' from all URLs: {last_error}{hint}"
    )


def get_model_status(models_dir: Optional[str] = None) -> dict:
    """
    Check download status of all AI style models.

    Returns a dict mapping preset names to their status:
    {
        'hayao': { 'available': True, 'path': '...', 'size': 12345 },
        'shinkai': { 'available': False, 'path': '...' },
        ...
    }
    """
    if models_dir is None:
        models_dir = _get_models_dir()

    status = {}
    for preset, info in STYLE_MODELS.items():
        model_path = os.path.join(models_dir, info['filename'])
        if os.path.exists(model_path):
            status[preset] = {
                'available': True,
                'path': model_path,
                'size': os.path.getsize(model_path),
            }
        else:
            status[preset] = {
                'available': False,
                'path': model_path,
            }
    return status


def resolve_model(preset: str, auto_download: bool = True) -> str:
    """
    Resolve the ONNX model path for the given preset.

    If the model is not found locally and auto_download is True,
    attempts to download it automatically from MODEL_BASE_URL.
    """
    if preset not in STYLE_MODELS:
        print(f"WARNING: Unknown preset '{preset}', falling back to 'hayao'",
              flush=True)
        preset = 'hayao'

    model_info = STYLE_MODELS[preset]
    models_dir = _get_models_dir()
    model_path = os.path.join(models_dir, model_info['filename'])

    if os.path.exists(model_path):
        print(f"[ai_style] Model '{preset}' found: {model_path}", flush=True)
        return model_path

    if auto_download:
        print(f"[ai_style] Model '{preset}' not found locally. "
              f"Attempting auto-download...", flush=True)
        try:
            return download_model(preset, models_dir)
        except RuntimeError as e:
            print(f"ERROR: Auto-download failed: {e}",
                  file=sys.stderr, flush=True)
            print(f"Please manually place the AnimeGANv2 ONNX model at: "
                  f"{model_path}", file=sys.stderr, flush=True)
            print(f"Or run: python3 download_ai_models.py {preset}",
                  file=sys.stderr, flush=True)
            sys.exit(1)

    print(f"ERROR: Model file not found: {model_path}",
          file=sys.stderr, flush=True)
    print(f"Please place the AnimeGANv2 ONNX model at: {model_path}",
          file=sys.stderr, flush=True)
    print(f"Model: {model_info['description']}",
          file=sys.stderr, flush=True)
    print(f"Run: python3 download_ai_models.py {preset}",
          file=sys.stderr, flush=True)
    sys.exit(1)


# ─── FFmpeg helpers ──────────────────────────────────────────────────────────

def _run_ffmpeg(args: list, label: str) -> None:
    """Run ffmpeg, print stderr on failure."""
    try:
        subprocess.run(args, check=True, capture_output=True)
    except subprocess.CalledProcessError as e:
        stderr_text = e.stderr.decode(errors='replace').strip()
        print(f"ERROR: {label} failed (exit {e.returncode}):",
              file=sys.stderr, flush=True)
        if stderr_text:
            for line in stderr_text.splitlines():
                print(f"  ffmpeg: {line}", file=sys.stderr, flush=True)
        sys.exit(1)
    except FileNotFoundError:
        print("ERROR: ffmpeg not found. Please install ffmpeg.",
              file=sys.stderr, flush=True)
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


# ─── AnimeGANv2 cartoonization ─────────────────────────────────────────────

def create_style_session(model_path: str):
    """Create an ONNX Runtime inference session for AnimeGANv2."""
    try:
        import onnxruntime as ort
    except ImportError:
        print("ERROR: Missing Python dependency: onnxruntime. "
              "Install with: pip install onnxruntime",
              file=sys.stderr, flush=True)
        sys.exit(1)

    # Prefer CPU provider for deterministic and consistent results
    providers = ['CPUExecutionProvider']
    session = ort.InferenceSession(model_path, providers=providers)
    return session


def _align_to_8(n: int) -> int:
    """Round up to nearest multiple of 8 (required by AnimeGANv2 architecture)."""
    return ((n + 7) // 8) * 8


def stylize_frame_neural(frame: np.ndarray, session,
                         brush_size: float) -> np.ndarray:
    """
    Apply AnimeGANv2 cartoonization to a single frame using ONNX model.

    AnimeGANv2 models are GANs trained to convert real photos into cartoon/anime.
    They produce flat color regions, clean edges, and stylized shading — true
    cartoon look, not just artistic texture overlay.

    The brush_size parameter controls the input resolution:
    - brush_size=0 → process at higher resolution (finer cartoon details)
    - brush_size=1 → process at lower resolution (broader, more stylized)

    The model format (NHWC vs NCHW) is auto-detected from the ONNX input shape.
    AnimeGANv2 input:  float32, normalized to [-1, 1]
    AnimeGANv2 output: float32, in [-1, 1] range
    """
    h, w = frame.shape[:2]

    # brush_size controls processing resolution
    # 0 → 100% of recommended size, 1 → 50% (broader cartoon strokes)
    scale_factor = max(0.5, 1.0 - brush_size * 0.5)
    target_size = int(STYLE_MODELS.get('hayao', {}).get('input_size', 512) * scale_factor)

    # Scale preserving aspect ratio, dimensions must be divisible by 8
    ratio = target_size / max(h, w)
    if ratio >= 1.0:
        ratio = 1.0
    proc_w = _align_to_8(max(64, int(w * ratio)))
    proc_h = _align_to_8(max(64, int(h * ratio)))

    # Resize for processing
    proc_frame = cv2.resize(frame, (proc_w, proc_h), interpolation=cv2.INTER_AREA)

    # Convert BGR→RGB, normalize to [-1, 1] (AnimeGANv2 input range)
    rgb = cv2.cvtColor(proc_frame, cv2.COLOR_BGR2RGB).astype(np.float32)
    input_tensor = rgb / 127.5 - 1.0  # [0, 255] → [-1, 1]

    # Auto-detect model layout from ONNX input shape
    input_meta = session.get_inputs()[0]
    input_name = input_meta.name
    input_shape = input_meta.shape  # e.g. [1, 3, H, W] or [1, H, W, 3]
    # Determine if model expects NCHW (channel dim at index 1) or NHWC (channel dim at index 3)
    is_nchw = (len(input_shape) == 4 and isinstance(input_shape[1], int) and input_shape[1] == 3)

    if is_nchw:
        input_tensor = np.transpose(input_tensor, (2, 0, 1))  # HWC → CHW
    # else: keep HWC layout for NHWC models (e.g. TensorFlow-exported AnimeGANv2)

    input_tensor = np.expand_dims(input_tensor, axis=0)  # add batch dim

    # Run inference
    output_name = session.get_outputs()[0].name
    result = session.run([output_name], {input_name: input_tensor})[0]

    # Convert output back to HWC BGR uint8
    output = result[0]  # remove batch dim
    if is_nchw:
        output = np.transpose(output, (1, 2, 0))  # CHW → HWC
    # else: output is already HWC for NHWC models

    # Denormalize from [-1, 1] → [0, 255]
    output = (output + 1.0) * 127.5
    output = np.clip(output, 0, 255).astype(np.uint8)
    output = cv2.cvtColor(output, cv2.COLOR_RGB2BGR)

    # Upscale back to original resolution
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
                     style_preset: str = 'hayao') -> None:
    """
    Main AI style processing pipeline.

    Uses AnimeGANv2 (ONNX) for genuine cartoon/anime stylization,
    with optical flow propagation for smooth temporal consistency.
    """
    print(f"[ai_style] Input: {input_path}", flush=True)
    print(f"[ai_style] Output: {output_path}", flush=True)
    print(f"[ai_style] Params: strength={style_strength}, "
          f"brush={brush_size}, vibrance={color_vibrance}, "
          f"preset={style_preset}", flush=True)

    if not os.path.exists(input_path):
        print(f"ERROR: Input file not found: {input_path}",
              file=sys.stderr, flush=True)
        sys.exit(1)

    # Resolve model path (must be pre-placed)
    model_path = resolve_model(style_preset)

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
            print("ERROR: No frames extracted from input video.",
                  file=sys.stderr, flush=True)
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

        # --- Pass 1: Cartoonize all keyframes with AnimeGANv2 ---
        print("[ai_style] Cartoonizing keyframes with AnimeGANv2...",
              flush=True)
        keyframe_styled = {}
        kf_sorted = sorted(keyframe_indices)
        for ki, idx in enumerate(kf_sorted):
            frame_path = os.path.join(frames_dir, frames[idx])
            frame = cv2.imread(frame_path)
            if frame is None:
                continue

            # AnimeGANv2 cartoonization
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
    preset = sys.argv[6] if len(sys.argv) > 6 else 'hayao'

    # Clamp parameters
    strength = max(0.0, min(1.0, strength))
    brush = max(0.0, min(1.0, brush))
    vibrance = max(0.0, min(2.0, vibrance))

    # Validate preset
    if preset not in STYLE_MODELS:
        print(f"WARNING: Unknown preset '{preset}', using 'hayao'",
              file=sys.stderr)
        preset = 'hayao'

    process_ai_style(input_path, output_path, strength, brush, vibrance, preset)
