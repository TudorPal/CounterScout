from pathlib import Path
import tempfile
import unittest
from backend.utils.ai_cache import AICache


class AICacheTests(unittest.TestCase):
    def test_transactions_close_windows_file_handles_and_persist_values(self):
        with tempfile.TemporaryDirectory() as directory:
            path=Path(directory)/'cache.db'
            cache=AICache(path)
            cache.put('test','key','first')
            cache.put('test','key','second')
            self.assertEqual(AICache(path).get('test','key'),'second')
            self.assertIsNone(cache.get('test','missing'))
            # Unlink fails on Windows if any connection is still holding the file.
            path.unlink()


if __name__=='__main__':unittest.main()
