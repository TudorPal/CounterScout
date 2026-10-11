import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException
from backend import main
from backend.analysis import match_snapshot as snapshot
from backend.utils.ai_cache import AICache
from tests.test_team_tactics import fixture

STRUCTURED = '\n\n'.join(f'{title}\n- A brief factual bullet.' for title in snapshot.HEADINGS)


class SnapshotFactsTests(unittest.TestCase):
    def test_stable_team_scores_follow_actual_round_sides_not_modal_uniform(self):
        bundle,roster=fixture()
        bundle['players'].append({'steamid':'extra','name':'Opponent 2','team_num':2})
        # The fifth teammate disconnects before halftime; old T samples cannot vote.
        bundle['positions']['4']=[s for s in bundle['positions']['4'] if s['t']<12000]
        bundle['positions']['enemy']=[{**s,'tn':3 if s['t']<12000 else 2} for s in bundle['positions']['0']]
        bundle['events'] += [{'type':'death','tick':12150,'data':{'attacker':'0','victim':'enemy'}}]
        digest=json.loads(snapshot.build_digest('demo.dem',bundle,roster))
        self.assertEqual([t['wins'] for t in digest['teams']],[12,2])
        self.assertEqual(digest['rounds'][12]['winner'],'Enemy')
        self.assertEqual(digest['standouts'][0]['team'],'Scouted')
        self.assertEqual(digest['unresolved_winners'],0)

    def test_unknown_roster_does_not_invent_final_team_scores(self):
        bundle,_=fixture()
        digest=json.loads(snapshot.build_digest('demo.dem',bundle,{}))
        self.assertEqual(digest['unresolved_winners'],14)

    def test_snapshot_requires_brief_headings_and_bullets_not_essays(self):
        self.assertEqual(snapshot.validate_snapshot(STRUCTURED),STRUCTURED)
        for bad in ['An essay about the match.',STRUCTURED.replace('- A brief factual bullet.','A long paragraph.',1),STRUCTURED+'\nRESULT\n- Duplicate result.']:
            with self.assertRaises(HTTPException):snapshot.validate_snapshot(bad)
        self.assertIn('NOT an essay',snapshot.prompt('{}'))
        structured={key:['A brief factual bullet.'] for key in snapshot.SnapshotReport.model_fields}
        self.assertEqual(snapshot.validate_snapshot(json.dumps(structured)),STRUCTURED)
        structured['standout_players']=['Too many standouts.']*4
        with self.assertRaises(HTTPException):snapshot.validate_snapshot(json.dumps(structured))


class SnapshotApiTests(unittest.TestCase):
    def setUp(self):
        self.root=Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.demos=self.root/'demos';self.demos.mkdir()
        self.timelines=self.root/'timelines';self.timelines.mkdir()
        self.bundle,self.roster=fixture()
        (self.demos/'demo.dem').write_bytes(b'fixture')
        (self.timelines/'demo.dem.json').write_text(json.dumps(self.bundle),encoding='utf-8')
        self.enterContext(patch.object(main.settings,'demo_dir',self.demos))
        self.enterContext(patch.object(main,'_TIMELINE_CACHE_DIR',self.timelines))
        self.enterContext(patch.object(main,'_load_roster_for_demo',return_value=self.roster))
        self.enterContext(patch.object(main,'get_match_replay_timeline',AsyncMock()))
        self.enterContext(patch.object(main,'_INSIGHTS_CACHE',{}))
        self.enterContext(patch.object(main,'_INSIGHTS_LOCKS',{}))
        self.cache=AICache(self.root/'ai.db')
        self.enterContext(patch.object(main,'ai_cache',self.cache))

    def test_old_essays_are_invalidated_and_new_snapshots_cached_with_revision(self):
        self.cache.put('insights','demo.dem','Old essay')
        async def scenario():
            provider=AsyncMock(return_value=STRUCTURED)
            with patch.object(main,'_llm_complete',provider):
                a,b=await asyncio.gather(main.get_match_replay_insights('demo.dem'),main.get_match_replay_insights('demo.dem'))
                self.assertEqual(a.summary,STRUCTURED);self.assertEqual(a,b)
                self.assertEqual(provider.await_count,1)
                self.assertIn('NOT an essay',provider.call_args.args[0])
                main._INSIGHTS_CACHE.clear()
                await main.get_match_replay_insights('demo.dem')
                self.assertEqual(provider.await_count,1,'Disk cache survives process restart')
                self.roster['team1']['name']='Renamed team'
                await main.get_match_replay_insights('demo.dem')
                self.assertEqual(provider.await_count,2)
                with patch.object(snapshot,'PROMPT_VERSION',snapshot.PROMPT_VERSION+1):
                    await main.get_match_replay_insights('demo.dem')
                self.assertEqual(provider.await_count,3)
        asyncio.run(scenario())

    def test_unstructured_provider_output_is_not_saved(self):
        with patch.object(main,'_llm_complete',AsyncMock(return_value='An essay.')):
            with self.assertRaises(HTTPException):asyncio.run(main.get_match_replay_insights('demo.dem'))
        self.assertEqual(main._INSIGHTS_CACHE,{})


if __name__=='__main__':unittest.main()
