"""
Tiny SQLite-backed KV for AI outputs and compact tactical evidence.
This survives restarts so repeated reports do not consume quota again.
SQLite-only by design — it shares the lineup DB file/volume.
"""
from __future__ import annotations

import logging
from contextlib import contextmanager
import sqlite3
import time
from pathlib import Path
from typing import Optional

from backend.config import settings

logger = logging.getLogger(__name__)


class AICache:
    def __init__(self, db_path: Optional[Path] = None) -> None:
        self.db_path = db_path or settings.db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.execute(
                "CREATE TABLE IF NOT EXISTS ai_cache ("
                " kind TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,"
                " created INTEGER NOT NULL, PRIMARY KEY (kind, key))"
            )

    @contextmanager
    def _conn(self):
        # SQLite's transaction context manager does not close the connection.
        # Explicit closing prevents leaked handles/file locks on Windows.
        conn = sqlite3.connect(self.db_path)
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def get(self, kind: str, key: str) -> Optional[str]:
        try:
            with self._conn() as conn:
                row = conn.execute(
                    "SELECT value FROM ai_cache WHERE kind = ? AND key = ?",
                    (kind, key),
                ).fetchone()
                return row[0] if row else None
        except sqlite3.Error as exc:
            logger.warning("ai_cache read failed: %s", exc)
            return None

    def put(self, kind: str, key: str, value: str) -> None:
        try:
            with self._conn() as conn:
                conn.execute(
                    "INSERT INTO ai_cache(kind, key, value, created)"
                    " VALUES(?, ?, ?, ?)"
                    " ON CONFLICT(kind, key) DO UPDATE SET"
                    " value = excluded.value, created = excluded.created",
                    (kind, key, value, int(time.time())),
                )
        except sqlite3.Error as exc:
            logger.warning("ai_cache write failed: %s", exc)


ai_cache = AICache()
