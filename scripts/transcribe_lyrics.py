#!/usr/bin/env python3
"""
Auto-transcription of lyrics using OpenAI Whisper (no pre-written lyrics required).
Usage: python3 transcribe_lyrics.py <audio_wav_path> <output_json_path>

Output JSON format:
{
  "text": "full transcribed text as a single string",
  "words": [
    { "word": "hello", "start": 0.10, "end": 0.50 },
    ...
  ]
}
"""

import sys
import json
import os


def transcribe_lyrics(audio_path: str, output_path: str) -> None:
    try:
        import whisper
    except ImportError:
        print("ERROR: openai-whisper not installed. Run: pip3 install openai-whisper", file=sys.stderr)
        sys.exit(1)

    print(f"[transcribe_lyrics] Loading Whisper model (base)...")
    model = whisper.load_model("base")

    print(f"[transcribe_lyrics] Transcribing: {audio_path}")
    result = model.transcribe(
        audio_path,
        word_timestamps=True,
        task="transcribe",
    )

    # Extract word-level timestamps
    words = []
    for segment in result.get("segments", []):
        for word_data in segment.get("words", []):
            w = word_data.get("word", "").strip()
            if w:
                words.append({
                    "word": w,
                    "start": float(word_data.get("start", 0)),
                    "end": float(word_data.get("end", 0)),
                })

    print(f"[transcribe_lyrics] Found {len(words)} words")

    if not words:
        # Fall back to segment-level text without timestamps
        print("[transcribe_lyrics] No word timestamps available, falling back to segment text")
        for segment in result.get("segments", []):
            seg_words = segment.get("text", "").split()
            seg_start = float(segment.get("start", 0))
            seg_end = float(segment.get("end", 0))
            if seg_words:
                dur = (seg_end - seg_start) / len(seg_words)
                for i, w in enumerate(seg_words):
                    words.append({
                        "word": w,
                        "start": seg_start + i * dur,
                        "end": seg_start + (i + 1) * dur,
                    })

    # Build plain text from the detected words (preserving original capitalisation)
    full_text = " ".join(w["word"] for w in words).strip()

    output = {
        "text": full_text,
        "words": words,
    }

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2)

    print(f"[transcribe_lyrics] Saved to: {output_path}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <audio_wav> <output_json>", file=sys.stderr)
        sys.exit(1)

    transcribe_lyrics(sys.argv[1], sys.argv[2])
