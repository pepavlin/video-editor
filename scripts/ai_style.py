#!/usr/bin/env python3
"""
AI Style — Painterly video stylization with EbSynth-like temporal consistency.

Usage:
    python3 ai_style.py <input_video> <output_video> [style_strength] [brush_size] [color_vibrance]

Parameters:
    input_video     Path to the proxy video (MP4)
    output_video    Path for the stylized output (MP4)
    style_strength  0.0–1.0  Blend weight between original and stylized (default 0.8)
    brush_size      0.0–1.0  Controls brush stroke coarseness (default 0.5)
    color_vibrance  0.0–2.0  Color vibrancy of painterly output (default 1.3)

Pipeline:
    1. Extract frames from input video
    2. Select keyframes at regular intervals (every N frames)
    3. Stylize keyframes with painterly pipeline:
       - Edge-preserving smoothing (bilateral filter cascade)
       - OpenCV stylization for painterly brush effect
       - Color enhancement and warm tone shift
       - Soft-edge overlay for hand-painted texture feel
    4. Propagate style from keyframes to intermediate frames using optical flow:
       - Compute dense optical flow (DIS algorithm, fast and accurate)
       - Warp previous stylized frame to current using flow
       - Blend warped result with current frame's independent stylization
       - Weighted by flow confidence (occlusion-aware)
    5. Assemble stylized frames into output video

Dependencies (all already in Docker):
    - opencv-python-headless (cv2)
    - numpy
    - pillow (PIL)
"""

import sys
import os
import subprocess
import tempfile
import math

import numpy as np
import cv2


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


def stylize_frame(frame: np.ndarray, brush_size: float,
                  color_vibrance: float) -> np.ndarray:
    """
    Apply painterly stylization to a single frame.

    Produces a hand-painted / non-photorealistic look by combining:
    1. Bilateral filter cascade for smooth color regions with preserved edges
    2. OpenCV stylization for soft brush stroke texture
    3. Color vibrance boost in HSV space
    4. Subtle edge darkening for a painted contour feel
    """
    h, w = frame.shape[:2]

    # --- 1. Bilateral filter cascade: smooth colors while preserving edges ---
    # brush_size controls the filter diameter: larger = more flattened colors
    diameter = max(5, int(5 + brush_size * 15))  # 5–20
    sigma_color = 40 + brush_size * 80            # 40–120
    sigma_space = 40 + brush_size * 80            # 40–120

    smoothed = frame.copy()
    # Two passes of bilateral filter for stronger flattening
    smoothed = cv2.bilateralFilter(smoothed, diameter, sigma_color, sigma_space)
    smoothed = cv2.bilateralFilter(smoothed, diameter, sigma_color, sigma_space)

    # --- 2. OpenCV stylization for painterly brush texture ---
    sigma_s_val = 30 + brush_size * 50   # 30–80: spatial sigma
    sigma_r_val = 0.3 + brush_size * 0.3  # 0.3–0.6: range sigma
    try:
        stylized = cv2.stylization(smoothed, sigma_s=sigma_s_val,
                                   sigma_r=sigma_r_val)
    except cv2.error:
        # Fallback if stylization not available (very old OpenCV)
        stylized = smoothed

    # --- 3. Color vibrance boost in HSV ---
    hsv = cv2.cvtColor(stylized, cv2.COLOR_BGR2HSV).astype(np.float32)
    hsv[:, :, 1] = np.clip(hsv[:, :, 1] * color_vibrance, 0, 255)
    # Slight brightness boost for painterly warmth
    hsv[:, :, 2] = np.clip(hsv[:, :, 2] * (0.95 + color_vibrance * 0.05), 0, 255)
    stylized = cv2.cvtColor(hsv.astype(np.uint8), cv2.COLOR_HSV2BGR)

    # --- 4. Subtle edge darkening for painted contour feel ---
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(gray, 60, 120)
    # Dilate edges slightly for a broader brush-stroke contour
    kernel = np.ones((2, 2), np.uint8)
    edges = cv2.dilate(edges, kernel, iterations=1)
    # Blur edges for soft transition
    edges_blur = cv2.GaussianBlur(edges, (5, 5), 2.0)
    # Create darkening mask: edges = dark, non-edges = 1.0
    edge_mask = 1.0 - (edges_blur.astype(np.float32) / 255.0) * 0.3
    result = (stylized.astype(np.float32) * edge_mask[:, :, np.newaxis])
    result = np.clip(result, 0, 255).astype(np.uint8)

    return result


def compute_optical_flow(prev_gray: np.ndarray,
                         curr_gray: np.ndarray) -> np.ndarray:
    """
    Compute dense optical flow using DIS algorithm.
    DIS is faster than Farneback while maintaining good accuracy.
    Returns a 2-channel flow map (dx, dy).
    """
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    flow = dis.calc(prev_gray, curr_gray, None)
    return flow


def warp_frame(frame: np.ndarray, flow: np.ndarray) -> np.ndarray:
    """Warp a frame according to the given optical flow field."""
    h, w = flow.shape[:2]
    # Create coordinate grid
    x_coords, y_coords = np.meshgrid(np.arange(w), np.arange(h))
    map_x = (x_coords + flow[:, :, 0]).astype(np.float32)
    map_y = (y_coords + flow[:, :, 1]).astype(np.float32)
    warped = cv2.remap(frame, map_x, map_y, cv2.INTER_LINEAR,
                       borderMode=cv2.BORDER_REFLECT_101)
    return warped


def compute_flow_confidence(flow: np.ndarray) -> np.ndarray:
    """
    Estimate confidence of optical flow.
    Large magnitude changes and boundary regions get lower confidence.
    Returns a single-channel map in [0, 1].
    """
    magnitude = np.sqrt(flow[:, :, 0] ** 2 + flow[:, :, 1] ** 2)
    # Normalize: smaller motion = higher confidence
    # Use sigmoid-like mapping: confidence drops for large motion
    confidence = np.exp(-magnitude / 20.0)
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
        # Resize for fast comparison
        prev_small = cv2.resize(prev, (160, 90))
        curr_small = cv2.resize(curr, (160, 90))
        mad = np.mean(np.abs(prev_small.astype(float) - curr_small.astype(float)))
        if mad > threshold:
            boundaries.add(i)
    return boundaries


def process_ai_style(input_path: str, output_path: str,
                     style_strength: float = 0.8,
                     brush_size: float = 0.5,
                     color_vibrance: float = 1.3) -> None:
    """Main AI style processing pipeline."""
    print(f"[ai_style] Input: {input_path}", flush=True)
    print(f"[ai_style] Output: {output_path}", flush=True)
    print(f"[ai_style] Params: strength={style_strength}, "
          f"brush={brush_size}, vibrance={color_vibrance}", flush=True)

    if not os.path.exists(input_path):
        print(f"ERROR: Input file not found: {input_path}", flush=True)
        sys.exit(1)

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
        # Keyframes every ~1 second, minimum every 5 frames, max every 30
        keyframe_interval = max(5, min(30, int(fps)))
        print(f"[ai_style] Keyframe interval: every {keyframe_interval} frames",
              flush=True)

        # Build keyframe set: scene starts + regular intervals within scenes
        keyframe_indices = set()
        for b in sorted_boundaries:
            keyframe_indices.add(b)
        for i in range(0, total, keyframe_interval):
            keyframe_indices.add(i)
        # Always include last frame
        keyframe_indices.add(total - 1)

        # --- Pass 1: Stylize all keyframes ---
        print("[ai_style] Stylizing keyframes...", flush=True)
        keyframe_styled = {}
        for idx in sorted(keyframe_indices):
            frame_path = os.path.join(frames_dir, frames[idx])
            frame = cv2.imread(frame_path)
            if frame is None:
                continue
            styled = stylize_frame(frame, brush_size, color_vibrance)
            # Blend with original based on style_strength
            blended = cv2.addWeighted(styled, style_strength, frame,
                                      1.0 - style_strength, 0)
            keyframe_styled[idx] = blended

        print(f"[ai_style] Stylized {len(keyframe_styled)} keyframes.",
              flush=True)

        # --- Pass 2: Propagate style using optical flow ---
        print("[ai_style] Propagating style with optical flow...", flush=True)

        # Helper to find scene range for a given frame index
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

        # Process frame by frame in order, propagating from nearest keyframe
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
                # This is a keyframe — use the pre-computed stylization
                result = keyframe_styled[i]
            elif prev_styled is not None and prev_gray is not None and i > s_start:
                # Propagate from previous frame using optical flow
                flow = compute_optical_flow(prev_gray, curr_gray)
                warped = warp_frame(prev_styled, flow)
                confidence = compute_flow_confidence(flow)

                # Also compute independent stylization for this frame
                independent = stylize_frame(frame, brush_size, color_vibrance)
                independent = cv2.addWeighted(independent, style_strength,
                                              frame, 1.0 - style_strength, 0)

                # Blend: high confidence → use warped (temporal consistency)
                #         low confidence  → use independent (handle occlusions)
                conf_3ch = confidence[:, :, np.newaxis]
                # Temporal blend weight: prefer warped for consistency
                temporal_weight = 0.75
                blend_weight = conf_3ch * temporal_weight
                result = (warped.astype(np.float32) * blend_weight +
                          independent.astype(np.float32) * (1.0 - blend_weight))
                result = np.clip(result, 0, 255).astype(np.uint8)
            else:
                # First frame of a new scene or no previous context
                styled = stylize_frame(frame, brush_size, color_vibrance)
                result = cv2.addWeighted(styled, style_strength, frame,
                                         1.0 - style_strength, 0)

            # Save styled frame
            out_name = frames[i].replace(".jpg", ".png")
            cv2.imwrite(os.path.join(styled_dir, out_name), result)

            prev_gray = curr_gray
            prev_styled = result

            pct = int((i + 1) / total * 100)
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
    if len(sys.argv) < 3 or len(sys.argv) > 6:
        print(
            f"Usage: {sys.argv[0]} <input_video> <output_mp4> "
            f"[style_strength] [brush_size] [color_vibrance]",
            file=sys.stderr,
        )
        sys.exit(1)

    input_path = sys.argv[1]
    output_path = sys.argv[2]
    strength = float(sys.argv[3]) if len(sys.argv) > 3 else 0.8
    brush = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5
    vibrance = float(sys.argv[5]) if len(sys.argv) > 5 else 1.3

    # Clamp parameters
    strength = max(0.0, min(1.0, strength))
    brush = max(0.0, min(1.0, brush))
    vibrance = max(0.0, min(2.0, vibrance))

    process_ai_style(input_path, output_path, strength, brush, vibrance)
