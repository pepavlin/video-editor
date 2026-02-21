#!/usr/bin/env python3
"""
Audio sync: find where clip audio best aligns within master audio using FFT cross-correlation.

Usage:
    python3 sync_audio.py <clip_wav> <master_wav> <output_json>

Output JSON:
    {
        "offset": float,       # seconds from start of master audio where clip best matches
        "confidence": float    # 0..1 normalized correlation strength
    }
"""

import sys
import json
import subprocess
import os


def load_mono_audio(path: str, sample_rate: int = 8000):
    """Load audio as mono float32 array via ffmpeg, resampled to sample_rate Hz."""
    import numpy as np

    cmd = [
        'ffmpeg', '-y',
        '-i', path,
        '-ar', str(sample_rate),
        '-ac', '1',
        '-f', 'f32le',
        '-',
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        stderr = result.stderr.decode(errors='replace')
        raise RuntimeError(f"ffmpeg failed to load {path}: {stderr[-500:]}")
    if not result.stdout:
        raise RuntimeError(f"ffmpeg produced no audio output for {path}")
    return np.frombuffer(result.stdout, dtype=np.float32).copy()


def normalize(x):
    """Zero-mean and unit-variance normalize."""
    import numpy as np
    x = x - x.mean()
    std = x.std()
    if std < 1e-8:
        return x
    return x / std


def find_offset(clip_audio, master_audio, sample_rate: int):
    """
    Find the sample offset in master where clip audio best matches using FFT cross-correlation.
    Returns (offset_seconds, confidence).
    """
    import numpy as np

    clip_norm = normalize(clip_audio)
    master_norm = normalize(master_audio)

    if clip_norm.std() < 1e-8:
        print("[sync_audio] Clip audio is silent/flat — cannot determine offset", file=sys.stderr)
        return 0.0, 0.0

    # FFT-based cross-correlation (master ⋆ clip)
    # corr[k] ≈ how well clip matches master starting at sample k
    n = len(clip_norm) + len(master_norm) - 1
    n_fft = 1
    while n_fft < n:
        n_fft <<= 1

    master_fft = np.fft.rfft(master_norm, n=n_fft)
    clip_fft = np.fft.rfft(clip_norm, n=n_fft)
    corr = np.fft.irfft(master_fft * np.conj(clip_fft), n=n_fft)

    # Valid range: lags 0 .. len(master) - len(clip) (clip fully inside master)
    valid_len = max(1, len(master_norm) - len(clip_norm) + 1)
    valid_corr = corr[:valid_len]

    best_idx = int(np.argmax(valid_corr))
    best_corr = float(valid_corr[best_idx])

    # Normalize confidence: divide by clip length (max possible correlation)
    confidence = best_corr / max(1.0, float(len(clip_norm)))
    confidence = float(np.clip(confidence, 0.0, 1.0))

    offset_seconds = best_idx / sample_rate
    return offset_seconds, confidence


def sync_audio(clip_path: str, master_path: str) -> dict:
    import numpy as np

    SAMPLE_RATE = 8000  # 8 kHz — fast FFT while retaining enough temporal resolution

    print(f"[sync_audio] Loading clip:   {clip_path}", file=sys.stderr)
    clip = load_mono_audio(clip_path, SAMPLE_RATE)

    print(f"[sync_audio] Loading master: {master_path}", file=sys.stderr)
    master = load_mono_audio(master_path, SAMPLE_RATE)

    print(
        f"[sync_audio] Clip: {len(clip)/SAMPLE_RATE:.2f}s  Master: {len(master)/SAMPLE_RATE:.2f}s",
        file=sys.stderr,
    )

    if len(clip) == 0 or len(master) == 0:
        return {"offset": 0.0, "confidence": 0.0}

    # Use at most the first 30 s of the clip for correlation (faster + usually sufficient)
    clip_search = clip[:min(len(clip), 30 * SAMPLE_RATE)]

    offset, confidence = find_offset(clip_search, master, SAMPLE_RATE)

    print(
        f"[sync_audio] Best offset: {offset:.3f}s  confidence: {confidence:.4f}",
        file=sys.stderr,
    )
    return {"offset": offset, "confidence": confidence}


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(f"Usage: {sys.argv[0]} <clip_wav> <master_wav> <output_json>", file=sys.stderr)
        sys.exit(1)

    try:
        import numpy as np  # noqa: F401
    except ImportError:
        print("ERROR: numpy is required. Run: pip3 install numpy", file=sys.stderr)
        sys.exit(1)

    clip_path = sys.argv[1]
    master_path = sys.argv[2]
    output_path = sys.argv[3]

    result = sync_audio(clip_path, master_path)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w") as f:
        json.dump(result, f, indent=2)

    print(json.dumps(result))
