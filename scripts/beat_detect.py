#!/usr/bin/env python3
"""
Beat detection using librosa.
Usage: python3 beat_detect.py <audio_wav_path> <output_json_path>
"""

import sys
import json
import os


def detect_beats(audio_path: str, output_path: str) -> None:
    try:
        import librosa
        import numpy as np
    except ImportError:
        print("ERROR: librosa not installed. Run: pip3 install librosa soundfile", file=sys.stderr)
        sys.exit(1)

    print(f"[beat_detect] Loading audio: {audio_path}")
    y, sr = librosa.load(audio_path, sr=None, mono=True)
    print(f"[beat_detect] Audio loaded: {len(y)/sr:.2f}s @ {sr}Hz")

    # Detect tempo and beats
    print("[beat_detect] Detecting beats...")
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)

    # Convert frame indices to time
    beat_times = librosa.frames_to_time(beats, sr=sr).tolist()

    # Also get onset strength for more accurate beat positions
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)

    # Refine beat positions using onset strength
    beat_times_refined = librosa.frames_to_time(
        librosa.util.fix_frames(beats, x_min=0, x_max=len(onset_env) - 1),
        sr=sr
    ).tolist()

    result = {
        "tempo": float(tempo) if hasattr(tempo, '__float__') else float(tempo[0]),
        "beats": beat_times_refined,
        "beat_count": len(beat_times_refined),
        "duration": float(len(y) / sr),
    }

    print(f"[beat_detect] Found {len(beat_times_refined)} beats at {result['tempo']:.1f} BPM")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    print(f"[beat_detect] Saved to: {output_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <audio_wav> <output_json>", file=sys.stderr)
        sys.exit(1)

    detect_beats(sys.argv[1], sys.argv[2])
