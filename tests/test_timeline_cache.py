import asyncio
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.utils import timeline_cache
from backend import main
from backend.ingestion.demo_parser import TIMELINE_CACHE_VERSION


class TimelineCacheTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.cache = self.root / "timelines"
        self.cache.mkdir()
        self.demo = self.root / "test.dem"
        self.demo.write_bytes(b"PBDEMS2\0")
        self.timeline = self.cache / "test.dem.json"
        self.timeline.write_text(json.dumps({"cache_version": TIMELINE_CACHE_VERSION, "positions": {}}))

    def test_revision_invalidates_on_demo_cache_or_parser_change(self):
        timeline_cache.mark_ready(self.demo, self.timeline, TIMELINE_CACHE_VERSION)
        self.assertTrue(timeline_cache.ready(self.demo, self.timeline, TIMELINE_CACHE_VERSION))
        self.assertFalse(timeline_cache.ready(self.demo, self.timeline, TIMELINE_CACHE_VERSION + 1))
        self.demo.write_bytes(b"replacement")
        self.assertFalse(timeline_cache.ready(self.demo, self.timeline, TIMELINE_CACHE_VERSION))
        timeline_cache.mark_ready(self.demo, self.timeline, TIMELINE_CACHE_VERSION)
        self.timeline.unlink()
        self.assertFalse(timeline_cache.ready(self.demo, self.timeline, TIMELINE_CACHE_VERSION))

    def test_strict_atomic_json_keeps_previous_cache_on_bad_data(self):
        original = self.timeline.read_bytes()
        for value in (float("nan"), float("inf"), -float("inf")):
            with self.assertRaises(ValueError):
                timeline_cache.write(self.timeline, {"positions": {"player": [{"x": value}]}})
            self.assertEqual(self.timeline.read_bytes(), original)
            self.assertFalse(list(self.cache.glob("*.tmp")))
        timeline_cache.write(self.timeline, {"positions": {"player": [{"x": 0.0}]}})
        self.assertEqual(json.loads(self.timeline.read_text())["positions"]["player"][0]["x"], 0.0)

    def test_warm_endpoint_streams_json_without_loading_or_upserting_it(self):
        timeline_cache.mark_ready(self.demo, self.timeline, TIMELINE_CACHE_VERSION)
        with patch.object(main.settings, "demo_dir", self.root), patch.object(main, "_TIMELINE_CACHE_DIR", self.cache), \
             patch.object(main, "_load_roster_for_demo", return_value={"team1": {}}), \
             patch.object(main._player_stats, "ingest_timeline", side_effect=AssertionError("Warm reads must not upsert")), \
             patch("backend.main.json.load", side_effect=AssertionError("Warm reads must not load JSON")):
            response = asyncio.run(main.get_match_replay_timeline(self.demo.name))
            self.assertEqual(Path(response.path), self.timeline)
            self.assertIn("x-replay-revision", response.headers)

    def test_legacy_cache_upserts_only_once(self):
        with patch.object(main.settings, "demo_dir", self.root), patch.object(main, "_TIMELINE_CACHE_DIR", self.cache), \
             patch.object(main, "_load_roster_for_demo", return_value={"team1": {}}), \
             patch.object(main, "_ensure_local_roster"), patch.object(main._player_stats, "ingest_timeline") as ingest:
            asyncio.run(main.get_match_replay_timeline(self.demo.name))
            asyncio.run(main.get_match_replay_timeline(self.demo.name))
            self.assertEqual(ingest.call_count, 1)

    def test_replaced_demo_cannot_reuse_older_timeline(self):
        os.utime(self.demo, ns=(self.timeline.stat().st_mtime_ns + 1000, self.timeline.stat().st_mtime_ns + 1000))
        with patch.object(main.settings, "demo_dir", self.root), patch.object(main, "_TIMELINE_CACHE_DIR", self.cache), \
             patch.object(main, "_ensure_local_roster"), patch.object(main._player_stats, "ingest_timeline"), \
             patch("backend.ingestion.demo_parser.extract_match_timeline", return_value={"cache_version": TIMELINE_CACHE_VERSION}) as parse:
            asyncio.run(main.get_match_replay_timeline(self.demo.name))
            parse.assert_called_once()


if __name__ == "__main__":
    unittest.main()
