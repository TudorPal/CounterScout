"""Regressions for older FACEIT events and completed pipeline failures.

Run with .venv's Python: python -m unittest discover -s tests -v
"""
import asyncio
import unittest
from unittest.mock import Mock, patch

import httpx
import pandas as pd

from backend.ingestion.demo_parser import DemoParser
from backend import main


class GrenadeEventTests(unittest.TestCase):
    def setUp(self):
        self.parser = DemoParser()
        self.events = pd.DataFrame([
            {"tick": 100, "weapon": "weapon_smokegrenade", "user_steamid": "1", "user_name": "Player"},
            {"tick": 200, "weapon": "weapon_incgrenade", "user_steamid": "1", "user_name": "Player"},
            {"tick": 300, "weapon": "weapon_ak47", "user_steamid": "1", "user_name": "Player"},
        ])

    def test_faceit_without_grenade_thrown_uses_weapon_fire(self):
        source = Mock()
        source.parse_event.side_effect = lambda event, **_: [] if event == "grenade_thrown" else self.events
        throws = self.parser._extract_grenade_throws(source)
        self.assertEqual(throws.grenade_type.tolist(), ["smokegrenade", "molotov"])
        self.assertEqual(throws.tick.tolist(), [100, 200])

    def test_dedicated_grenade_events_are_not_double_counted(self):
        source = Mock()
        source.parse_event.return_value = self.events.iloc[:1]
        throws = self.parser._extract_grenade_throws(source)
        self.assertEqual(len(throws), 1)
        self.assertEqual(source.parse_event.call_count, 1)
        self.assertEqual(source.parse_event.call_args.args[0], "grenade_thrown")

    def test_prefixed_utility_damage_is_recognized(self):
        source = Mock()
        source.parse_event.return_value = pd.DataFrame([
            {"tick": 110, "weapon": "weapon_hegrenade", "attacker_steamid": "1", "dmg_health": 42},
            {"tick": 120, "weapon": "weapon_ak47", "attacker_steamid": "1", "dmg_health": 20},
        ])
        damage = self.parser._extract_utility_damage(source)
        self.assertEqual(damage.grenade_type.tolist(), ["hegrenade"])
        self.assertEqual(damage.dmg_health.tolist(), [42])


class PipelineStatusTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_button_request_remains_visible_after_completion(self):
        saved_state = dict(main._ingest_state)
        try:
            main._ingest_state.update(running=False, phase="idle", message="", run_id=0, last_completed_run_id=0)
            with patch.object(main._pipeline, "run", side_effect=RuntimeError("Cannot parse Inferno demo")):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
                    queued = await client.post("/api/ingest/run", json={"map_name": "de_inferno", "clear_existing": True})
                    self.assertEqual(queued.status_code, 200)
                    run_id = queued.json()["run_id"]
                    for _ in range(100):
                        status = (await client.get("/api/ingest/status")).json()
                        if status["last_completed_run_id"] >= run_id:
                            break
                        await asyncio.sleep(0.01)
                    self.assertEqual(status["last_completed_run_id"], run_id)
                    self.assertFalse(status["running"])
                    self.assertEqual(status["phase"], "error")
                    self.assertEqual(status["message"], "Cannot parse Inferno demo")
                    self.assertTrue(status["status"].startswith("error:"))
        finally:
            main._ingest_state.clear()
            main._ingest_state.update(saved_state)


if __name__ == "__main__":
    unittest.main()
