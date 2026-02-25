#!/usr/bin/env python3
"""
Person cutout using rembg (background removal).
Usage: python3 cutout.py <input_video_path> <output_mask_path> [mode]

mode:
  removeBg      (default) White = person, black = background.
                           Apply as mask to keep person, replace background.
  removePerson  Inverted:  White = background, black = person.
                           Apply as mask to remove person, keep background.

Generates a grayscale mask video using rembg with u2net_human_seg model.

Improvements over naive per-frame segmentation:
  - Mask tightening: threshold + erosion + Gaussian blur removes the
    semi-transparent halo that u2net leaves around the subject.
  - Temporal smoothing: each mask is blended with its immediate neighbours
    (weights 0.15 / 0.70 / 0.15) to reduce inter-frame jitter without
    blurring real motion.
  - Scene-cut awareness: blending never crosses a detected scene cut, so
    hard edits stay sharp.
"""

import sys
import os
import subprocess
import tempfile
import shutil


def _run_ffmpeg(args: list, label: str) -> None:
    """Run ffmpeg with the given args, printing stderr to stdout on failure."""
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
        print(f"ERROR: ffmpeg not found. Please install ffmpeg.", flush=True)
        sys.exit(1)


def _erode_mask(binary, iterations: int = 2):
    """
    Simple binary erosion using numpy (no scipy dependency).
    Shrinks True regions; border pixels are always set to False.
    """
    import numpy as np
    result = binary.astype(bool)
    for _ in range(iterations):
        up    = np.roll(result, -1, axis=0)
        down  = np.roll(result,  1, axis=0)
        left  = np.roll(result, -1, axis=1)
        right = np.roll(result,  1, axis=1)
        result = result & up & down & left & right
        # Border pixels always removed by erosion
        result[ 0, :] = False
        result[-1, :] = False
        result[ :, 0] = False
        result[ :,-1] = False
    return result


def _tighten_mask(mask_array):
    """
    Tighten the raw rembg alpha mask to remove the semi-transparent halo:
      1. Hard threshold at 180 – keeps only high-confidence person pixels.
      2. Erode 2 px inward to strip any residual fringe at the boundary.
      3. Gaussian blur (r=1.5 px) to restore natural-looking soft edges.

    Returns a uint8 numpy array (0-255).
    """
    from PIL import Image, ImageFilter
    import numpy as np

    binary = mask_array > 180          # only confident person pixels
    eroded = _erode_mask(binary, iterations=2)
    smooth = (
        Image.fromarray(eroded.astype(np.uint8) * 255)
        .filter(ImageFilter.GaussianBlur(radius=1.5))
    )
    return np.array(smooth)


def _detect_scene_changes(frames_dir: str, frames: list,
                           threshold: float = 25.0) -> set:
    """
    Detect hard scene cuts by computing the grayscale mean-absolute-difference
    (MAD) between consecutive frames.

    Returns a set of frame *indices* that start a new scene.
    Index 0 is always included as the first scene boundary.

    threshold: MAD value (0-255) above which a cut is declared.
               25 works well for typical compressed video; lower = more
               sensitive, higher = fewer cuts detected.
    """
    from PIL import Image
    import numpy as np

    boundaries = {0}
    print(f"[cutout] Detecting scene cuts (threshold={threshold})...",
          flush=True)

    for i in range(1, len(frames)):
        prev = np.array(
            Image.open(os.path.join(frames_dir, frames[i - 1])).convert("L"),
            dtype=float,
        )
        curr = np.array(
            Image.open(os.path.join(frames_dir, frames[i])).convert("L"),
            dtype=float,
        )
        if np.mean(np.abs(prev - curr)) > threshold:
            boundaries.add(i)

    n_scenes = len(boundaries)
    print(f"[cutout] Found {n_scenes} scene(s) / {n_scenes - 1} cut(s).",
          flush=True)
    return boundaries


def _scene_range(idx: int, sorted_boundaries: list, n: int):
    """Return (scene_start, scene_end) for frame index idx."""
    start = 0
    for b in sorted_boundaries:
        if b <= idx:
            start = b
    end = n
    for b in sorted_boundaries:
        if b > idx:
            end = b
            break
    return start, end


def _apply_temporal_smoothing(raw_masks_dir: str, masks_dir: str,
                               frames: list, scene_boundaries: set) -> None:
    """
    Blend each tight raw mask with its immediate neighbours using weights
    [prev=0.15, current=0.70, next=0.15].

    Blending is skipped across scene boundaries: if a neighbour belongs to a
    different scene, its weight is redistributed to the current frame so the
    total always sums to 1.0.

    Writes smoothed masks directly to masks_dir (uint8 PNG).
    """
    from PIL import Image
    import numpy as np

    n = len(frames)
    sorted_boundaries = sorted(scene_boundaries)
    weights = {-1: 0.15, 0: 0.70, 1: 0.15}

    for i, frame_file in enumerate(frames):
        mask_name = frame_file.replace(".jpg", ".png")
        s_start, s_end = _scene_range(i, sorted_boundaries, n)

        blended_sum = None
        total_w = 0.0

        for offset, w in weights.items():
            j = i + offset
            # Skip frames outside the current scene or video
            if j < s_start or j >= s_end or j < 0 or j >= n:
                continue
            neighbor_mask = frames[j].replace(".jpg", ".png")
            arr = np.array(
                Image.open(os.path.join(raw_masks_dir, neighbor_mask)),
                dtype=float,
            )
            blended_sum = arr * w if blended_sum is None else blended_sum + arr * w
            total_w += w

        if blended_sum is None or total_w == 0:
            # Fallback: copy raw mask unchanged
            shutil.copy(
                os.path.join(raw_masks_dir, mask_name),
                os.path.join(masks_dir, mask_name),
            )
            continue

        # Renormalize in case some neighbours were skipped (scene boundaries)
        final = np.clip(blended_sum / total_w, 0, 255).astype(np.uint8)
        Image.fromarray(final).save(os.path.join(masks_dir, mask_name))


def process_cutout(input_path: str, output_path: str,
                   mode: str = 'removeBg') -> None:
    try:
        from rembg import remove, new_session
        from PIL import Image, ImageOps
        import numpy as np
    except ImportError:
        print(
            "ERROR: rembg not installed.\n"
            "Run: pip3 install rembg onnxruntime pillow numpy",
            file=sys.stderr,
        )
        sys.exit(1)

    invert_mask = (mode == 'removePerson')
    print(f"[cutout] Input: {input_path}", flush=True)
    print(f"[cutout] Output: {output_path}", flush=True)
    print(f"[cutout] Mode: {mode} (invert={invert_mask})", flush=True)

    if not os.path.exists(input_path):
        print(f"ERROR: Input file not found: {input_path}", flush=True)
        sys.exit(1)

    with tempfile.TemporaryDirectory() as tmpdir:
        frames_dir   = os.path.join(tmpdir, "frames")
        raw_masks_dir = os.path.join(tmpdir, "raw_masks")  # tight, per-frame
        masks_dir    = os.path.join(tmpdir, "masks")       # temporally smoothed
        os.makedirs(frames_dir)
        os.makedirs(raw_masks_dir)
        os.makedirs(masks_dir)

        # Extract frames from proxy video.
        # Use scale=540:540:force_original_aspect_ratio=decrease to cap the longer
        # dimension at 540px and NEVER upscale.  The proxy is already created with
        # height=540, so landscape proxies (960x540) are downscaled to 540x304 while
        # portrait proxies (304x540) stay at 304x540 instead of being upscaled to
        # 540x960 (which would make rembg ~3x slower for no reason).
        #
        # force_divisible_by=2 ensures output dimensions are always even, which is
        # required for yuv420p encoding in the assembly step.
        print("[cutout] Extracting frames...", flush=True)
        _run_ffmpeg(
            [
                "ffmpeg", "-y",
                "-i", input_path,
                "-vf", "scale=540:540:force_original_aspect_ratio=decrease:force_divisible_by=2",
                "-q:v", "3",
                os.path.join(frames_dir, "frame_%06d.jpg"),
            ],
            "Frame extraction",
        )

        frames = sorted(f for f in os.listdir(frames_dir) if f.endswith(".jpg"))
        total = len(frames)
        if total == 0:
            print("ERROR: No frames extracted from input video.", flush=True)
            sys.exit(1)
        print(f"[cutout] Processing {total} frames...", flush=True)

        # Load human segmentation model
        print("[cutout] Loading segmentation model...", flush=True)
        try:
            session = new_session("u2net_human_seg")
        except Exception as e:
            print(f"ERROR: Failed to load segmentation model: {e}", flush=True)
            sys.exit(1)
        print("[cutout] Model loaded, starting frame processing...", flush=True)

        # --- Pass 1: segment + tighten each frame independently ---
        # Raw masks: tight mask per frame (tightened, optionally inverted).
        # Stored in raw_masks_dir; temporal smoothing happens in pass 2.
        for i, frame_file in enumerate(frames):
            frame_path = os.path.join(frames_dir, frame_file)
            mask_path  = os.path.join(raw_masks_dir,
                                      frame_file.replace(".jpg", ".png"))

            try:
                img = Image.open(frame_path).convert("RGBA")
                output_img = remove(img, session=session, only_mask=True)
            except Exception as e:
                print(f"ERROR: Frame {i+1}/{total} processing failed: {e}",
                      flush=True)
                sys.exit(1)

            # Extract alpha channel (raw confidence / mask)
            if output_img.mode == "L":
                raw_alpha = np.array(output_img)
            else:
                raw_alpha = np.array(output_img.split()[-1])

            # Tighten mask: threshold → erode → Gaussian blur
            tight = _tighten_mask(raw_alpha)

            # Invert for removePerson mode (background=white)
            if invert_mask:
                tight = 255 - tight

            Image.fromarray(tight).save(mask_path)

            pct = int((i + 1) / total * 100)
            print(f"[cutout] {pct}% ({i+1}/{total})", flush=True)

        # --- Scene change detection (used to limit temporal blending) ---
        scene_boundaries = _detect_scene_changes(frames_dir, frames)

        # --- Pass 2: temporal smoothing across neighbouring frames ---
        if total > 1:
            print("[cutout] Applying temporal smoothing...", flush=True)
            _apply_temporal_smoothing(
                raw_masks_dir, masks_dir, frames, scene_boundaries
            )
        else:
            # Single frame: just copy without smoothing
            mask_name = frames[0].replace(".jpg", ".png")
            shutil.copy(
                os.path.join(raw_masks_dir, mask_name),
                os.path.join(masks_dir, mask_name),
            )

        # --- Assemble mask frames into output video ---
        print("[cutout] Assembling mask video...", flush=True)

        # Get FPS from input
        result = subprocess.run(
            [
                "ffprobe", "-v", "error",
                "-select_streams", "v:0",
                "-show_entries", "stream=r_frame_rate",
                "-of", "default=noprint_wrappers=1:nokey=1",
                input_path,
            ],
            capture_output=True,
            text=True,
        )
        fps_str = result.stdout.strip()
        try:
            num, den = fps_str.split("/")
            fps = float(num) / float(den)
        except Exception:
            fps = 30.0

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        # scale=trunc(iw/2)*2:trunc(ih/2)*2 ensures the PNG frames (which may have
        # odd dimensions despite force_divisible_by=2 in extraction, e.g. if Pillow
        # saves at a slightly different size) are rounded down to even before encoding
        # with yuv420p, which strictly requires even width and height.
        _run_ffmpeg(
            [
                "ffmpeg", "-y",
                "-framerate", str(fps),
                "-i", os.path.join(masks_dir, "frame_%06d.png"),
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-pix_fmt", "yuv420p",
                output_path,
            ],
            "Mask video assembly",
        )

    print(f"[cutout] Done: {output_path}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 3 or len(sys.argv) > 4:
        print(f"Usage: {sys.argv[0]} <input_video> <output_mask_mp4> [removeBg|removePerson]",
              file=sys.stderr)
        sys.exit(1)

    mode_arg = sys.argv[3] if len(sys.argv) == 4 else 'removeBg'
    if mode_arg not in ('removeBg', 'removePerson'):
        print(f"ERROR: Unknown mode '{mode_arg}'. Use 'removeBg' or 'removePerson'.",
              file=sys.stderr)
        sys.exit(1)

    process_cutout(sys.argv[1], sys.argv[2], mode_arg)
