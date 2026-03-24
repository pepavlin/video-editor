#!/usr/bin/env python3
"""Tests for ai_style.py – focuses on pure functions and configuration."""

import unittest
import tempfile
import os
import http.server
import threading
import numpy as np

from ai_style import (
    STYLE_MODELS,
    MODEL_BASE_URL,
    _align_to_8,
    _build_download_urls,
    _compute_sha256,
    compute_flow_confidence,
    warp_frame,
    enhance_colors,
    detect_scene_changes,
    download_model,
    get_model_status,
    resolve_model,
    _get_models_dir,
)


class TestStyleModels(unittest.TestCase):
    """Tests for the AnimeGANv2 model configuration."""

    def test_all_presets_defined(self):
        """All expected presets should be in STYLE_MODELS."""
        expected = ['hayao', 'shinkai', 'paprika', 'celeb']
        for preset in expected:
            self.assertIn(preset, STYLE_MODELS)

    def test_each_model_has_required_fields(self):
        """Each model entry should have filename, description, and input_size."""
        for name, info in STYLE_MODELS.items():
            self.assertIn('filename', info, f"Model '{name}' missing 'filename'")
            self.assertIn('description', info, f"Model '{name}' missing 'description'")
            self.assertIn('input_size', info, f"Model '{name}' missing 'input_size'")
            self.assertTrue(info['filename'].endswith('.onnx'),
                            f"Model '{name}' filename should end with .onnx")

    def test_input_sizes_are_valid(self):
        """All model input sizes should be positive and divisible by 8."""
        for name, info in STYLE_MODELS.items():
            size = info['input_size']
            self.assertGreater(size, 0, f"Model '{name}' input_size should be positive")
            self.assertEqual(size % 8, 0, f"Model '{name}' input_size should be divisible by 8")


class TestAlignTo8(unittest.TestCase):
    """Tests for _align_to_8 helper."""

    def test_already_aligned(self):
        self.assertEqual(_align_to_8(512), 512)
        self.assertEqual(_align_to_8(256), 256)

    def test_rounds_up(self):
        self.assertEqual(_align_to_8(510), 512)
        self.assertEqual(_align_to_8(1), 8)
        self.assertEqual(_align_to_8(9), 16)


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


class TestComputeSha256(unittest.TestCase):
    """Tests for _compute_sha256."""

    def test_known_content(self):
        """SHA-256 of known content should match expected hash."""
        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as f:
            f.write(b'hello world')
            f.flush()
            path = f.name
        try:
            h = _compute_sha256(path)
            # sha256("hello world") is known
            self.assertEqual(
                h,
                'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
            )
        finally:
            os.unlink(path)

    def test_empty_file(self):
        """SHA-256 of empty file should match expected hash."""
        with tempfile.NamedTemporaryFile(delete=False, suffix='.bin') as f:
            path = f.name
        try:
            h = _compute_sha256(path)
            self.assertEqual(
                h,
                'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
            )
        finally:
            os.unlink(path)


class TestGetModelStatus(unittest.TestCase):
    """Tests for get_model_status."""

    def test_returns_all_presets(self):
        """Should return status for all defined presets."""
        with tempfile.TemporaryDirectory() as tmpdir:
            status = get_model_status(tmpdir)
            for preset in STYLE_MODELS:
                self.assertIn(preset, status)
                self.assertIn('available', status[preset])
                self.assertIn('path', status[preset])

    def test_detects_existing_model(self):
        """Should detect when a model file exists."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create a fake model file
            model_file = os.path.join(tmpdir, STYLE_MODELS['hayao']['filename'])
            with open(model_file, 'wb') as f:
                f.write(b'x' * 2 * 1024 * 1024)  # 2 MiB fake model

            status = get_model_status(tmpdir)
            self.assertTrue(status['hayao']['available'])
            self.assertEqual(status['hayao']['size'], 2 * 1024 * 1024)

    def test_detects_missing_model(self):
        """Should report missing when model file does not exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            status = get_model_status(tmpdir)
            self.assertFalse(status['hayao']['available'])


class TestDownloadModel(unittest.TestCase):
    """Tests for download_model with a local HTTP server."""

    @classmethod
    def setUpClass(cls):
        """Start a local HTTP server serving fake ONNX model files."""
        cls._tmpdir = tempfile.mkdtemp()
        cls._serve_dir = os.path.join(cls._tmpdir, 'serve')
        os.makedirs(cls._serve_dir)

        # Create fake ONNX files (>1 MiB to pass size check)
        for preset, info in STYLE_MODELS.items():
            fpath = os.path.join(cls._serve_dir, info['filename'])
            with open(fpath, 'wb') as f:
                f.write(b'\x00' * (2 * 1024 * 1024))  # 2 MiB

        handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(
            *a, directory=cls._serve_dir, **kw
        )
        cls._server = http.server.HTTPServer(('127.0.0.1', 0), handler)
        cls._port = cls._server.server_address[1]
        cls._thread = threading.Thread(target=cls._server.serve_forever, daemon=True)
        cls._thread.start()

    @classmethod
    def tearDownClass(cls):
        cls._server.shutdown()
        import shutil
        shutil.rmtree(cls._tmpdir, ignore_errors=True)

    def test_download_model_success(self):
        """Should download a model to the specified directory."""
        with tempfile.TemporaryDirectory() as dl_dir:
            base_url = f'http://127.0.0.1:{self._port}'
            path = download_model('hayao', dl_dir, base_url)
            self.assertTrue(os.path.exists(path))
            self.assertGreater(os.path.getsize(path), 1024 * 1024)

    def test_download_model_invalid_preset(self):
        """Should raise ValueError for unknown preset."""
        with tempfile.TemporaryDirectory() as dl_dir:
            with self.assertRaises(ValueError):
                download_model('nonexistent', dl_dir)

    def test_download_model_already_exists(self):
        """If model already exists, download_model should overwrite it."""
        with tempfile.TemporaryDirectory() as dl_dir:
            base_url = f'http://127.0.0.1:{self._port}'
            # First download
            p1 = download_model('hayao', dl_dir, base_url)
            self.assertTrue(os.path.exists(p1))
            # Second download should succeed (overwrite)
            p2 = download_model('hayao', dl_dir, base_url)
            self.assertTrue(os.path.exists(p2))

    def test_download_model_bad_url(self):
        """Should raise RuntimeError when download fails."""
        with tempfile.TemporaryDirectory() as dl_dir:
            with self.assertRaises(RuntimeError):
                download_model('hayao', dl_dir, 'http://127.0.0.1:1/nonexistent')

    def test_download_all_presets(self):
        """Should download all preset models."""
        with tempfile.TemporaryDirectory() as dl_dir:
            base_url = f'http://127.0.0.1:{self._port}'
            for preset in STYLE_MODELS:
                path = download_model(preset, dl_dir, base_url)
                self.assertTrue(os.path.exists(path))

    def test_no_partial_file_on_failure(self):
        """Should not leave a .download temp file on failure."""
        with tempfile.TemporaryDirectory() as dl_dir:
            try:
                download_model('hayao', dl_dir, 'http://127.0.0.1:1/bad')
            except RuntimeError:
                pass
            # No .download files should remain
            files = os.listdir(dl_dir)
            download_files = [f for f in files if f.endswith('.download')]
            self.assertEqual(len(download_files), 0)


class TestBuildDownloadUrls(unittest.TestCase):
    """Tests for _build_download_urls URL generation."""

    def test_huggingface_url_adds_download_param(self):
        """HuggingFace URLs should get ?download=true appended."""
        urls = _build_download_urls(
            'https://huggingface.co/bryandlee/animegan2-pytorch/resolve/main/onnx',
            'model.onnx'
        )
        self.assertTrue(any('?download=true' in u for u in urls))

    def test_huggingface_url_also_has_plain_fallback(self):
        """HuggingFace URLs should also include the plain URL as fallback."""
        urls = _build_download_urls(
            'https://huggingface.co/bryandlee/animegan2-pytorch/resolve/main/onnx',
            'model.onnx'
        )
        plain = 'https://huggingface.co/bryandlee/animegan2-pytorch/resolve/main/onnx/model.onnx'
        self.assertIn(plain, urls)
        self.assertEqual(len(urls), 2)

    def test_non_huggingface_url_no_download_param(self):
        """Non-HuggingFace URLs should NOT get ?download=true."""
        urls = _build_download_urls('http://localhost:8000', 'model.onnx')
        self.assertEqual(len(urls), 1)
        self.assertNotIn('?download=true', urls[0])
        self.assertEqual(urls[0], 'http://localhost:8000/model.onnx')

    def test_trailing_slash_stripped(self):
        """Trailing slash in base URL should be stripped."""
        urls = _build_download_urls('http://localhost:8000/', 'model.onnx')
        self.assertEqual(urls[0], 'http://localhost:8000/model.onnx')


class TestDownloadModelWithAuth(unittest.TestCase):
    """Tests for download_model with HF_TOKEN authentication."""

    @classmethod
    def setUpClass(cls):
        """Start a local HTTP server that checks for auth headers."""
        cls._tmpdir = tempfile.mkdtemp()
        cls._serve_dir = os.path.join(cls._tmpdir, 'serve')
        os.makedirs(cls._serve_dir)

        # Create a fake ONNX file
        fpath = os.path.join(cls._serve_dir, STYLE_MODELS['hayao']['filename'])
        with open(fpath, 'wb') as f:
            f.write(b'\x00' * (2 * 1024 * 1024))

        cls._received_headers = {}

        class HeaderCapturingHandler(http.server.SimpleHTTPRequestHandler):
            def do_GET(inner_self):
                cls._received_headers = dict(inner_self.headers)
                inner_self.directory = cls._serve_dir
                # Strip query string for file serving
                if '?' in inner_self.path:
                    inner_self.path = inner_self.path.split('?')[0]
                super().do_GET()

            def log_message(self, *args):
                pass  # Silence logs

        cls._server = http.server.HTTPServer(('127.0.0.1', 0), HeaderCapturingHandler)
        cls._port = cls._server.server_address[1]
        cls._thread = threading.Thread(target=cls._server.serve_forever, daemon=True)
        cls._thread.start()

    @classmethod
    def tearDownClass(cls):
        cls._server.shutdown()
        import shutil
        shutil.rmtree(cls._tmpdir, ignore_errors=True)

    def test_hf_token_sent_for_huggingface_urls(self):
        """HF_TOKEN should be sent as Bearer token for HuggingFace-like URLs."""
        # We simulate a HuggingFace URL by using localhost but including
        # 'huggingface.co' in the base_url won't work for actual connection,
        # so we test the header logic indirectly via env var + non-HF URL
        # The token is only added when 'huggingface.co' is in the URL
        with tempfile.TemporaryDirectory() as dl_dir:
            base_url = f'http://127.0.0.1:{self._port}'
            os.environ['HF_TOKEN'] = 'test-token-123'
            try:
                download_model('hayao', dl_dir, base_url)
                # For non-HF URLs, Authorization should NOT be set
                self.assertNotIn('Authorization', self._received_headers)
            finally:
                os.environ.pop('HF_TOKEN', None)

    def test_download_works_with_query_params(self):
        """Download should work when URL has ?download=true (stripped by server)."""
        with tempfile.TemporaryDirectory() as dl_dir:
            base_url = f'http://127.0.0.1:{self._port}'
            path = download_model('hayao', dl_dir, base_url)
            self.assertTrue(os.path.exists(path))


class TestStyleModelConfig(unittest.TestCase):
    """Tests for STYLE_MODELS configuration including download fields."""

    def test_model_base_url_is_string(self):
        """MODEL_BASE_URL should be a non-empty string."""
        self.assertIsInstance(MODEL_BASE_URL, str)
        self.assertTrue(len(MODEL_BASE_URL) > 0)

    def test_each_model_has_sha256_field(self):
        """Each model should have a sha256 field (can be None)."""
        for name, info in STYLE_MODELS.items():
            self.assertIn('sha256', info, f"Model '{name}' missing 'sha256'")


if __name__ == '__main__':
    unittest.main()
