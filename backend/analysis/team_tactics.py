"""Small, auditable team-only facts for tactical AI. No LLM guesses here."""
from __future__ import annotations

from bisect import bisect_right
from collections import Counter, defaultdict
import json
import math
import re
from pathlib import Path

from backend.analysis import callouts

EVIDENCE_VERSION = 2
BUYS = ("pistol", "eco", "force-buy", "full-buy", "mixed/unknown")
RIFLES = {"ak47", "m4a1", "m4a1silencer", "aug", "sg556", "awp", "scar20", "g3sg1", "galilar", "famas"}
PRIMARY = RIFLES | {"galilar", "famas", "mac10", "mp9", "mp7", "mp5sd", "ump45", "p90", "bizon", "nova", "xm1014", "mag7", "sawedoff", "negev", "m249", "ssg08"}
NADES = {"smokegrenade": "smoke", "flashbang": "flash", "hegrenade": "HE", "molotov": "fire", "incgrenade": "fire"}
RADARS = json.loads((Path(__file__).resolve().parents[1] / "data/radars/map-data.json").read_text(encoding="utf-8"))


def weapon_name(raw):
    value = re.sub(r"[^a-z0-9]", "", str(raw).lower().removeprefix("weapon_"))
    return {"m4a4": "m4a1", "m4a1s": "m4a1silencer", "sg553": "sg556"}.get(value, value)


def snapshot(samples, ticks, tick, start, rate):
    index = bisect_right(ticks, tick) - 1
    if index < 0:
        return None
    sample = samples[index]
    # Missing/disconnected slots cannot vote with a previous round's uniform.
    return sample if sample["t"] >= start and tick - sample["t"] <= rate * 2 else None


def roster_ids(bundle, roster, team_name):
    teams = [roster.get(k) for k in ("team1", "team2")]
    matches = [t for t in teams if t and t.get("name", "").strip().casefold() == team_name.strip().casefold()]
    if len(matches) != 1:
        raise ValueError("The selected team must match exactly one saved roster in every demo.")
    team = matches[0]
    ids = {str(p["steamid"]) for p in team.get("players_detailed", []) if p.get("steamid")}
    names = {n.strip().casefold() for n in team.get("players", [])}
    # IDs are authoritative when present; display names are not unique identities.
    result = {str(p["steamid"]) for p in bundle.get("players", [])
              if str(p["steamid"]) in ids or not ids and p.get("name", "").strip().casefold() in names}
    if not result:
        raise ValueError("No players from the saved team roster were found in the timeline.")
    return result


def buy_type(states, round_num):
    """MR12 regulation pistols + loadout estimates, scaled to present players."""
    if round_num in (1, 13):
        return "pistol"
    if not states or any(s.get("eq") is None or s.get("inv") is None for s in states):
        return "mixed/unknown"
    armed = [set(weapon_name(w) for w in s.get("inv", [])) for s in states]
    count = len(states)
    average = sum(s.get("eq", 0) for s in states) / count
    primaries = sum(bool(w & PRIMARY) for w in armed)
    full = sum(bool(w & RIFLES) and s.get("ar", 0) >= 50 for w, s in zip(armed, states))
    if full / count >= .8 and average >= 3500:
        return "full-buy"
    if average < 1500 and primaries / count <= .25:
        return "eco"
    # Do not label a healthy partial/saved buy a force: depleted cash + new spending.
    if all(s.get("cash") is not None and s.get("cs") is not None for s in states):
        average_cash = sum(s["cash"] for s in states) / count
        spent = sum(s["cs"] for s in states) / count
        if 1500 <= average < 3500 and average_cash < 1000 and spent >= 600:
            return "force-buy"
    return "mixed/unknown"


def location(map_name, x, y):
    # Valve place markers are tiny, not full zones. Nearest callout is approximate.
    entries = callouts._CALLOUTS.get(map_name, [])
    nearest = min(entries, key=lambda o: (o.x-x)**2 + (o.y-y)**2, default=None)
    if nearest and math.hypot(nearest.x-x, nearest.y-y) <= 600:
        return "near " + callouts.humanize(nearest.name)
    radar = RADARS.get(map_name)
    if radar and radar.get("scale"):
        gx = math.floor((x-radar["pos_x"]) / radar["scale"] / 128)
        gy = math.floor((radar["pos_y"]-y) / radar["scale"] / 128)
        if 0 <= gx < 8 and 0 <= gy < 8:
            return f"radar grid {chr(65+gx)}{gy+1}"
    return f"world ({round(x)}, {round(y)})"


def separated_players(frames):
    """Possible T lurks: sustained outlier from a compact group, not proven intent."""
    candidates = defaultdict(list)
    for seconds, members in frames:
        if len(members) < 4:
            continue
        groups = []
        for sid, sample in members.items():
            group = {other for other, point in members.items()
                     if math.hypot(sample["x"]-point["x"], sample["y"]-point["y"]) <= 600}
            groups.append(group)
        main = max(groups, key=len)
        if len(main) < 3:
            continue
        center = (sum(members[s]["x"] for s in main)/len(main), sum(members[s]["y"] for s in main)/len(main))
        for sid, point in members.items():
            if sid not in main and math.hypot(point["x"]-center[0], point["y"]-center[1]) >= 1200:
                candidates[sid].append(seconds)
    return {sid: times for sid, times in candidates.items() if len(times) >= 2 and max(times)-min(times) >= 10}


def extract_demo(bundle, roster, team_name, demo_file):
    ids = roster_ids(bundle, roster, team_name)
    names = {str(p["steamid"]): p.get("name", "Unknown")[:60] for p in bundle["players"] if str(p["steamid"]) in ids}
    positions = {sid: bundle.get("positions", {}).get(sid, []) for sid in ids}
    ticks = {sid: [s["t"] for s in samples] for sid, samples in positions.items()}
    rate = bundle.get("tick_rate") or 64
    map_name = bundle.get("map_name", "unknown")
    result, skipped = [], 0
    for round_data in bundle.get("rounds", []):
        start, end = round_data["start_tick"], round_data["end_tick"]
        anchor = round_data.get("freeze_end_tick")
        if anchor is None:
            anchor = min(start + 5*rate, end)
        states = {sid: snapshot(positions[sid], ticks[sid], anchor, start, rate) for sid in ids}
        votes = Counter(s.get("tn") for s in states.values() if s and s.get("tn") in (2, 3))
        if votes[2] == votes[3]:
            skipped += 1
            continue
        side_num = 2 if votes[2] > votes[3] else 3
        side = "T" if side_num == 2 else "CT"
        active = {sid: s for sid, s in states.items() if s and s.get("tn") == side_num and s.get("alive", False)}
        if not active:
            skipped += 1
            continue
        buy = buy_type(list(active.values()), round_data["num"])
        plants = [e for e in bundle.get("events", []) if e["type"] == "bomb_plant" and start <= e["tick"] <= end]
        plant = plants[0] if plants else None
        site = plant.get("data", {}).get("site", "unknown").upper() if plant else "none"
        if plant and site not in ("A", "B"):
            site = "unknown"
        routes = {sid: [] for sid in active}
        frames = []
        for seconds in (10, 20, 35, 50):
            tick = anchor + rate*seconds
            if tick > end or plant and tick >= plant["tick"]:
                break
            frame = {}
            for sid in active:
                point = snapshot(positions[sid], ticks[sid], tick, start, rate)
                if point and point.get("alive") and point.get("tn") == side_num:
                    frame[sid] = point
                    routes[sid].append({"seconds": seconds, "location": location(map_name, point["x"], point["y"])})
            frames.append((seconds, frame))
        lurks = separated_players(frames) if side == "T" else {}
        utility = []
        for nade in bundle.get("grenades", []):
            points = nade.get("points", [])
            if nade.get("thrower") not in ids or not points or not start <= points[0][0] <= end:
                continue
            if nade.get("type") not in NADES:
                continue
            _, x, y = points[-1][:3]
            utility.append({"type": NADES[nade["type"]], "player": names[nade["thrower"]],
                            "seconds": round((points[0][0]-anchor)/rate, 1),
                            "from": location(map_name, points[0][1], points[0][2]),
                            "to": location(map_name, x, y), "landing": [x, y],
                            "phase": "postplant" if plant and points[0][0] >= plant["tick"] else "preplant"})
        result.append({"id": f"{demo_file}:R{round_data['num']}", "demo_file": demo_file,
                       "round": round_data["num"], "side": side, "buy": buy, "active_players": len(active),
                       "won": round_data.get("winner") == side, "planted_site": site,
                       "plant_seconds": round((plant["tick"]-anchor)/rate, 1) if plant else None,
                       "equipment": sum(s.get("eq", 0) for s in active.values()),
                       "routes": [{"player": names[sid], "samples": samples} for sid, samples in routes.items()],
                       "possible_lurks": [{"player": names[sid], "separated_at_seconds": times} for sid, times in lurks.items()],
                       "utility": utility})
    return result, skipped


def common_utility(rounds):
    clusters = []
    for record in rounds:
        for nade in record["utility"]:
            if nade["type"] not in ("smoke", "flash"):
                continue
            x, y = nade["landing"]
            cluster = next((c for c in clusters if c["type"] == nade["type"] and math.hypot(x-c["x"], y-c["y"]) <= 300), None)
            if cluster is None:
                cluster = {"type": nade["type"], "location": nade["to"], "x": x, "y": y, "throws": 0, "refs": set(), "players": set()}
                clusters.append(cluster)
            count = cluster["throws"]
            cluster["x"], cluster["y"] = (cluster["x"]*count+x)/(count+1), (cluster["y"]*count+y)/(count+1)
            cluster["throws"] += 1
            cluster["refs"].add(record["id"])
            cluster["players"].add(nade["player"])
    return [{"type": c["type"], "location": c["location"], "throws": c["throws"], "rounds": len(c["refs"]),
             "players": sorted(c["players"]), "round_refs": sorted(c["refs"])[:3]}
            for c in sorted(clusters, key=lambda c: (-len(c["refs"]), -c["throws"]))[:8]]


def build_evidence(sources, team_name, map_name):
    rounds, skipped, count = [], 0, 0
    for demo_file, bundle, roster in sources:
        count += 1
        if bundle.get("map_name") != map_name:
            raise ValueError("All selected demos must be on the requested map.")
        records, missing = extract_demo(bundle, roster, team_name, demo_file)
        rounds.extend(records)
        skipped += missing
    if not rounds:
        raise ValueError("No rounds with an identifiable team side were found.")
    groups = []
    for side in ("T", "CT"):
        for buy in BUYS:
            selected = [r for r in rounds if r["side"] == side and r["buy"] == buy]
            if selected:
                groups.append({"side": side, "buy": buy, "rounds": len(selected), "wins": sum(r["won"] for r in selected),
                               "planted_sites": dict(Counter(r["planted_site"] for r in selected)),
                               "common_utility": common_utility(selected), "round_refs": [r["id"] for r in selected]})
    return {"version": EVIDENCE_VERSION, "team": team_name, "map": map_name, "demos": count,
            "rounds": rounds, "groups": groups, "skipped_rounds": skipped,
            "limitations": ["Buy labels are MR12 regulation/loadout estimates; partial buys remain mixed/unknown.",
                            "Routes sample alive players at 10, 20, 35 and 50 seconds after freeze ends, until plant/end.",
                            "Site counts record the actual planted site, not every attempted hit; no plant is not a site hit.",
                            "Callouts are approximate nearest markers; radar grid A1-H8 is used where markers are unavailable.",
                            "Possible lurks mean sustained separation from at least three teammates, not proven intent.",
                            "Only the selected team's players and throws are included; disconnected slots are excluded."]}


def prompt_evidence(evidence, budget=11000):
    """All group totals + diverse example rounds fit the free-tier token budget."""
    records = {r["id"]: r for r in evidence["rounds"]}
    digest = {k: evidence[k] for k in ("team", "map", "demos", "skipped_rounds", "limitations")}
    digest["groups"] = []
    for group in evidence["groups"]:
        g = {k: group[k] for k in ("side", "buy", "rounds", "wins", "planted_sites")}
        g["common_utility"] = [{k: u[k] for k in ("type", "location", "throws", "rounds")} for u in group["common_utility"][:4]]
        g["examples"] = []
        digest["groups"].append(g)
    available = []
    # Prefer tactical examples with utility/lurk observations, but totals use ALL rounds.
    for example_index in range(2):
        for group, target in zip(evidence["groups"], digest["groups"]):
            candidates = sorted((records[ref] for ref in group["round_refs"]), key=lambda r: (-bool(r["possible_lurks"]), -len(r["utility"]), r["id"]))
            if example_index >= len(candidates):
                continue
            r = candidates[example_index]
            example = {k: r[k] for k in ("id", "active_players", "won", "planted_site", "possible_lurks")}
            example["routes"] = [route["player"]+": "+" > ".join(f"{s['seconds']}s {s['location']}" for s in route["samples"]) for route in r["routes"]]
            example["utility"] = [f"{u['seconds']}s {u['player']} {u['type']}: {u['from']} > {u['to']} ({u['phase']})" for u in r["utility"][:10]]
            target["examples"].append(example)
            if len(json.dumps(digest, ensure_ascii=False, separators=(",", ":"))) > budget:
                target["examples"].pop()
            else:
                available.append(r["id"])
    digest["coverage"] = "Group totals include every eligible round; examples are a bounded selection, not the full game."
    return digest, available
