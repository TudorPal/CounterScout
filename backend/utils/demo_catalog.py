"""Small, persistent import timestamps independent of demo/roster mtimes."""
import sqlite3
import time
from contextlib import closing
from pathlib import Path


class DemoCatalog:
    def __init__(self, path: Path):
        self.path = path

    def record(self, demo: Path, uploaded_at: float | None = None) -> float:
        stat = demo.stat()
        stamp = time.time() if uploaded_at is None else uploaded_at
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.path, timeout=20)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS uploads (name TEXT PRIMARY KEY, size INTEGER, mtime_ns INTEGER, uploaded_at REAL)")
            db.execute("INSERT OR REPLACE INTO uploads VALUES (?,?,?,?)", (demo.name, stat.st_size, stat.st_mtime_ns, stamp))
        return stamp

    def dates(self, demos: list[Path]) -> dict[str, float]:
        # Older files have no known upload date: never manufacture one on first
        # library access or replace it with the source/archive timestamp.
        if not self.path.exists():
            return {}
        with closing(sqlite3.connect(self.path, timeout=20)) as db:
            rows = {r[0]: r[1:] for r in db.execute("SELECT name,size,mtime_ns,uploaded_at FROM uploads")}
        result = {}
        for demo in demos:
            try:
                stat = demo.stat()
            except OSError:
                continue
            saved = rows.get(demo.name)
            if saved and saved[:2] == (stat.st_size, stat.st_mtime_ns):
                result[demo.name] = saved[2]
        return result

    def forget(self, name: str) -> None:
        if self.path.exists():
            with closing(sqlite3.connect(self.path, timeout=20)) as db, db:
                db.execute("DELETE FROM uploads WHERE name=?", (name,))
