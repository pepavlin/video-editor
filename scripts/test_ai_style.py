#!/usr/bin/env python3
"""Tests for ai_style.py – focuses on pure functions and configuration."""

import unittest
import numpy as np

from ai_style import (
    STYLE_MODELS,
    compute_flow_confidence,
    warp_frame,
    enhance_colors,
    detect_scene_changes,
    _get_models_dir,
)


class TestStyleModels(unittest.TestCase):
    """Tests for the style model configuration."""

    def test_all_presets_defined(self):
        """All expected presets should be in STYLE_MODELS."""
        expected = ['impressionist', 'bold', 'abstract', 'mosaic', 'expressive']
        for preset in expected:
            self.assertIn(preset, STYLE_MODELS)

    def test_each_model_has_required_fields(self):
        """Each model entry should have url, filename, and description."""
        for name, info in STYLE_MODELS.items():
            self.assertIn('url', info, f"Model '{name}' missing 'url'")
            self.assertIn('filename', info, f"Model '{name}' missing 'filename'")
            self.assertIn('description', info, f"Model '{name}' missing 'description'")
            self.assertTrue(info['filename'].endswith('.onnx'),
                            f"Model '{name}' filename should end with .onnx")

    def test_urls_are_https(self):
        """All model URLs should use HTTPS."""
        for name, info in STYLE_MODELS.items():
            self.assertTrue(info['url'].startswith('https://'),
                            f"Model '{name}' URL should start with https://")


class TestFlowConfidence(unittest.TestCase):
    """Tests for compute_flow_confidence."""

    def test_zero_flow_gives_max_confidence(self):
        """Zero motion should produce maximum confidence (1.0)."""
        flow = np.zeros((10, 10, 2), dtype=np.float32)
        conf = compute_flow_confidence(flow)
        np.testing.assert_allclose(conf, 1.0, atol=0.01)

    def test_large_flow_gives_low_confidence(self):
        """Large motion should produce low confidence."""
        flow = np.ones((10, 10, 2), dtype=np.float32) * 100
        conf = compute_flow_confidence(flow)
        self.assertTrue(np.all(conf < 0.1))

    def test_output_shape_matches_input(self):
        """Confidence map should match flow spatial dimensions."""
        flow = np.random.randn(20, 30, 2).astype(np.float32)
        conf = compute_flow_confidence(flow)
        self.assertEqual(conf.shape, (20, 30))

    def test_confidence_range_0_to_1(self):
        """All confidence values should be in [0, 1]."""
        flow = np.random.randn(15, 15, 2).astype(np.float32) * 50
        conf = compute_flow_confidence(flow)
        self.assertTrue(np.all(conf >= 0))
        self.assertTrue(np.all(conf <= 1))


class TestWarpFrame(unittest.TestCase):
    """Tests for warp_frame."""

    def test_zero_flow_returns_same_frame(self):
        """Zero flow should return the same frame."""
        frame = np.random.randint(0, 255, (50, 60, 3), dtype=np.uint8)
        flow = np.zeros((50, 60, 2), dtype=np.float32)
        warped = warp_frame(frame, flow)
        np.testing.assert_array_equal(warped, frame)

    def test_output_shape_matches_input(self):
        """Warped frame should have same shape as input."""
        frame = np.random.randint(0, 255, (40, 50, 3), dtype=np.uint8)
        flow = np.random.randn(40, 50, 2).astype(np.float32) * 2
        warped = warp_frame(frame, flow)
        self.assertEqual(warped.shape, frame.shape)


class TestEnhanceColors(unittest.TestCase):
    """Tests for enhance_colors."""

    def test_vibrance_1_returns_similar(self):
        """Vibrance of 1.0 should return approximately the same frame."""
        frame = np.random.randint(50, 200, (30, 40, 3), dtype=np.uint8)
        result = enhance_colors(frame, 1.0)
        # Should be identical since vibrance=1.0 is a no-op
        np.testing.assert_array_equal(result, frame)

    def test_vibrance_boost_increases_saturation(self):
        """Higher vibrance should generally increase color saturation."""
        # Create a mildly colorful frame
        frame = np.full((10, 10, 3), [100, 150, 200], dtype=np.uint8)
        boosted = enhance_colors(frame, 1.8)
        # Convert both to HSV and compare saturation
        import cv2
        hsv_orig = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV).astype(float)
        hsv_boosted = cv2.cvtColor(boosted, cv2.COLOR_BGR2HSV).astype(float)
        # Average saturation should be higher (or at max)
        self.assertGreaterEqual(
            hsv_boosted[:, :, 1].mean(),
            hsv_orig[:, :, 1].mean()
        )

    def test_output_shape_matches_input(self):
        """Output should have same shape and dtype."""
        frame = np.random.randint(0, 255, (20, 30, 3), dtype=np.uint8)
        result = enhance_colors(frame, 1.5)
        self.assertEqual(result.shape, frame.shape)
        self.assertEqual(result.dtype, np.uint8)


class TestModelsDir(unittest.TestCase):
    """Tests for _get_models_dir."""

    def test_returns_string(self):
        """Should return a valid directory path string."""
        result = _get_models_dir()
        self.assertIsInstance(result, str)
        self.assertTrue(len(result) > 0)


if __name__ == '__main__':
    unittest.main()
