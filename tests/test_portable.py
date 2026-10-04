import importlib.util
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("portable_launcher", ROOT / "packaging/launcher.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)
build_spec = importlib.util.spec_from_file_location("portable_build", ROOT / "scripts/build_portable.py")
builder = importlib.util.module_from_spec(build_spec)
build_spec.loader.exec_module(builder)


class PortableTests(unittest.TestCase):
    def test_release_name(self):
        self.assertEqual(builder.release_name("1.1.0"), "CounterScout-1.1.0-windows-x64")
        self.assertEqual(builder.release_name("2.0.0-beta.1"), "CounterScout-2.0.0-beta.1-windows-x64")
        for invalid in ("../secret", "v1", "1.2", "1.0.0/escape"):
            with self.assertRaises(ValueError):
                builder.release_name(invalid)

    def test_static_files_deep_links_and_missing_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "index.html").write_text("<html>CounterScout</html>", encoding="utf-8")
            (root / "assets").mkdir()
            (root / "assets/app.js").write_text("const test=1;", encoding="utf-8")
            app = launcher.create_web_app(root, root / "data", "1.1.0")
            with TestClient(app) as client:
                for path in ("/", "/replay", "/ingest", "/lineups", "/replay/filename.dem", "/replay/filename.dem/insights"):
                    response = client.get(path)
                    self.assertEqual(response.status_code, 200)
                    self.assertIn("CounterScout", response.text)
                self.assertEqual(client.get("/assets/app.js").status_code, 200)
                self.assertEqual(client.get("/assets/missing.js").status_code, 404)
                self.assertEqual(client.get("/missing.png").status_code, 404)
                self.assertEqual(client.get("/__portable/status").json()["version"], "1.1.0")
                self.assertEqual(client.get("/api/health").status_code, 503)

    def test_busy_port_not_terminated(self):
        with socket.socket() as occupied:
            occupied.bind((launcher.HOST, 0))
            occupied.listen()
            with patch.object(launcher, "API_PORT", occupied.getsockname()[1]):
                with self.assertRaisesRegex(RuntimeError, "No existing process was terminated"):
                    launcher.reserve_ports()
            self.assertGreater(occupied.fileno(), 0)

    def test_failed_second_bind_releases_first_socket(self):
        with socket.socket() as occupied, socket.socket() as free:
            occupied.bind((launcher.HOST, 0))
            occupied.listen()
            free.bind((launcher.HOST, 0))
            first_port = free.getsockname()[1]
            free.close()
            with patch.object(launcher, "API_PORT", first_port), patch.object(launcher, "WEB_PORT", occupied.getsockname()[1]):
                with self.assertRaises(RuntimeError):
                    launcher.reserve_ports()
            with socket.socket() as retry:
                retry.bind((launcher.HOST, first_port))

    def test_shared_version(self):
        from backend.version import VERSION
        self.assertEqual(VERSION, (ROOT / "VERSION").read_text().strip())
        self.assertIn('"../VERSION"', (ROOT / "frontend/vite.config.ts").read_text())

    def test_7zip_uses_7zip_driver_not_unrar_arguments(self):
        from backend.ingestion import hltv_scraper
        with patch.object(hltv_scraper.shutil, "which", side_effect=lambda name: "C:/portable/tools/7z.exe" if name == "7z" else None), \
             patch.object(hltv_scraper.os.path, "exists", return_value=False), \
             patch.object(hltv_scraper.rarfile, "SEVENZIP_TOOL", "7z"), \
             patch.object(hltv_scraper.rarfile, "tool_setup") as setup:
            self.assertEqual(hltv_scraper._find_rar_backend(), "C:/portable/tools/7z.exe")
            self.assertEqual(hltv_scraper.rarfile.SEVENZIP_TOOL, "C:/portable/tools/7z.exe")
            setup.assert_called_once_with(unrar=False, unar=False, bsdtar=False, sevenzip=True, sevenzip2=False, force=True)


if __name__ == "__main__":
    unittest.main()
