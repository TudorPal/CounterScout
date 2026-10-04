import gzip
import json
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import zstandard
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.config import settings
from backend.ingestion.faceit_bridge import BridgeStore, download_path, install_faceit_bridge, normalize_match, team_url, unpack_demo

TEAM = "caf177f0-ef92-498c-9097-53a02409a800"
MATCH = "1-e53c7d0e-5bf2-419d-abba-3ee4e410732a"
PREFIX = "/api/ingest/faceit/bridge"


def metadata():
    return {"payload": {"id": MATCH, "game": "cs2", "status": "FINISHED", "finished_at": 1791039510,
            "teams": {"faction1": {"id": TEAM, "name": "Transpiratii", "roster": [{"nickname": "RRasda_", "game_player_id": "76561198000000001"}]},
                      "faction2": {"id": "c3ff17c3-603d-45f7-9144-533b02001b90", "name": "Panico eSports", "roster": [{"nickname": "Turtles"}]}},
            "results": {"score": {"faction1": 0, "faction2": 2}},
            "voting": {"map": {"pick": ["de_cache", "de_ancient"]}}}}


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.downloads = self.root / "Downloads"
        self.downloads.mkdir()
        self.demo_dir = self.root / "demos"
        self.demo_dir.mkdir()
        self.store = BridgeStore(self.root / "bridge.db")
        with self.store.connect() as db:
            db.execute("INSERT INTO config VALUES ('downloads_dir',?)", (str(self.downloads),))
        self.uploads = []

        async def upload(**kwargs):
            self.uploads.append(kwargs)
            (self.demo_dir / kwargs["file"].filename).write_bytes(await kwargs["file"].read())
            return SimpleNamespace(demo_file=kwargs["file"].filename)

        app = FastAPI()
        install_faceit_bridge(app, upload, self.store)
        self.app = app
        self.client = self.enterContext(TestClient(app, base_url="http://localhost", client=("127.0.0.1", 50000)))
        self.enterContext(patch.object(settings, "demo_dir", self.demo_dir))
        self.headers = {"Authorization": "Bearer " + self.store.config()["token"], "X-CS2-Bridge-Version": "0.2.2"}

    def post(self, path, data):
        return self.client.post(PREFIX + path, json=data, headers=self.headers)

    def demo(self, name, contents=b"PBDEMS2\x00demo"):
        path = self.downloads / name
        path.write_bytes(gzip.compress(contents) if name.endswith(".gz") else contents)
        return path

    def test_team_url_and_public_metadata(self):
        self.assertEqual(team_url(f"https://www.faceit.com/en/teams/{TEAM}")[1], f"https://www.faceit.com/en/teams/{TEAM}/stats")
        for url in (f"http://www.faceit.com/teams/{TEAM}", f"https://evil.test/teams/{TEAM}", "https://www.faceit.com/en/players/a"):
            with self.assertRaises(ValueError):
                team_url(url)
        match = normalize_match(metadata())
        self.assertEqual(match["maps"], ["de_cache", "de_ancient"])
        self.assertIsNone(match["map_name"], "A series must not masquerade as its first map")
        self.assertEqual(match["team1"]["score"], 0)
        self.assertEqual(match["team1"]["steamids"], ["76561198000000001"])

    def test_reviewed_names_survive_resync_and_are_used_for_download_import(self):
        self.post("/matches", {"team_id": TEAM, "matches": [metadata()],
                  "reviewed_names": {MATCH: {"faction1": "My reviewed team"}}})
        self.post("/matches", {"team_id": TEAM, "matches": [metadata()]})
        library = self.client.get(PREFIX + "/library").json()
        self.assertEqual(library["matches"][0]["team1"]["name"], "My reviewed team")
        self.assertEqual(library["matches"][0]["team2"]["name"], "Panico eSports")
        path = self.demo("reviewed.dem")
        result = self.post("/imports", {"match_id": MATCH, "path": str(path), "metadata": metadata()})
        self.assertEqual(result.status_code, 202)
        uploaded = json.loads(self.uploads[-1]["faceit_metadata"])
        self.assertEqual(uploaded["team1"]["name"], "My reviewed team")
        self.assertEqual(uploaded["team2"]["name"], "Panico eSports")

    def test_reviewed_alias_follows_roster_swap_and_rejects_invalid_names(self):
        self.post("/matches", {"team_id": TEAM, "matches": [metadata()],
                  "reviewed_names": {MATCH: {"faction1": "Reviewed"}}})
        swapped = metadata()
        teams = swapped["payload"]["teams"]
        teams["faction1"], teams["faction2"] = teams["faction2"], teams["faction1"]
        self.post("/matches", {"team_id": TEAM, "matches": [swapped]})
        value = self.client.get(PREFIX + "/library").json()["matches"][0]
        self.assertEqual(value["team2"]["name"], "Reviewed")
        self.assertEqual(value["team1"]["name"], "Panico eSports")
        for names in ({"faction1": " "}, {"faction1": "x" * 81}, {"faction1": "Same", "faction2": "same"}):
            self.assertEqual(self.post("/matches", {"team_id": TEAM, "matches": [metadata()], "reviewed_names": {MATCH: names}}).status_code, 422)

    def test_token_origin_hostname_and_loopback_guards(self):
        self.assertEqual(self.client.get(PREFIX + "/commands").status_code, 401)
        self.assertEqual(self.client.get(PREFIX + "/setup", headers={"Origin": "https://evil.test"}).status_code, 403)
        self.assertEqual(self.client.get(PREFIX + "/setup", headers={"Host": "evil.test"}).status_code, 403)
        with TestClient(self.app, base_url="http://localhost", client=("192.0.2.1", 50000)) as remote:
            self.assertEqual(remote.get(PREFIX + "/setup").status_code, 403)

    def test_team_queue_claim_and_sync_only_matching_cs2_games(self):
        response = self.client.post(PREFIX + "/teams", json={"team_url": f"https://www.faceit.com/en/teams/{TEAM}"})
        self.assertEqual(response.status_code, 200)
        repeated = self.client.post(PREFIX + "/teams", json={"team_url": f"https://www.faceit.com/en/teams/{TEAM}"})
        self.assertEqual(repeated.json()["command_id"], response.json()["command_id"], "Repeated fetches don't queue duplicate commands")
        command = self.client.get(PREFIX + "/commands", headers=self.headers).json()["command"]
        self.assertEqual(command["team_id"], TEAM)
        self.assertIsNone(self.client.get(PREFIX + "/commands", headers=self.headers).json()["command"])
        self.assertEqual(self.post("/matches", {"team_id": TEAM, "command_id": command["id"], "matches": [metadata()]}).json()["saved"], 1)
        other = metadata()
        other["payload"]["teams"]["faction1"]["id"] = "different-team"
        self.assertEqual(self.post("/matches", {"team_id": TEAM, "matches": [other]}).json()["saved"], 0)
        other = metadata()
        other["payload"]["game"] = "valorant"
        self.assertEqual(self.post("/matches", {"team_id": TEAM, "matches": [other]}).json()["saved"], 0)
        library = self.client.get(PREFIX + "/library").json()
        self.assertEqual(library["commands"][0]["state"], "done")
        self.assertEqual(library["matches"][0]["team1"]["name"], "Transpiratii")

    def test_bo3_both_demos_import_and_duplicates_preserve_names(self):
        first = self.demo("cache.dem.gz", b"PBDEMS2\x00cache")
        second = self.demo("ancient.dem.gz", b"PBDEMS2\x00ancient")
        for path in (first, second):
            self.assertEqual(self.post("/imports", {"path": str(path), "match_id": MATCH, "metadata": metadata()}).status_code, 202)
        self.assertEqual(len(self.uploads), 2)
        self.assertNotEqual(self.uploads[0]["file"].filename, self.uploads[1]["file"].filename)
        supplied = json.loads(self.uploads[0]["faceit_metadata"])
        self.assertEqual(supplied["team1"]["name"], "Transpiratii")
        self.assertTrue(first.exists(), "The user's downloaded archive is preserved")
        # Same downloaded file, then another Chrome filename for identical bytes.
        duplicate = self.demo("cache (1).dem.gz", b"PBDEMS2\x00cache")
        for path in (first, duplicate):
            self.assertEqual(self.post("/imports", {"path": str(path), "match_id": MATCH, "metadata": metadata()}).status_code, 202)
        self.assertEqual(len(self.uploads), 2, "Duplicates must not re-upload or reset team names")
        self.assertTrue(all(j["state"] == "done" for j in self.client.get(PREFIX + "/library").json()["imports"]))

    def test_name_lookup_reuses_known_team_and_searches_unknown_names(self):
        self.post("/matches", {"team_id": TEAM, "matches": [metadata()]})
        response = self.client.post(PREFIX + "/teams", json={"team_url": " transpiratii "})
        self.assertEqual(response.json()["team_id"], TEAM)
        self.assertEqual(self.store.claim()["kind"], "team")
        response = self.client.post(PREFIX + "/teams", json={"team_url": "Unknown team"})
        self.assertIsNone(response.json()["team_id"])
        command = self.store.claim()
        self.assertEqual(command["kind"], "search")
        found = [{"id": TEAM, "name": "Transpiratii", "members": 5, "token": "secret", "url": "https://evil.test"},
                 {"id": "556c62be-5c60-4dd1-90ae-fcf7827136d1", "name": "Transpiratii", "game": "cs2"},
                 {"id": "invalid", "name": "Bad"}]
        self.assertEqual(self.client.post(PREFIX + "/search-results", json={"command_id": command["id"], "teams": found}).status_code, 401)
        self.assertEqual(self.post("/search-results", {"command_id": command["id"], "teams": found}).json()["saved"], 2)
        result = self.client.get(PREFIX + "/library").json()["commands"][0]
        self.assertEqual(result["state"], "done")
        self.assertEqual(len(result["results"]), 2, "Duplicate names require explicit team selection")
        self.assertNotIn("secret", json.dumps(result))
        self.assertTrue(result["results"][0]["url"].startswith("https://www.faceit.com/en/teams/"))
        # Once the second same-named team is known, don't guess between them.
        another = metadata()
        another["payload"]["id"] = "1-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
        another["payload"]["teams"]["faction1"]["id"] = found[1]["id"]
        self.post("/matches", {"team_id": found[1]["id"], "matches": [another]})
        self.assertIsNone(self.client.post(PREFIX + "/teams", json={"team_url": "Transpiratii"}).json()["team_id"])
        self.assertEqual(self.client.post(PREFIX + "/teams", json={"team_url": "a"}).status_code, 400)

    def test_download_commands_only_allow_library_matches_and_report_results(self):
        self.assertEqual(self.client.post(PREFIX + "/downloads", json={"match_id": MATCH}).status_code, 404)
        self.post("/matches", {"team_id": TEAM, "matches": [metadata()]})
        response = self.client.post(PREFIX + "/downloads", json={"match_id": MATCH})
        repeated = self.client.post(PREFIX + "/downloads", json={"match_id": MATCH})
        self.assertEqual(response.json(), repeated.json())
        command = self.store.claim()
        self.assertEqual(command["kind"], "download")
        self.assertEqual(command["url"], f"https://www.faceit.com/en/cs2/room/{MATCH}")
        self.post("/command-result", {"command_id": command["id"], "download_count": 2})
        result = self.client.get(PREFIX + "/library").json()["commands"][0]
        self.assertEqual((result["state"], result["download_count"]), ("done", 2))
        self.assertNotIn("demo_url", result)
        again = self.client.post(PREFIX + "/downloads", json={"match_id": MATCH}).json()
        self.post("/command-result", {"command_id": again["command_id"], "error": "FACEIT unavailable"})
        self.assertEqual(self.client.get(PREFIX + "/library").json()["commands"][0]["error"], "FACEIT unavailable")
        self.assertEqual(self.post("/command-result", {"command_id": "unknown", "download_count": 1}).status_code, 400)

    def test_import_failure_is_visible_and_download_survives(self):
        invalid = self.demo("invalid.dem", b"not a demo")
        self.post("/imports", {"path": str(invalid), "match_id": MATCH, "metadata": metadata()})
        job = self.client.get(PREFIX + "/library").json()["imports"][0]
        self.assertEqual(job["state"], "error")
        self.assertIn("not a valid CS2 demo", job["error"])
        self.assertEqual(len(self.uploads), 0)
        self.assertTrue(invalid.exists())

    def test_legacy_extension_cannot_claim_unsupported_commands(self):
        self.post("/matches", {"team_id": TEAM, "matches": [metadata()]})
        pending = self.client.post(PREFIX + "/downloads", json={"match_id": MATCH}).json()["command_id"]
        legacy = {"Authorization": self.headers["Authorization"]}
        self.assertIsNone(self.client.get(PREFIX + "/commands", headers=legacy).json()["command"])
        self.assertFalse(self.client.get(PREFIX + "/setup").json()["automation_ready"])
        self.assertEqual(self.client.post(PREFIX + "/downloads", json={"match_id": MATCH}).status_code, 409)
        self.assertEqual(self.client.post(PREFIX + "/teams", json={"team_url": "Unknown team"}).status_code, 409)
        self.assertEqual(self.client.get(PREFIX + "/commands", headers=self.headers).json()["command"]["id"], pending)
        self.assertTrue(self.client.get(PREFIX + "/setup").json()["automation_ready"])

    def test_later_manual_import_resolves_old_failure_and_late_error(self):
        identifier = self.store.queue({"kind": "download", "match_id": MATCH})
        self.store.claim()
        self.post("/command-result", {"command_id": identifier, "error": "Extension stopped"})
        path = self.demo("manual.dem")
        self.post("/imports", {"path": str(path), "match_id": MATCH, "metadata": metadata()})
        result = self.client.get(PREFIX + "/library").json()["commands"][0]
        self.assertEqual(result["state"], "done")
        self.assertIsNone(result["error"])
        self.assertTrue(result["resolved_by_import"])
        self.post("/command-result", {"command_id": identifier, "error": "Delayed failure"})
        self.assertIsNone(self.client.get(PREFIX + "/library").json()["commands"][0]["error"])
        # A later failed re-download must not be healed by an older import.
        retry = self.store.queue({"kind": "download", "match_id": MATCH})
        self.post("/command-result", {"command_id": retry, "error": "New failure"})
        self.assertEqual(self.client.get(PREFIX + "/library").json()["commands"][0]["error"], "New failure")

    def test_series_partial_import_does_not_claim_complete(self):
        identifier = self.store.queue({"kind": "download", "match_id": MATCH})
        self.store.claim()
        self.post("/command-result", {"command_id": identifier, "expected_count": 2, "download_count": 1, "error": "Second download failed"})
        for index in (1, 2):
            path = self.demo(f"map{index}.dem", b"PBDEMS2\x00" + bytes([index]))
            self.post("/imports", {"path": str(path), "match_id": MATCH, "metadata": metadata()})
            result = self.client.get(PREFIX + "/library").json()["commands"][0]
            self.assertEqual(result["state"], "error" if index == 1 else "done")

    def test_progress_keeps_command_live_and_stalled_download_expires(self):
        identifier = self.store.queue({"kind": "download", "match_id": MATCH})
        command = self.store.claim()
        with self.store.connect() as db:
            db.execute("UPDATE commands SET updated=? WHERE id=?", (time.time() - 100, identifier))
        self.post("/progress", {"command_id": identifier, "stage": "reading_demo_links", "expected_count": 2})
        result = self.client.get(PREFIX + "/library").json()["commands"][0]
        self.assertEqual((result["state"], result["stage"]), ("running", "reading_demo_links"))
        self.assertEqual(self.store.queue({"kind": "download", "match_id": MATCH}), command["id"], "Progress does not break queue deduplication")
        with self.store.connect() as db:
            db.execute("UPDATE commands SET updated=? WHERE id=?", (time.time() - 100, identifier))
        result = self.client.get(PREFIX + "/library").json()["commands"][0]
        self.assertEqual(result["state"], "error")
        self.assertIn("Reload", result["error"])

    def test_paths_and_metadata_are_validated_before_queueing(self):
        outside = self.root / "outside.dem"
        outside.write_bytes(b"PBDEMS2\x00")
        self.assertEqual(self.post("/imports", {"path": str(outside), "match_id": MATCH, "metadata": metadata()}).status_code, 400)
        wrong = metadata()
        wrong["payload"]["id"] = TEAM
        inside = self.demo("inside.dem")
        self.assertEqual(self.post("/imports", {"path": str(inside), "match_id": MATCH, "metadata": wrong}).status_code, 400)
        self.assertEqual(self.client.get(PREFIX + "/library").json()["imports"], [])
        with self.assertRaises(ValueError):
            download_path(self.downloads, str(outside))

    def test_compression_formats_and_expansion_limit(self):
        content = b"PBDEMS2\x00" + b"x" * 2000
        for name, compressed in (("a.dem.gz", gzip.compress(content)), ("a.dem.zst", zstandard.ZstdCompressor().compress(content))):
            path = self.downloads / name
            path.write_bytes(compressed)
            target = self.root / "unpacked.dem"
            self.assertEqual(len(unpack_demo(path, target, 4096)), 64)
            self.assertEqual(target.read_bytes(), content)
            with self.assertRaisesRegex(ValueError, "Expanded demo"):
                unpack_demo(path, target, 1000)

    def test_restart_turns_interrupted_jobs_into_actionable_errors(self):
        with self.store.connect() as db:
            db.execute("INSERT INTO imports (id,match_id,state,created) VALUES ('interrupted',?,'importing',0)", (MATCH,))
        self.store.recover()
        job = self.client.get(PREFIX + "/library").json()["imports"][0]
        self.assertEqual(job["state"], "error")
        self.assertIn("Backend restarted", job["error"])


class FaceitRosterTests(unittest.TestCase):
    def test_steamids_match_names_to_correct_roster_even_with_changed_handles_and_sides(self):
        from backend.main import _build_local_roster
        timeline = {"map_name": "de_cache", "rounds": [{"start_tick": 0, "freeze_end_tick": 100}],
                    "players": [{"steamid": "76561198000000001", "name": "newSteamHandle", "team_num": 2},
                                {"steamid": "76561198000000002", "name": "Enemy", "team_num": 3}],
                    "positions": {"76561198000000001": [{"t": 100, "tn": 3}], "76561198000000002": [{"t": 100, "tn": 2}]}}
        roster = _build_local_roster("faceit.dem", timeline, "Transpiratii", "Opponent", ["oldFaceitHandle"], ["Enemy"],
                                     ["76561198000000001"], ["76561198000000002"])
        self.assertEqual(roster["team1"]["name"], "Opponent")
        self.assertEqual(roster["team2"]["name"], "Transpiratii")
        self.assertEqual(roster["team2"]["players"], ["newSteamHandle"])

    def test_unmatched_roster_keeps_generated_team_name(self):
        from backend.main import _build_local_roster
        timeline = {"map_name": "de_cache", "rounds": [{"start_tick": 0, "freeze_end_tick": 100}],
                    "players": [{"steamid": "1", "name": "PlayerA", "team_num": 2}, {"steamid": "2", "name": "PlayerB", "team_num": 3}],
                    "positions": {"1": [{"t": 100, "tn": 2}], "2": [{"t": 100, "tn": 3}]}}
        roster = _build_local_roster("faceit.dem", timeline, "Unknown", "Known", ["NotInDemo"], ["PlayerB"])
        self.assertEqual(roster["team1"]["name"], "PlayerA's team")
        self.assertEqual(roster["team2"]["name"], "Known")


if __name__ == "__main__":
    unittest.main()
