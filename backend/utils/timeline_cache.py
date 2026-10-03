"""Small replay revision stamps, so a cache hit never loads a 100 MB JSON."""
import json
from pathlib import Path


def revision(demo: Path, cache: Path, version: int) -> str:
    d = demo.stat()
    c = cache.stat() if cache.exists() else None
    return f"{version}:{d.st_mtime_ns}:{d.st_size}:{c.st_mtime_ns if c else 0}:{c.st_size if c else 0}"


def ready(demo: Path, cache: Path, version: int) -> bool:
    try:
        meta = json.loads(cache.with_suffix(".stamp.json").read_text(encoding="utf-8"))
        return meta.get("revision") == revision(demo, cache, version) and cache.exists()
    except (OSError, ValueError):
        return False


def mark_ready(demo: Path, cache: Path, version: int):
    cache.with_suffix(".stamp.json").write_text(
        json.dumps({"revision": revision(demo, cache, version)}), encoding="utf-8")
