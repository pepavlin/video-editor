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
"""

import sys
import os
import subprocess
import tempfile


def process_cutout(input_path: str, output_path: str, mode: str = 'removeBg') -> None:
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

    # Create temp dirs
    with tempfile.TemporaryDirectory() as tmpdir:
        frames_dir = os.path.join(tmpdir, "frames")
        masks_dir = os.path.join(tmpdir, "masks")
        os.makedirs(frames_dir)
        os.makedirs(masks_dir)

        # Extract frames from proxy video.
        # Use scale=540:540:force_original_aspect_ratio=decrease to cap the longer
        # dimension at 540px and NEVER upscale.  The proxy is already created with
        # height=540, so landscape proxies (960x540) are downscaled to 540x304 while
        # portrait proxies (304x540) stay at 304x540 instead of being upscaled to
        # 540x960 (which would make rembg ~3x slower for no reason).
        print("[cutout] Extracting frames...", flush=True)
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", input_path,
                "-vf", "scale=540:540:force_original_aspect_ratio=decrease",
                "-q:v", "3",
                os.path.join(frames_dir, "frame_%06d.jpg"),
            ],
            check=True,
            capture_output=True,
        )

        frames = sorted(f for f in os.listdir(frames_dir) if f.endswith(".jpg"))
        total = len(frames)
        print(f"[cutout] Processing {total} frames...", flush=True)

        # Load human segmentation model
        print("[cutout] Loading segmentation model...", flush=True)
        session = new_session("u2net_human_seg")
        print("[cutout] Model loaded, starting frame processing...", flush=True)

        # Report every single frame so the log line always advances and users
        # can see that processing is making progress even when the integer
        # percentage stays flat for a long time on longer clips.
        report_every = 1

        for i, frame_file in enumerate(frames):
            frame_path = os.path.join(frames_dir, frame_file)
            mask_path = os.path.join(masks_dir, frame_file.replace(".jpg", ".png"))

            img = Image.open(frame_path).convert("RGBA")
            output_img = remove(img, session=session, only_mask=True)

            # Convert to grayscale mask (white = person)
            if output_img.mode == "L":
                mask = output_img
            else:
                mask = output_img.split()[-1]  # Alpha channel

            # Invert mask when mode is 'removePerson' (keep background)
            if invert_mask:
                mask = ImageOps.invert(mask)

            mask.save(mask_path)

            if (i + 1) % report_every == 0 or i == total - 1:
                pct = int((i + 1) / total * 100)
                print(f"[cutout] {pct}% ({i+1}/{total})", flush=True)

        # Reassemble mask frames into video
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

        subprocess.run(
            [
                "ffmpeg", "-y",
                "-framerate", str(fps),
                "-i", os.path.join(masks_dir, "frame_%06d.png"),
                "-c:v", "libx264",
                "-preset", "veryfast",
                "-pix_fmt", "yuv420p",
                output_path,
            ],
            check=True,
            capture_output=True,
        )

    print(f"[cutout] Done: {output_path}", flush=True)


if __name__ == "__main__":
    if len(sys.argv) < 3 or len(sys.argv) > 4:
        print(f"Usage: {sys.argv[0]} <input_video> <output_mask_mp4> [removeBg|removePerson]", file=sys.stderr)
        sys.exit(1)

    mode_arg = sys.argv[3] if len(sys.argv) == 4 else 'removeBg'
    if mode_arg not in ('removeBg', 'removePerson'):
        print(f"ERROR: Unknown mode '{mode_arg}'. Use 'removeBg' or 'removePerson'.", file=sys.stderr)
        sys.exit(1)

    process_cutout(sys.argv[1], sys.argv[2], mode_arg)
