import asyncio
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import HTTPException

from backend import main
from backend.analysis import tactical_ai as ai
from backend.analysis.team_tactics import build_evidence, prompt_evidence
from backend.utils.ai_cache import AICache
from tests.test_team_tactics import fixture


def valid_report(evidence,digest):
    return {'overview':'Observed openings; verify routes.', 'limitations':['Intent is uncertain.'],
            'sections':[{'side':g['side'],'buy':g['buy'],'plan':'Opening routes in cited rounds.',
                         'utility':'Observed smoke and flash areas.','possible_lurks':'Possible separation only.',
                         'confidence':'low','round_refs':[r['id'] for r in g['examples']][:1]} for g in digest['groups']]}


class TacticalAiTests(unittest.TestCase):
    def setUp(self):
        bundle,roster=fixture()
        self.evidence=build_evidence([('demo.dem',bundle,roster)],'Scouted','de_mirage')
        self.digest,_=prompt_evidence(self.evidence)

    def test_report_requires_every_present_group_and_only_its_citations(self):
        report=valid_report(self.evidence,self.digest)
        self.assertEqual(ai.validate_report(json.dumps(report),self.evidence,self.digest),report)
        report['sections'][0]['round_refs']=['invented.dem:R99']
        with self.assertRaises(HTTPException):ai.validate_report(json.dumps(report),self.evidence,self.digest)
        report=valid_report(self.evidence,self.digest)
        report['sections'].pop()
        with self.assertRaises(HTTPException):ai.validate_report(json.dumps(report),self.evidence,self.digest)
        report=valid_report(self.evidence,self.digest)
        report['sections'][0]['round_refs']=report['sections'][1]['round_refs']
        with self.assertRaises(HTTPException):ai.validate_report(json.dumps(report),self.evidence,self.digest)

    def test_paid_openrouter_model_is_rejected(self):
        with patch.object(ai.settings,'team_ai_provider','openrouter'),patch.object(ai.settings,'openrouter_model','paid/model'):
            with self.assertRaises(HTTPException) as error:ai.provider_config()
            self.assertEqual(error.exception.status_code,422)

    def test_groq_has_no_key_fallback_and_configuration_never_returns_secrets(self):
        with patch.object(ai.settings,'team_ai_provider','groq'),patch.object(ai.settings,'groq_api_key',''),patch.object(ai.settings,'anthropic_api_key','private-paid-key'):
            self.assertFalse(ai.configuration()['configured'])
            with self.assertRaises(HTTPException) as error:asyncio.run(ai.complete([{'role':'user','content':'test'}]))
            self.assertEqual(error.exception.status_code,503)
            self.assertNotIn('private-paid-key',json.dumps(ai.configuration()))

    def test_provider_rate_limits_errors_and_timeouts_are_safe_without_retries(self):
        for status,expected in [(429,429),(401,503),(403,503),(500,502),(400,502)]:
            client=AsyncMock()
            client.__aenter__.return_value=client
            client.post.return_value=httpx.Response(status,json={'error':'secret-key-and-prompt'},headers={'retry-after':'42'})
            with patch.object(ai.settings,'groq_api_key','secret-key-and-prompt'),patch('backend.analysis.tactical_ai.httpx.AsyncClient',return_value=client):
                with self.assertRaises(HTTPException) as error:asyncio.run(ai.complete([{'role':'user','content':'test'}]))
                self.assertEqual(error.exception.status_code,expected)
                self.assertNotIn('secret-key-and-prompt',str(error.exception.detail))
                self.assertEqual(client.post.await_count,1)
        client.post.side_effect=httpx.ReadTimeout('secret-key-and-prompt')
        with patch.object(ai.settings,'groq_api_key','secret'),patch('backend.analysis.tactical_ai.httpx.AsyncClient',return_value=client):
            with self.assertRaises(HTTPException) as error:asyncio.run(ai.complete([]))
            self.assertEqual(error.exception.status_code,504)

    def test_provider_uses_strict_schema_and_rejects_truncated_report(self):
        client=AsyncMock();client.__aenter__.return_value=client
        client.post.return_value=httpx.Response(200,json={'choices':[{'message':{'content':'{"overview":"ok"}'},'finish_reason':'stop'}]})
        with patch.object(ai.settings,'groq_api_key','private-key'),patch('backend.analysis.tactical_ai.httpx.AsyncClient',return_value=client):
            asyncio.run(ai.complete([],schema=ai.report_schema()))
            self.assertTrue(client.post.call_args.kwargs['json']['response_format']['json_schema']['strict'])
            self.assertEqual(client.post.call_args.args[0],'https://api.groq.com/openai/v1/chat/completions')
            client.post.return_value=httpx.Response(200,json={'choices':[{'message':{'content':'partial'},'finish_reason':'length'}]})
            with self.assertRaises(HTTPException):asyncio.run(ai.complete([]))


class TeamAnalysisApiTests(unittest.TestCase):
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
        self.enterContext(patch.object(main,'ai_cache',AICache(self.root/'ai.db')))
        self.request=main.TeamAnalysisRequest(team_name='Scouted',map_name='de_mirage',demo_files=['demo.dem'])

    def test_evidence_needs_no_api_key_and_reuses_compact_cache(self):
        with patch('backend.analysis.team_tactics.extract_demo', wraps=__import__('backend.analysis.team_tactics',fromlist=['extract_demo']).extract_demo) as extract:
            first=asyncio.run(main.get_team_evidence(self.request))
            second=asyncio.run(main.get_team_evidence(self.request))
            self.assertEqual(first,second)
            self.assertEqual(extract.call_count,1)
            self.roster['team1']['players_detailed'].pop()
            asyncio.run(main.get_team_evidence(self.request))
            self.assertEqual(extract.call_count,2,'Roster revisions must invalidate evidence')

    def test_report_cache_prevents_repeat_provider_requests(self):
        async def scenario():
            evidence=await main.get_team_evidence(self.request)
            digest,_=prompt_evidence(evidence)
            with patch.object(ai.settings,'groq_api_key','fake'),patch('backend.analysis.tactical_ai.generate_report',AsyncMock(return_value=valid_report(evidence,digest))) as generate:
                first,second=await asyncio.gather(main.get_team_tactical_report(self.request),main.get_team_tactical_report(self.request))
                self.assertFalse(first['cached']);self.assertTrue(second['cached'])
                self.assertEqual(generate.await_count,1)
                self.roster['team1']['players_detailed'].pop()
                third=await main.get_team_tactical_report(self.request)
                self.assertFalse(third['cached'])
                self.assertEqual(generate.await_count,2)
        asyncio.run(scenario())

    def test_path_traversal_and_wrong_team_are_rejected(self):
        for bad in ('../demo.dem','sub\\demo.dem'):
            with self.assertRaises(HTTPException):asyncio.run(main.get_team_evidence(main.TeamAnalysisRequest(team_name='Scouted',map_name='de_mirage',demo_files=[bad])))
        with self.assertRaises(HTTPException) as error:asyncio.run(main.get_team_evidence(main.TeamAnalysisRequest(team_name='Other',map_name='de_mirage',demo_files=['demo.dem'])))
        self.assertEqual(error.exception.status_code,422)


if __name__=='__main__':unittest.main()
