"""Resolve throws against the roster of their source demo, not current sides."""
import json
from pathlib import Path
from backend.config import settings


def sample_belongs_to_team(sample: dict, team_name: str, cache: dict) -> bool:
    demo = str(sample.get("source_demo") or "")
    if demo not in cache:
        stem = Path(demo).stem
        match = stem.split("_")[0]
        path = settings.demo_dir / f"{match if match.isdigit() else stem}.roster.json"
        try:
            cache[demo] = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            cache[demo] = {}
    sid = str(sample.get("thrower_steamid") or "")
    name = str(sample.get("thrower_name") or "").casefold()
    for key in ("team1", "team2"):
        team = cache[demo].get(key) or {}
        if str(team.get("name") or "").casefold() != team_name.casefold():
            continue
        ids = {str(p.get("steamid")) for p in team.get("players_detailed", []) if p.get("steamid")}
        if ids:
            return sid in ids
        return bool(name) and name in {str(p).casefold() for p in team.get("players", [])}
    return False
