#!/usr/bin/env python3
"""
Lyrics word-level alignment using OpenAI Whisper.
Usage: python3 align_lyrics.py <audio_wav_path> <lyrics_txt_path> <output_json_path>

Strategy:
1. Run Whisper with word-level timestamps
2. Map Whisper words to provided lyrics using fuzzy matching
3. Output word timestamps
"""

import sys
import json
import os
import re


def normalize_word(w: str) -> str:
    """Strip punctuation and lowercase for matching."""
    return re.sub(r"[^a-z0-9']", "", w.lower())


def align_lyrics(audio_path: str, lyrics_path: str, output_path: str) -> None:
    try:
        import whisper
    except ImportError:
        print("ERROR: openai-whisper not installed. Run: pip3 install openai-whisper", file=sys.stderr)
        sys.exit(1)

    print(f"[align_lyrics] Reading lyrics from: {lyrics_path}")
    with open(lyrics_path, "r", encoding="utf-8") as f:
        lyrics_text = f.read().strip()

    # Tokenize provided lyrics
    lyrics_words = [w for w in re.split(r'\s+', lyrics_text) if w.strip()]

    print(f"[align_lyrics] Lyrics: {len(lyrics_words)} words")
    print("[align_lyrics] Loading Whisper model (base)...")

    model = whisper.load_model("base")

    print(f"[align_lyrics] Transcribing: {audio_path}")
    result = model.transcribe(
        audio_path,
        word_timestamps=True,
        language="en",
        task="transcribe",
    )

    # Extract all word-level timestamps from whisper segments
    whisper_words = []
    for segment in result.get("segments", []):
        for word_data in segment.get("words", []):
            w = word_data.get("word", "").strip()
            if w:
                whisper_words.append({
                    "word": w,
                    "start": float(word_data.get("start", 0)),
                    "end": float(word_data.get("end", 0)),
                    "norm": normalize_word(w),
                })

    print(f"[align_lyrics] Whisper found {len(whisper_words)} words")

    if not whisper_words:
        # Fallback: use segment-level timing distributed evenly
        print("[align_lyrics] No word timestamps from Whisper, using segment fallback")
        output_words = _fallback_align(lyrics_words, result.get("segments", []))
    else:
        # Try to map provided lyrics to whisper words
        output_words = _map_to_provided_lyrics(lyrics_words, whisper_words)

    print(f"[align_lyrics] Aligned {len(output_words)} words")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(output_words, f, indent=2)

    print(f"[align_lyrics] Saved to: {output_path}")


def _map_to_provided_lyrics(lyrics_words: list, whisper_words: list) -> list:
    """
    Map provided lyrics words to whisper timestamps using greedy alignment.
    Uses normalized word matching with tolerance for transcription errors.
    """
    result = []
    w_idx = 0  # whisper word pointer

    for lw in lyrics_words:
        norm_lw = normalize_word(lw)
        if not norm_lw:
            continue

        # Search ahead in whisper words for a match
        best_match_idx = -1
        search_window = min(w_idx + 8, len(whisper_words))

        for i in range(w_idx, search_window):
            if whisper_words[i]["norm"] == norm_lw:
                best_match_idx = i
                break
            # Partial match
            if norm_lw in whisper_words[i]["norm"] or whisper_words[i]["norm"] in norm_lw:
                if best_match_idx < 0:
                    best_match_idx = i

        if best_match_idx >= 0:
            ww = whisper_words[best_match_idx]
            result.append({
                "word": lw,
                "start": ww["start"],
                "end": ww["end"],
            })
            w_idx = best_match_idx + 1
        elif w_idx < len(whisper_words):
            # No match found: use current whisper word position anyway
            ww = whisper_words[w_idx]
            result.append({
                "word": lw,
                "start": ww["start"],
                "end": ww["end"],
            })
            # Don't advance w_idx (multiple lyrics words may map to one whisper word)
        elif result:
            # Past end of whisper words: extrapolate
            last = result[-1]
            avg_dur = 0.3
            result.append({
                "word": lw,
                "start": last["end"],
                "end": last["end"] + avg_dur,
            })

    return result


def _fallback_align(lyrics_words: list, segments: list) -> list:
    """Distribute lyrics words evenly across segments when word timestamps unavailable."""
    if not segments:
        # Just space words evenly starting at 0
        result = []
        t = 0.0
        for w in lyrics_words:
            result.append({"word": w, "start": t, "end": t + 0.4})
            t += 0.4
        return result

    total_start = segments[0]["start"]
    total_end = segments[-1]["end"]
    total_dur = total_end - total_start
    word_dur = total_dur / max(len(lyrics_words), 1)

    result = []
    for i, w in enumerate(lyrics_words):
        start = total_start + i * word_dur
        result.append({
            "word": w,
            "start": start,
            "end": start + word_dur,
        })
    return result


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(f"Usage: {sys.argv[0]} <audio_wav> <lyrics_txt> <output_json>", file=sys.stderr)
        sys.exit(1)

    align_lyrics(sys.argv[1], sys.argv[2], sys.argv[3])
