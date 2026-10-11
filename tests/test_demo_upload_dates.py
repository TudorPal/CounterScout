import asyncio
import io
import os
import time
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend import main
from backend.utils.demo_catalog import DemoCatalog
from fastapi import UploadFile


class UploadDateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.demos = self.root / 'demos'
        self.demos.mkdir()
        self.database = self.root / 'demo-catalog.db'
        self.catalog = DemoCatalog(self.database)
        self.enterContext(patch.object(main.settings, 'demo_dir', self.demos))
        self.enterContext(patch.object(main.settings, 'db_path', self.root / 'lineups.db'))
        self.enterContext(patch.object(main, '_demo_map_name', return_value='de_anubis'))
        self.enterContext(patch.object(main, '_load_roster_for_demo', return_value={}))

    def demo(self, name):
        path = self.demos / name
        path.write_bytes(b'fixture')
        return path

    def test_unknown_historical_dates_are_not_invented(self):
        self.demo('legacy.dem')
        entry = asyncio.run(main.list_match_replay_demos())[0]
        self.assertIsNone(entry.uploaded_at)
        self.assertFalse(self.database.exists(), 'A library read must not create upload timestamps')

    def test_uploaded_date_is_persistent_and_used_for_sorting(self):
        old, new = self.demo('old.dem'), self.demo('new.dem')
        os.utime(old, (5000, 5000))
        os.utime(new, (1000, 1000))
        self.catalog.record(old, 10)
        self.catalog.record(new, 20)
        entries = asyncio.run(main.list_match_replay_demos())
        self.assertEqual([e.demo_file for e in entries], ['new.dem', 'old.dem'])
        self.assertEqual([e.uploaded_at for e in entries], [20, 10])
        self.assertEqual(DemoCatalog(self.database).dates([new])['new.dem'], 20)

    def test_replacement_and_new_upload_reset_date_but_read_does_not(self):
        path = self.demo('same.dem')
        self.catalog.record(path, 10)
        self.assertEqual(self.catalog.dates([path])[path.name], 10)
        path.write_bytes(b'replacement with different length')
        self.assertEqual(self.catalog.dates([path]), {})
        self.catalog.record(path, 20)
        self.assertEqual(self.catalog.dates([path])[path.name], 20)
        self.catalog.forget(path.name)
        self.assertEqual(self.catalog.dates([path]), {})

    def test_manual_and_extension_shared_upload_records_real_time(self):
        start = time.time()
        with patch.object(main, '_TIMELINE_CACHE_DIR', self.root / 'timelines'), \
             patch.object(main, '_ensure_local_roster'), \
             patch.object(main._player_stats, 'ingest_timeline'), \
             patch.object(main._pipeline, 'run'), \
             patch('backend.ingestion.demo_parser.extract_match_timeline', return_value={'map_name': 'de_anubis'}):
            result = asyncio.run(main.upload_demo(UploadFile(filename='test.dem', file=io.BytesIO(b'fixture')), None, None, None))
        self.assertGreaterEqual(result.uploaded_at, start)
        self.assertLessEqual(result.uploaded_at, time.time())
        self.assertEqual(asyncio.run(main.list_match_replay_demos())[0].uploaded_at, result.uploaded_at)

    def test_delete_removes_only_target_demo_date(self):
        target, keep = self.demo('target.dem'), self.demo('keep.dem')
        self.catalog.record(target, 10)
        self.catalog.record(keep, 20)
        with patch.object(main, '_TIMELINE_CACHE_DIR', self.root / 'timelines'):
            asyncio.run(main.delete_demo(target.name))
        self.assertEqual(self.catalog.dates([keep]), {keep.name: 20})
        self.assertEqual(self.catalog.dates([target]), {})


if __name__ == '__main__':
    unittest.main()
