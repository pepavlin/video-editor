#!/usr/bin/env python3
"""
Download AnimeGANv2 ONNX models for the AI Style effect.

Usage:
    python3 download_ai_models.py              # Download all models
    python3 download_ai_models.py hayao         # Download a specific model
    python3 download_ai_models.py --status      # Check which models are available
    python3 download_ai_models.py --list        # List available presets

Models are stored in:
    $WORKSPACE_DIR/models/style_transfer/  (if WORKSPACE_DIR is set)
    ~/.cache/video-editor/models/style_transfer/  (otherwise)

Environment variables:
    AI_STYLE_MODEL_BASE_URL  Override the model download base URL
    HF_TOKEN                 HuggingFace access token for authenticated downloads
                             (get one at https://huggingface.co/settings/tokens)
"""

import sys
import os
import json

# Add scripts dir to path so we can import ai_style
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from ai_style import (
    STYLE_MODELS,
    download_model,
    get_model_status,
    _get_models_dir,
)


def print_status() -> None:
    """Print the download status of all models."""
    status = get_model_status()
    models_dir = _get_models_dir()
    print(f"Models directory: {models_dir}")
    print()
    for preset, info in status.items():
        desc = STYLE_MODELS[preset]['description']
        if info['available']:
            size_mb = info['size'] / (1024 * 1024)
            print(f"  [{'+'}] {preset:10s}  ({size_mb:.1f} MiB)  {desc}")
        else:
            print(f"  [ ] {preset:10s}  (not downloaded)  {desc}")
    print()


def print_status_json() -> None:
    """Print model status as JSON (for API consumption)."""
    status = get_model_status()
    print(json.dumps(status))


def main() -> int:
    args = sys.argv[1:]

    if '--help' in args or '-h' in args:
        print(__doc__.strip())
        return 0

    if '--status' in args:
        if '--json' in args:
            print_status_json()
        else:
            print_status()
        return 0

    if '--list' in args:
        for preset, info in STYLE_MODELS.items():
            print(f"{preset}: {info['description']}")
        return 0

    # Determine which presets to download
    presets = []
    for arg in args:
        if arg.startswith('-'):
            continue
        if arg not in STYLE_MODELS:
            print(f"ERROR: Unknown preset '{arg}'. "
                  f"Available: {', '.join(STYLE_MODELS.keys())}",
                  file=sys.stderr)
            return 1
        presets.append(arg)

    # If no presets specified, download all
    if not presets:
        presets = list(STYLE_MODELS.keys())

    models_dir = _get_models_dir()
    print(f"Models directory: {models_dir}")
    print(f"Downloading {len(presets)} model(s): {', '.join(presets)}")
    print()

    errors = []
    for preset in presets:
        model_path = os.path.join(models_dir, STYLE_MODELS[preset]['filename'])
        if os.path.exists(model_path):
            size_mb = os.path.getsize(model_path) / (1024 * 1024)
            print(f"[{preset}] Already available ({size_mb:.1f} MiB): {model_path}")
            continue

        try:
            download_model(preset, models_dir)
        except (RuntimeError, ValueError) as e:
            print(f"ERROR: Failed to download '{preset}': {e}",
                  file=sys.stderr)
            errors.append(preset)

    print()
    if errors:
        print(f"Failed to download: {', '.join(errors)}", file=sys.stderr)
        return 1

    print("All requested models are available.")
    print_status()
    return 0


if __name__ == '__main__':
    sys.exit(main())
