#!/usr/bin/env python3
"""
Person cutout using rembg (background removal).
Usage: python3 cutout.py <input_video_path> <output_mask_path>

Generates a mask video where white = person, black = background.
Uses rembg with u2net_human_seg model for person segmentation.
"""

import sys
import os
import subprocess
import tempfile


def process_cutout(input_path: str, output_path: str) -> None:
    try:
        import rembg
        from rembg import remove, new_session
        from PIL import Image
        import numpy as np
    except ImportError:
        print(
            "ERROR: rembg not installed.\n"
            "Run: pip3 install rembg onnxruntime pillow numpy",
            file=sys.stderr,
        )
        sys.exit(1)

    print(f"[cutout] Input: {input_path}")
    print(f"[cutout] Output: {output_path}")

    # Create temp dirs
    with tempfile.TemporaryDirectory() as tmpdir:
        frames_dir = os.path.join(tmpdir, "frames")
        masks_dir = os.path.join(tmpdir, "masks")
        os.makedirs(frames_dir)
        os.makedirs(masks_dir)

        # Extract frames from proxy video (low-res for speed)
        print("[cutout] Extracting frames...")
        subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", input_path,
                "-vf", "scale=540:-2",
                "-q:v", "3",
                os.path.join(frames_dir, "frame_%06d.jpg"),
            ],
            check=True,
            capture_output=True,
        )

        frames = sorted(f for f in os.listdir(frames_dir) if f.endswith(".jpg"))
        total = len(frames)
        print(f"[cutout] Processing {total} frames...")

        # Load human segmentation model
        session = new_session("u2net_human_seg")

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

            mask.save(mask_path)

            if (i + 1) % 10 == 0 or i == total - 1:
                pct = int((i + 1) / total * 100)
                print(f"[cutout] {pct}% ({i+1}/{total})")

        # Reassemble mask frames into video
        print("[cutout] Assembling mask video...")

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

    print(f"[cutout] Done: {output_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input_video> <output_mask_mp4>", file=sys.stderr)
        sys.exit(1)

    process_cutout(sys.argv[1], sys.argv[2])
