import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend import main


class TeamEditingTests(unittest.TestCase):
    def test_hltv_edit_is_demo_specific_and_preserves_shared_roster(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(main.settings, "demo_dir", Path(tmp)), \
             patch.object(main, "_demo_map_name", return_value="de_anubis"):
            root=Path(tmp)
            original={"team1":{"name":"Alpha","players":["One","Two"]},
                      "team2":{"name":"Beta","players":["Three"]}}
            shared=root/"2398102.roster.json"
            shared.write_text(json.dumps(original))
            before=shared.read_bytes()
            result=asyncio.run(main.update_local_demo_team_names("2398102_anubis.dem",
                main.LocalTeamNamesRequest(team1_name="Renamed",team2_name="Beta")))
            self.assertEqual(result["team1"]["name"],"Renamed")
            self.assertEqual(result["team1"]["players"],["One","Two"])
            self.assertEqual(shared.read_bytes(),before)
            self.assertEqual(main._load_roster_for_demo("2398102_dust2.dem")["team1"]["name"],"Alpha")
            self.assertTrue((root/"2398102_anubis.dem.teams.json").exists())

    def test_local_edit_preserves_players_and_updates_existing_sidecar(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(main.settings, "demo_dir", Path(tmp)), \
             patch.object(main, "_demo_map_name", return_value="de_mirage"):
            path=Path(tmp)/"local.roster.json"
            path.write_text(json.dumps({"source":"local-demo","team1":{"name":"Alpha","players":["One"]},
                                        "team2":{"name":"Beta","players":["Two"]}}))
            result=asyncio.run(main.update_local_demo_team_names("local.dem",
                main.LocalTeamNamesRequest(team1_name="Local renamed",team2_name="Beta")))
            self.assertEqual(result["team1"]["players"],["One"])
            self.assertEqual(json.loads(path.read_text())["team1"]["name"],"Local renamed")


if __name__ == "__main__":
    unittest.main()
