import {useEffect,useState} from 'react';
import {configureFaceitDownloads,getFaceitBridgeSetup} from '../api/client';

export default function FaceitBridgeSettings() {
  const [setup,setSetup]=useState<Awaited<ReturnType<typeof getFaceitBridgeSetup>>|null>(null);
  const [folder,setFolder]=useState(''),[visible,setVisible]=useState(false),[copied,setCopied]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  useEffect(()=>{
    let active=true;
    getFaceitBridgeSetup().then(s=>{if(active){setSetup(s);setFolder(s.downloads_dir || '');}}).catch(()=>{if(active)setError('Could not load extension setup.');});
    return()=>{active=false;};
  },[]);
  async function save() {
    setBusy(true);setError('');setStatus('');
    try {await configureFaceitDownloads(folder.trim());setStatus('Downloads folder saved.');window.dispatchEvent(new Event('counterscout:bridge-settings'));}
    catch(e:any){setError(e?.response?.data?.detail || 'Could not save downloads folder.');}
    finally {setBusy(false);}
  }
  return <section aria-label="FACEIT extension settings" className="border-t border-scout-border pt-4 space-y-3">
    <h3 className="text-sm font-semibold text-scout-accent">FACEIT extension</h3>
    <ol className="list-decimal pl-5 text-xs text-scout-muted space-y-2">
      <li>Open <code>chrome://extensions</code>, enable Developer mode, choose <strong>Load unpacked</strong>, and select <code className="break-all">{setup?.extension_path || 'browser-extension'}</code>.</li>
      <li>Paste the pairing code in the extension, check <strong>Enable team sync</strong>, and choose <strong>Save & connect</strong>.</li>
      <li>Sign in to FACEIT, select <strong>Sync current FACEIT page</strong>, review the teams and manually download each map demo from the room. Completed downloads import automatically.</li>
    </ol>
    <p className="text-xs text-scout-muted">After an update, reload the extension and refresh open FACEIT tabs. Required version: {setup?.required_version || '0.2.2'}.</p>
    <label className="block text-xs text-scout-muted">Pairing code<input aria-label="Extension pairing code" className="hud-input w-full mt-1" readOnly type={visible?'text':'password'} value={setup?.token || ''}/></label>
    <div className="settings-actions"><button className="hud-btn" aria-pressed={visible} disabled={!setup} onClick={()=>setVisible(v=>!v)}>{visible?'Hide code':'Show code'}</button>
      <button className="hud-btn" disabled={!setup} onClick={async()=>{try{await navigator.clipboard.writeText(setup!.token);setCopied(true);}catch{setError('Choose Show code, then select and copy it manually.');}}}>{copied?'Copied':'Copy code'}</button></div>
    <label className="block text-xs text-scout-muted">Chrome downloads folder<input aria-label="FACEIT downloads folder" className="hud-input w-full mt-1" value={folder} disabled={!setup||busy} onChange={e=>setFolder(e.target.value)}/></label>
    <button className="hud-btn-primary" disabled={!setup||busy||!folder.trim()} onClick={()=>void save()}>{busy?'Saving…':'Save folder'}</button>
    <p className="text-xs text-scout-muted">Only this folder can be read. Original downloads are preserved. No FACEIT API key or copied login token is required.</p>
    {error && <p role="alert" className="text-xs text-scout-red">{error}</p>}
    {status && <p role="status" className="text-xs text-scout-accent">{status}</p>}
  </section>;
}
