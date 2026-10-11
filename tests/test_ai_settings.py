import asyncio
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from dotenv import dotenv_values
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend import ai_settings as ai


class AiSettingsTests(unittest.TestCase):
    def setUp(self):
        self.root=Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.path=self.root/'.env'
        self.path.write_text('# Keep my settings\nRCON_PORT=27016\nFACEIT_API_KEY=unrelated\n',encoding='utf-8')
        self.enterContext(patch.object(ai,'ENV_PATH',self.path))
        self.enterContext(patch.object(ai,'_LOCK',asyncio.Lock()))
        self.enterContext(patch.dict(os.environ,{},clear=False))
        for name,value in [('team_ai_provider','groq'),('groq_api_key','existing-private-key'),('openrouter_api_key',''),('openrouter_model','openrouter/free')]:
            self.enterContext(patch.object(ai.settings,name,value))
        app=FastAPI();app.include_router(ai.router)
        self.app=app
        self.client=self.enterContext(TestClient(app,base_url='http://127.0.0.1:8000',client=('127.0.0.1',12345)))
        self.headers={'Origin':'http://127.0.0.1:5173'}

    def save(self,**data):
        return self.client.put('/api/settings/ai',json=data,headers=self.headers)

    def test_replace_key_preserves_other_settings_and_never_returns_secret(self):
        response=self.save(provider='groq',api_key='new-private-key')
        self.assertEqual(response.status_code,200)
        self.assertTrue(response.json()['configured'])
        self.assertNotIn('private-key',response.text)
        self.assertEqual(ai.settings.groq_api_key,'new-private-key')
        env=dotenv_values(self.path)
        self.assertEqual(env['GROQ_API_KEY'],'new-private-key')
        self.assertEqual(env['RCON_PORT'],'27016');self.assertEqual(env['FACEIT_API_KEY'],'unrelated')
        self.assertEqual(os.environ['GROQ_API_KEY'],'new-private-key')
        self.assertIn('# Keep my settings',self.path.read_text())

    def test_blank_preserves_key_and_removal_disables_without_fallback(self):
        self.assertEqual(self.save(provider='groq',api_key='').status_code,200)
        self.assertEqual(ai.settings.groq_api_key,'existing-private-key')
        response=self.save(provider='groq',remove_key=True)
        self.assertFalse(response.json()['configured'])
        self.assertEqual(ai.settings.groq_api_key,'')
        self.assertEqual(dotenv_values(self.path)['GROQ_API_KEY'],'')
        self.assertEqual(os.environ['GROQ_API_KEY'],'')

    def test_switch_provider_does_not_overwrite_other_provider_key(self):
        response=self.save(provider='openrouter',api_key='free-router-key')
        self.assertEqual(response.status_code,200)
        self.assertEqual(ai.settings.team_ai_provider,'openrouter')
        self.assertEqual(ai.settings.groq_api_key,'existing-private-key')
        self.assertNotIn('router-key',response.text)

    def test_remote_clients_hostnames_and_cross_site_origins_are_rejected(self):
        for host,client in [('http://127.0.0.1:8000',('192.168.1.2',12345)),('http://evil.test',('127.0.0.1',12345))]:
            with TestClient(self.app,base_url=host,client=client) as remote:
                response=remote.put('/api/settings/ai',json={'provider':'groq','api_key':'private-key'})
                self.assertEqual(response.status_code,403)
        for headers in ({'Origin':'https://evil.test'},{'Sec-Fetch-Site':'cross-site'}):
            response=self.client.put('/api/settings/ai',json={'provider':'groq','api_key':'private-key'},headers=headers)
            self.assertEqual(response.status_code,403)

    def test_invalid_input_never_echoes_key_and_disk_failure_is_atomic(self):
        before=self.path.read_bytes()
        for data in [dict(provider='other',api_key='private-key'),dict(provider='groq',api_key={'secret':'private-key'}),dict(provider='groq',api_key='private-key\ninvalid'),dict(provider='groq',api_key='private-key',remove_key=True)]:
            response=self.save(**data)
            self.assertEqual(response.status_code,422)
            self.assertNotIn('private-key',response.text)
        with patch.object(ai,'set_key',side_effect=OSError('private-key must never appear')):
            response=self.save(provider='groq',api_key='private-key')
        self.assertEqual(response.status_code,500)
        self.assertNotIn('private-key',response.text)
        self.assertEqual(self.path.read_bytes(),before)
        self.assertEqual(ai.settings.groq_api_key,'existing-private-key')
        self.assertEqual(list(self.root.iterdir()),[self.path],'Temporary secret files must be cleaned up')


if __name__=='__main__':unittest.main()
