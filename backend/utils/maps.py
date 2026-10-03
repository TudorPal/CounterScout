"""Canonical CS2 map tokens used across filenames, demo headers and storage."""
from __future__ import annotations

import re
from typing import Optional


KNOWN_MAPS = {
    "de_ancient", "de_anubis", "de_cache", "de_dust2", "de_inferno",
    "de_mirage", "de_nuke", "de_overpass", "de_train", "de_vertigo",
}


def canonical_map_name(value: Optional[str]) -> str:
    """Normalize a map token while preserving real digits such as Dust II.

    Local demo naming often adds a series number (``Inferno1`` / ``Cache1``).
    Strip only that trailing number when the remaining name is a known map.
    """
    raw = str(value or "").strip().lower()
    if not raw or raw == "unknown":
        return "unknown"
    if not raw.startswith(("de_", "cs_", "ar_")):
        raw = f"de_{raw}"
    if raw in KNOWN_MAPS:
        return raw
    match = re.fullmatch(r"(.+?)(\d+)", raw)
    if match and match.group(1) in KNOWN_MAPS:
        return match.group(1)
    return raw
