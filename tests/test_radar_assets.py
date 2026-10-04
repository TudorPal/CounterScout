import struct
import unittest
from pathlib import Path

from fastapi.testclient import TestClient
from backend.main import app


class RadarAssetTests(unittest.TestCase):
    def test_replacement_radars_preserve_calibrated_dimensions(self):
        root = Path(__file__).resolve().parents[1] / "backend/data/radars"
        for name in ("de_ancient", "de_anubis", "de_cache", "de_dust2", "de_inferno", "de_mirage", "de_nuke"):
            with self.subTest(map=name):
                header = (root / f"{name}.png").read_bytes()[:24]
                self.assertEqual(header[:8], b"\x89PNG\r\n\x1a\n")
                self.assertEqual(struct.unpack(">II", header[16:24]), (1024, 1024))

    def test_versioned_upper_radar_is_served_without_lower_level(self):
        client = TestClient(app)
        info = client.get("/api/radars/de_nuke").json()
        self.assertEqual(info["image_url"], "/api/radars/de_nuke.png?v=greyscale-1")
        response = client.get(info["image_url"])
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.content.startswith(b"\x89PNG"))

    def test_greyscale_filter_is_base_image_only_for_html_and_svg(self):
        css = (Path(__file__).resolve().parents[1] / "frontend/src/index.css").read_text(encoding="utf-8")
        self.assertIn('img[src*="/api/radars/"]', css)
        self.assertIn('image[href*="/api/radars/"]', css)
        self.assertIn('filter: grayscale(1)', css)
