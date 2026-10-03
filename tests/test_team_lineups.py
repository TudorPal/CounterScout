import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import pandas as pd
from backend.analysis.metrics import MetricsPipeline
from backend.config import settings


class TeamLineupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.roster = {"team1": {"name": "Alpha", "players": ["Same name"], "players_detailed": [{"steamid": "1"}]},
                       "team2": {"name": "Bravo", "players": ["Same name"], "players_detailed": [{"steamid": "2"}]}}
        (self.root / "match.roster.json").write_text(json.dumps(self.roster))
        self.patcher = patch.object(settings, "demo_dir", self.root)
        self.patcher.start()
        self.pipeline = MetricsPipeline(db_path=self.root / "test.db")
        base = dict(source_demo="match.dem", thrower_name="Same name", land_x=1, land_y=1, land_z=0,
                    throw_x=1, throw_y=1, throw_z=0, pitch=10, yaw=10, round_winner="T", utility_damage=0)
        rows = [dict(base, thrower_steamid="1", team_num=2, tick=100),
                dict(base, thrower_steamid="1", team_num=3, tick=200),
                dict(base, thrower_steamid="2", team_num=2, tick=300)]
        cluster = self.pipeline._clusterer._build_cluster(group=pd.DataFrame(rows), cluster_id=0,
                                                         map_name="de_inferno", grenade_type="smokegrenade")
        self.pipeline._persist_rankings(self.pipeline._clusterer.rank([cluster]))

    def tearDown(self):
        self.patcher.stop()
        self.temp.cleanup()

    def get(self, team, side=None):
        return self.pipeline.get_top_lineups(map_name="de_inferno", grenade_type="smokegrenade", team_name=team, side=side)

    def test_statistics_and_replay_are_team_specific(self):
        alpha = self.get("Alpha")[0].cluster
        bravo = self.get("Bravo")[0].cluster
        self.assertEqual((alpha.throw_count, alpha.round_win_rate), (2, 0.5))
        self.assertEqual((bravo.throw_count, bravo.round_win_rate, bravo.demo_tick), (1, 1.0, 300))
        self.assertEqual(alpha.cluster_id, bravo.cluster_id)
        self.assertEqual(self.pipeline.get_cluster_by_id(bravo.cluster_id, "de_inferno", "Bravo").demo_tick, 300)
        self.assertNotIn("throw_samples", alpha.model_dump())

    def test_side_filter_uses_individual_throw_not_cluster_majority(self):
        ct = self.get("Alpha", "CT")[0].cluster
        self.assertEqual((ct.throw_count, ct.demo_tick, ct.side), (1, 200, "CT"))
        self.assertEqual(ct.scope_side, "CT")
        self.assertEqual(self.pipeline.get_cluster_by_id(ct.cluster_id, "de_inferno", "Alpha", "CT").demo_tick, 200)

    def test_renaming_updates_without_reanalysis(self):
        self.roster["team1"]["name"] = "Renamed"
        (self.root / "match.roster.json").write_text(json.dumps(self.roster))
        self.assertEqual(self.get("Alpha"), [])
        self.assertEqual(self.get("Renamed")[0].cluster.throw_count, 2)
        self.assertTrue(self.pipeline.team_filter_ready("de_inferno"))
