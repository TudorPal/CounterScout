import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import pandas as pd

from backend.ingestion.demo_parser import (
    DemoParser, TIMELINE_CACHE_VERSION, _build_played_rounds,
    _is_opening_knife_round, extract_match_timeline,
)


def death(tick, weapon):
    return {"type": "death", "tick": tick, "data": {"weapon": weapon}}


class KnifeRoundTests(unittest.TestCase):
    def setUp(self):
        # Opening events reproduced from the reported FACEIT Mirage demo.
        self.starts = [0, 4374, 6313, 6387, 12614]
        self.freezes = [1279, 4501, 8083, 13894]
        self.ends = [{"tick": 4213, "winner": "T"},
                     {"tick": 12166, "winner": "CT"},
                     {"tick": 19580, "winner": "CT"}]
        self.events = [death(t, w) for t, w in zip(
            [2806, 2839, 2980, 3257, 4188, 4213],
            ["knife_push", "bayonet", "bayonet", "knife_widowmaker",
             "knife_widowmaker", "knife_skeleton"])]
        self.events += [death(5502, "ak47"), death(9568, "usp_silencer")]

    def test_bayonet_and_prefixed_variants_are_knives(self):
        r = {"start_tick": 0, "end_tick": 4213}
        self.assertTrue(_is_opening_knife_round(r, self.events))
        self.assertTrue(_is_opening_knife_round(r, [death(t, "weapon_bayonet") for t in [1, 2, 3]]))

    def test_mixed_pistol_or_too_few_knife_kills_are_not_removed(self):
        r = {"start_tick": 0, "end_tick": 4213}
        self.assertFalse(_is_opening_knife_round(r, self.events + [death(4000, "glock")]))
        self.assertFalse(_is_opening_knife_round(r, self.events[:2]))

    def test_tick_zero_knife_and_restart_gap_are_removed(self):
        rounds, cutoff = _build_played_rounds(self.starts, self.freezes, self.ends, self.events)
        self.assertEqual(cutoff, 6386)
        self.assertEqual(rounds[0], {"num": 1, "start_tick": 6387,
                                     "freeze_end_tick": 8083, "end_tick": 12166, "winner": "CT"})
        self.assertEqual([r["num"] for r in rounds], [1, 2])

    def test_ordinary_match_and_missing_starts_preserve_completed_rounds(self):
        for starts in ([0, 4374, 12614], []):
            rounds, cutoff = _build_played_rounds(starts, self.freezes, self.ends,
                                                  [death(2806, "glock")])
            self.assertEqual(cutoff, 0)
            self.assertEqual(len(rounds), 3)
            self.assertEqual(rounds[0]["freeze_end_tick"], 1279)
            self.assertEqual(rounds[-1]["winner"], "CT")

    def parser(self):
        parser = Mock()
        parser.parse_header.return_value = {"map_name": "de_mirage"}
        parser.parse_player_info.return_value = [{"steamid": "123", "name": "Player"}]
        parser.parse_ticks.return_value = pd.DataFrame({
            "tick": [1280, 5000, 6392, 8088, 12160, 13896, 19576],
            "steamid": ["123"] * 7, "name": ["Player"] * 7,
            "team_num": [2, 3, 3, 3, 3, 3, 3], "X": [1.] * 7, "Y": [2.] * 7,
        })
        frames = {
            "round_start": pd.DataFrame({"tick": self.starts}),
            "round_freeze_end": pd.DataFrame({"tick": self.freezes}),
            "round_end": pd.DataFrame([{"tick": 0, "winner": float("nan"), "round": 0}] +
                [dict(r, round=i + 1) for i, r in enumerate(self.ends)]),
            "player_death": pd.DataFrame([{"tick": e["tick"], "weapon": e["data"]["weapon"]}
                                           for e in self.events]),
        }
        parser.parse_event.side_effect = lambda n: frames.get(n, pd.DataFrame())
        parser.parse_grenades.return_value = pd.DataFrame({
            "grenade_type": ["CSmokeGrenade"] * 4, "grenade_entity_id": [1, 1, 2, 2],
            "tick": [5000, 5008, 9000, 9008], "x": [1., 2., 3., 4.],
            "y": [1., 2., 3., 4.], "steamid": ["123"] * 4,
        })
        return parser

    def test_full_timeline_trims_positions_events_and_projectiles(self):
        with patch("demoparser2.DemoParser", return_value=self.parser()):
            bundle = extract_match_timeline(Path("test.dem"))
        self.assertEqual(bundle["cache_version"], TIMELINE_CACHE_VERSION)
        self.assertEqual(bundle["rounds"][0]["num"], 1)
        self.assertTrue(all(s["t"] >= 6387 for s in bundle["positions"]["123"]))
        self.assertTrue(all(e["tick"] >= 6387 for e in bundle["events"]))
        self.assertEqual(len(bundle["grenades"]), 1)
        self.assertEqual(bundle["grenades"][0]["points"][0][0], 9000)

    def test_lineup_parser_uses_same_live_round_numbers_and_cutoff(self):
        parser = self.parser()
        dp = DemoParser()
        rounds = dp._extract_rounds(parser)
        self.assertEqual(rounds["round_number"].tolist(), [1, 2])
        self.assertEqual(rounds.attrs["discard_before_tick"], 6386)
        with patch.object(dp, "_dp_cls", return_value=parser), \
             patch.object(dp, "_extract_grenades", return_value=pd.DataFrame({"tick": [5000, 9000]})), \
             patch.object(dp, "_extract_utility_damage", return_value=pd.DataFrame({"tick": [5000, 9001]})), \
             patch.object(dp, "_merge", return_value=pd.DataFrame({"round_number": [1]})) as merge:
            dp.parse_demo(Path("test.dem"))
        self.assertEqual(merge.call_args.args[0]["tick"].tolist(), [9000])
        self.assertEqual(merge.call_args.args[2]["tick"].tolist(), [9001])


if __name__ == "__main__":
    unittest.main()
