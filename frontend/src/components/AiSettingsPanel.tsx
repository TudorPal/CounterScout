import {useEffect,useState} from 'react';
import {getTeamAiConfiguration,saveAiSettings} from '../api/client';
import type {TeamAiConfiguration} from '../api/client';

export default function AiSettingsPanel() {
  const [config,setConfig]=useState<TeamAiConfiguration|null>(null);
  const [provider,setProvider]=useState('groq');
  const [key,setKey]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [message,setMessage]=useState('');
  useEffect(()=>{let active=true;getTeamAiConfiguration().then(c=>{if(active){setConfig(c);setProvider(c.provider);}}).catch(()=>{if(active)setError('Could not read AI configuration.');});return()=>{active=false;};},[]);
  const save=async(remove=false)=>{
    setBusy(true);setError('');setMessage('');
    try {
      const saved=await saveAiSettings({provider,api_key:remove?'':key.trim(),remove_key:remove});
      setConfig(saved);setKey('');
      setMessage(remove?'Key removed for this provider.':"Saved locally and applied immediately. Generate an AI report to verify the key.");
      window.dispatchEvent(new CustomEvent('counterscout:ai-settings',{detail:saved}));
    } catch(e:any){setError(e?.response?.data?.detail ?? 'Could not save AI settings.');}
    finally{setBusy(false);}
  };
  return <section aria-label="AI settings" className="border-t border-scout-border pt-4 space-y-3">
    <h3 className="font-semibold text-sm text-scout-accent">AI analysis</h3>
    <p className="text-xs text-scout-muted">Optional. Evidence works without a key. Keep your provider on its Free plan; no paid fallback is used.</p>
    <label className="block text-xs text-scout-muted">Provider<select aria-label="AI provider" value={provider} disabled={busy||!config} onChange={e=>{setProvider(e.target.value);setKey('');setMessage('');}} className="hud-input w-full mt-1"><option value="groq">Groq · recommended</option><option value="openrouter">OpenRouter · free models</option></select></label>
    <p className="text-xs text-scout-muted">{!config?'Checking configuration…':provider===config.provider?(config.configured?'Key configured (hidden)':'No key configured'):'Select Save to activate this provider.'}</p>
    <label className="block text-xs text-scout-muted">API key<input aria-label="AI API key" type="password" autoComplete="off" spellCheck={false} value={key} disabled={busy||!config} onChange={e=>setKey(e.target.value)} placeholder="Paste a new key; leave empty to keep the existing one" className="hud-input w-full mt-1"/></label>
    <p className="text-xs text-scout-muted">Saved only in your local .env (portable: user-data/.env), not in the browser. This file contains a private plaintext key—never share it or your user-data folder.</p>
    <div className="flex flex-wrap gap-2 items-center"><button className="hud-btn-primary text-xs" disabled={busy||!config} onClick={()=>save()}>{busy?'Saving…':'Save AI settings'}</button><button className="hud-btn text-xs" disabled={busy||!config||provider!==config.provider||!config.configured} onClick={()=>save(true)}>Remove key</button><a className="text-xs text-scout-accent underline" href={provider==='groq'?'https://console.groq.com/keys':'https://openrouter.ai/keys'} target="_blank" rel="noreferrer">Get a free key ↗</a></div>
    {error && <p role="alert" className="text-xs text-scout-red">{error}</p>}
    {message && <p role="status" className="text-xs text-scout-accent">{message}</p>}
  </section>;
}
