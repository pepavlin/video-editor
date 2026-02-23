#!/usr/bin/env python3
"""
Head stabilization using face detection.

Detects head position per frame using OpenCV's Haar cascade face detector
and applies smoothed crop transforms to stabilize the video.

Usage:
  python3 head_stabilize.py <input_video> <output_video> <smooth_x> <smooth_y> <smooth_z>

Arguments:
  input_video   Path to the proxy video (540p)
  output_video  Path for the stabilized output video
  smooth_x      0-1  Stabilization strength on X axis  (0=off, 1=fully stabilized)
  smooth_y      0-1  Stabilization strength on Y axis
  smooth_z      0-1  Stabilization strength on Z (zoom: keep consistent face size)
"""

import sys
import os
import subprocess
import tempfile
import math


def detect_face(gray, face_cascade):
    """Return (cx, cy, size) of the largest detected face, or None."""
    faces = face_cascade.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=4,
        minSize=(30, 30),
    )
    if len(faces) == 0:
        return None
    # Use largest face by area
    fx, fy, fw, fh = max(faces, key=lambda f: f[2] * f[3])
    return (fx + fw / 2.0, fy + fh / 2.0, max(fw, fh))


def process_stabilize(input_path: str, output_path: str,
                      smooth_x: float, smooth_y: float, smooth_z: float) -> None:
    try:
        import cv2
        import numpy as np
    except ImportError:
        print(
            "ERROR: opencv-python not installed.\n"
            "Run: pip3 install opencv-python",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"[head_stabilize] Input:  {input_path}")
    print(f"[head_stabilize] Output: {output_path}")
    print(f"[head_stabilize] Smoothing X={smooth_x:.2f}  Y={smooth_y:.2f}  Z={smooth_z:.2f}")

    # Load Haar cascade (bundled with OpenCV)
    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    face_cascade = cv2.CascadeClassifier(cascade_path)

    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        print(f"ERROR: cannot open {input_path}", file=sys.stderr)
        sys.exit(1)

    frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    print(f"[head_stabilize] Video: {frame_w}x{frame_h} @ {fps:.2f} fps  ({total_frames} frames)")

    # Initial crop: centered, full frame
    cx = frame_w / 2.0        # crop center X
    cy = frame_h / 2.0        # crop center Y
    crop_w = float(frame_w)   # crop window width
    crop_h = float(frame_h)   # crop window height

    canvas_cx = frame_w / 2.0
    canvas_cy = frame_h / 2.0
    aspect = frame_h / frame_w

    # Internal EMA alpha for frame-to-frame noise reduction
    # 0.2 → ~5-frame time constant at 30fps (≈ 0.17 s), smooth but responsive
    INTERNAL_ALPHA = 0.2

    # Target face fraction of frame width when zoom stabilization is active.
    # If face_w / frame_w ≈ TARGET_FACE_FRACTION, crop_w ≈ frame_w (no zoom).
    TARGET_FACE_FRACTION = 0.25

    with tempfile.TemporaryDirectory() as tmpdir:
        frames_dir = os.path.join(tmpdir, "frames")
        out_dir = os.path.join(tmpdir, "out")
        os.makedirs(frames_dir)
        os.makedirs(out_dir)

        frame_idx = 0
        prev_face_cx = canvas_cx
        prev_face_cy = canvas_cy
        prev_face_size = frame_w * TARGET_FACE_FRACTION  # default face size guess

        while True:
            ret, frame = cap.read()
            if not ret:
                break

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            detection = detect_face(gray, face_cascade)

            if detection is not None:
                face_cx, face_cy, face_size = detection
                # EMA smoothing of detected face position
                prev_face_cx = INTERNAL_ALPHA * face_cx + (1 - INTERNAL_ALPHA) * prev_face_cx
                prev_face_cy = INTERNAL_ALPHA * face_cy + (1 - INTERNAL_ALPHA) * prev_face_cy
                prev_face_size = INTERNAL_ALPHA * face_size + (1 - INTERNAL_ALPHA) * prev_face_size

            # --- X axis ---
            # Blend between "no tracking" (canvas center) and "full tracking" (face center)
            target_cx = canvas_cx + smooth_x * (prev_face_cx - canvas_cx)

            # --- Y axis ---
            target_cy = canvas_cy + smooth_y * (prev_face_cy - canvas_cy)

            # --- Z axis (zoom to keep face size consistent) ---
            # Target crop window so that face takes up TARGET_FACE_FRACTION of output width
            target_crop_w = prev_face_size / TARGET_FACE_FRACTION
            # Clamp: don't zoom past 1.5× the face size; don't exceed full frame
            target_crop_w = max(prev_face_size * 1.5, min(target_crop_w, frame_w))
            # Blend between "full frame" and "face-sized crop"
            new_crop_w = frame_w + smooth_z * (target_crop_w - frame_w)

            cx = target_cx
            cy = target_cy
            crop_w = new_crop_w
            crop_h = crop_w * aspect

            # Clamp crop window to frame bounds
            crop_w_i = int(round(crop_w))
            crop_h_i = int(round(crop_h))
            crop_w_i = min(crop_w_i, frame_w)
            crop_h_i = min(crop_h_i, frame_h)
            # Ensure even dimensions for libx264
            crop_w_i = crop_w_i - (crop_w_i % 2)
            crop_h_i = crop_h_i - (crop_h_i % 2)
            if crop_w_i < 2:
                crop_w_i = 2
            if crop_h_i < 2:
                crop_h_i = 2

            x1 = int(round(cx - crop_w_i / 2))
            y1 = int(round(cy - crop_h_i / 2))
            x1 = max(0, min(x1, frame_w - crop_w_i))
            y1 = max(0, min(y1, frame_h - crop_h_i))

            cropped = frame[y1:y1 + crop_h_i, x1:x1 + crop_w_i]
            resized = cv2.resize(cropped, (frame_w, frame_h), interpolation=cv2.INTER_LINEAR)

            out_path = os.path.join(out_dir, f"frame_{frame_idx:06d}.jpg")
            cv2.imwrite(out_path, resized, [cv2.IMWRITE_JPEG_QUALITY, 92])

            frame_idx += 1
            if frame_idx % 30 == 0 or frame_idx == total_frames:
                pct = int(frame_idx / max(total_frames, 1) * 100)
                print(f"[head_stabilize] {pct}% ({frame_idx}/{total_frames})")

        cap.release()

        print(f"[head_stabilize] Processed {frame_idx} frames. Assembling output video...")

        os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-framerate", str(fps),
                "-i", os.path.join(out_dir, "frame_%06d.jpg"),
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                output_path,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(result.stdout, file=sys.stderr)
            print(result.stderr, file=sys.stderr)
            print(f"ERROR: ffmpeg exited with code {result.returncode}", file=sys.stderr)
            sys.exit(result.returncode)

    print(f"[head_stabilize] Done: {output_path}")


if __name__ == "__main__":
    if len(sys.argv) != 6:
        print(
            f"Usage: {sys.argv[0]} <input_video> <output_video> "
            "<smooth_x> <smooth_y> <smooth_z>",
            file=sys.stderr,
        )
        sys.exit(1)

    in_path = sys.argv[1]
    out_path = sys.argv[2]
    sx = float(sys.argv[3])
    sy = float(sys.argv[4])
    sz = float(sys.argv[5])

    # Clamp to [0, 1]
    sx = max(0.0, min(1.0, sx))
    sy = max(0.0, min(1.0, sy))
    sz = max(0.0, min(1.0, sz))

    process_stabilize(in_path, out_path, sx, sy, sz)
