import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import main


class DemoCatalogTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.demos = self.root / "demos"
        self.cache = self.root / "cache"
        self.demos.mkdir()
        self.cache.mkdir()
        self.enterContext(patch.object(main.settings, "demo_dir", self.demos))
        self.enterContext(patch.object(main, "_TIMELINE_CACHE_DIR", self.cache))

    def demo(self, name, map_name=None):
        (self.demos / name).write_bytes(b"PBDEMS2\x00")
        if map_name:
            (self.cache / f"{name}.json").write_text(json.dumps({"map_name": map_name}), encoding="utf-8")

    def test_faceit_uuid_uses_parsed_map_in_all_catalogs(self):
        name = "faceit_1-9bb7da66-c0ee-484d-accc-fd7d446ae1d0_abcdef.dem"
        self.demo(name, "de_nuke")
        catalog = asyncio.run(main.list_downloaded_demos())
        replay = asyncio.run(main.list_match_replay_demos())
        info = asyncio.run(main.get_match_info(name))
        self.assertEqual(catalog["maps"], [{"map_name": "de_nuke", "token": "nuke", "count": 1}])
        self.assertEqual(replay[0].map_name, "de_nuke")
        self.assertEqual(info["map_name"], "de_nuke")

    def test_metadata_overrides_misleading_filename(self):
        self.demo("2398102_Inferno1.dem", "de_cache")
        self.assertEqual(main._demo_map_name("2398102_Inferno1.dem"), "de_cache")

    def test_unknown_uuid_is_untagged_not_a_fake_map(self):
        self.demo("faceit_1-9bb7da66-c0ee-484d-accc-fd7d446ae1d0_abcdef.dem")
        self.demo("2398102_Dust2.dem")
        self.demo("Bannda_Inferno1.dem")
        result = asyncio.run(main.list_downloaded_demos())
        self.assertEqual({m["map_name"] for m in result["maps"]}, {"de_dust2", "de_inferno"})
        self.assertEqual((result["total_demos"], result["untagged"]), (3, 1))

    def test_roster_fallback_and_real_custom_map_metadata(self):
        self.demo("local.dem")
        with patch.object(main, "_load_roster_for_demo", return_value={"map_name": "de_nuke"}):
            self.assertEqual(main._demo_map_name("local.dem"), "de_nuke")
        self.demo("custom.dem", "de_custom_map")
        self.assertEqual(main._demo_map_name("custom.dem"), "de_custom_map")


if __name__ == "__main__":
    unittest.main()
