#!/usr/bin/env python3
"""Tests for align_lyrics.py – focuses on _map_to_provided_lyrics and normalize_word."""

import unittest
from align_lyrics import normalize_word, _map_to_provided_lyrics, _fallback_align


class TestNormalizeWord(unittest.TestCase):
    """Tests for Unicode-aware normalize_word function."""

    def test_basic_lowercase(self):
        self.assertEqual(normalize_word("Hello"), "hello")

    def test_strips_punctuation(self):
        self.assertEqual(normalize_word("world!"), "world")
        self.assertEqual(normalize_word("don't"), "don't")

    def test_czech_diacritics_decomposed(self):
        """Czech diacritical chars should decompose to base letters."""
        self.assertEqual(normalize_word("příběh"), "pribeh")
        self.assertEqual(normalize_word("čeština"), "cestina")
        self.assertEqual(normalize_word("žluťoučký"), "zlutoucky")

    def test_single_diacritic_char(self):
        """Single-letter Czech words should not normalize to empty."""
        self.assertEqual(normalize_word("ú"), "u")
        self.assertEqual(normalize_word("á"), "a")
        self.assertEqual(normalize_word("í"), "i")

    def test_pure_punctuation_empty(self):
        """Pure punctuation normalizes to empty (but should not be skipped)."""
        self.assertEqual(normalize_word("..."), "")
        self.assertEqual(normalize_word("—"), "")

    def test_digits_preserved(self):
        self.assertEqual(normalize_word("123abc"), "123abc")

    def test_apostrophe_preserved(self):
        self.assertEqual(normalize_word("it's"), "it's")

    def test_german_umlaut(self):
        self.assertEqual(normalize_word("über"), "uber")

    def test_french_accent(self):
        self.assertEqual(normalize_word("café"), "cafe")


def _make_whisper_words(words_with_times):
    """Helper: create whisper word list from (word, start, end) tuples."""
    return [
        {"word": w, "start": s, "end": e, "norm": normalize_word(w)}
        for w, s, e in words_with_times
    ]


class TestMapToProvidedLyrics(unittest.TestCase):
    """Tests for _map_to_provided_lyrics – the core alignment function."""

    def test_exact_match_all_words(self):
        """When Whisper and lyrics match exactly, all words get correct timestamps."""
        lyrics = ["hello", "world"]
        whisper = _make_whisper_words([("hello", 0.0, 0.5), ("world", 0.5, 1.0)])
        result = _map_to_provided_lyrics(lyrics, whisper)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["word"], "hello")
        self.assertEqual(result[0]["start"], 0.0)
        self.assertEqual(result[1]["word"], "world")
        self.assertEqual(result[1]["start"], 0.5)

    def test_all_lyrics_words_preserved_when_whisper_skips(self):
        """Words Whisper doesn't detect must still appear in output."""
        lyrics = ["I", "love", "you", "so", "much"]
        # Whisper only detected "love" and "much"
        whisper = _make_whisper_words([("love", 0.5, 1.0), ("much", 2.0, 2.5)])
        result = _map_to_provided_lyrics(lyrics, whisper)
        self.assertEqual(len(result), 5, "All 5 lyrics words must be in output")
        words_out = [r["word"] for r in result]
        self.assertEqual(words_out, ["I", "love", "you", "so", "much"])

    def test_no_words_skipped_with_empty_normalize(self):
        """Words that normalize to empty must NOT be skipped."""
        lyrics = ["hello", "...", "world"]
        whisper = _make_whisper_words([("hello", 0.0, 0.5), ("world", 0.5, 1.0)])
        result = _map_to_provided_lyrics(lyrics, whisper)
        self.assertEqual(len(result), 3, "Even '...' must appear in output")
        words_out = [r["word"] for r in result]
        self.assertEqual(words_out, ["hello", "...", "world"])

    def test_czech_words_all_preserved(self):
        """Czech lyrics words with diacritics should all be preserved."""
        lyrics = ["Já", "tě", "miluju", "příběh", "lásky"]
        whisper = _make_whisper_words([
            ("Ja", 0.0, 0.3),
            ("te", 0.3, 0.5),
            ("miluju", 0.5, 1.0),
            ("pribeh", 1.0, 1.5),
            ("lasky", 1.5, 2.0),
        ])
        result = _map_to_provided_lyrics(lyrics, whisper)
        self.assertEqual(len(result), 5)
        words_out = [r["word"] for r in result]
        self.assertEqual(words_out, ["Já", "tě", "miluju", "příběh", "lásky"])

    def test_more_lyrics_than_whisper(self):
        """When lyrics has more words than Whisper detected, all must be output."""
        lyrics = ["a", "b", "c", "d", "e", "f", "g"]
        whisper = _make_whisper_words([("a", 0.0, 0.5), ("c", 0.5, 1.0)])
        result = _map_to_provided_lyrics(lyrics, whisper)
        self.assertEqual(len(result), 7)
        words_out = [r["word"] for r in result]
        self.assertEqual(words_out, ["a", "b", "c", "d", "e", "f", "g"])

    def test_empty_whisper_all_words_preserved(self):
        """If Whisper produced nothing, all lyrics words should still appear."""
        lyrics = ["hello", "world"]
        whisper = []
        result = _map_to_provided_lyrics(lyrics, whisper)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["word"], "hello")
        self.assertEqual(result[1]["word"], "world")

    def test_edge_case_single_word(self):
        lyrics = ["hey"]
        whisper = _make_whisper_words([("hey", 1.0, 1.5)])
        result = _map_to_provided_lyrics(lyrics, whisper)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["word"], "hey")

    def test_partial_match(self):
        """Partial matches should work (substring matching)."""
        lyrics = ["running"]
        whisper = _make_whisper_words([("run", 0.0, 0.5)])
        result = _map_to_provided_lyrics(lyrics, whisper)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["word"], "running")
        self.assertEqual(result[0]["start"], 0.0)

    def test_output_count_equals_input_count(self):
        """The number of output words must ALWAYS equal the number of input lyrics words."""
        test_cases = [
            (["a", "b", "c"], []),
            (["a"], _make_whisper_words([("x", 0, 1)])),
            (["a", "b", "c", "d", "e"], _make_whisper_words([("a", 0, 0.5)])),
            (["...", "!", "—"], _make_whisper_words([("hello", 0, 1)])),
            (["příběh"], _make_whisper_words([("pribeh", 0, 1)])),
        ]
        for lyrics, whisper in test_cases:
            result = _map_to_provided_lyrics(lyrics, whisper)
            self.assertEqual(
                len(result), len(lyrics),
                f"Input {lyrics} with whisper {[w['word'] for w in whisper]} "
                f"should produce {len(lyrics)} words, got {len(result)}"
            )

    def test_timestamps_are_monotonic(self):
        """Timestamps should generally be non-decreasing."""
        lyrics = ["one", "two", "three", "four", "five"]
        whisper = _make_whisper_words([
            ("one", 0.0, 0.5),
            ("two", 0.5, 1.0),
            ("three", 1.0, 1.5),
            ("four", 1.5, 2.0),
            ("five", 2.0, 2.5),
        ])
        result = _map_to_provided_lyrics(lyrics, whisper)
        for i in range(1, len(result)):
            self.assertGreaterEqual(
                result[i]["start"], result[i - 1]["start"],
                f"Word '{result[i]['word']}' starts before '{result[i-1]['word']}'"
            )


class TestFallbackAlign(unittest.TestCase):
    """Tests for _fallback_align."""

    def test_all_words_present_no_segments(self):
        lyrics = ["a", "b", "c"]
        result = _fallback_align(lyrics, [])
        self.assertEqual(len(result), 3)
        self.assertEqual([r["word"] for r in result], ["a", "b", "c"])

    def test_words_evenly_distributed(self):
        lyrics = ["hello", "world"]
        result = _fallback_align(lyrics, [])
        self.assertEqual(len(result), 2)
        self.assertAlmostEqual(result[0]["start"], 0.0)
        self.assertAlmostEqual(result[1]["start"], 0.4)


if __name__ == "__main__":
    unittest.main()
