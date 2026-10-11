import {useEffect,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {getTeamAiConfiguration,getTeamTacticalEvidence,getTeamTacticalReport} from '../api/client';
import type {TeamAiConfiguration,TeamTacticalEvidence,TeamTacticalReport,TeamAnalysisRequest,TeamTacticalRound} from '../api/client';

const label=(buy:string)=>buy==='mixed/unknown'?'Mixed / unknown':buy.split('-').map(w=>w[0].toUpperCase()+w.slice(1)).join(' ');
const roundLink=(r:TeamTacticalRound)=>`/replay/${encodeURIComponent(r.demo_file)}/insights?round=${r.round}`;

/** On-demand only: switching maps/teams never submits a provider request. */
export default function TeamAiPanel({request}:{request:TeamAnalysisRequest}) {
  const [configuration,setConfiguration]=useState<TeamAiConfiguration|null>(null);
  const [evidence,setEvidence]=useState<TeamTacticalEvidence|null>(null);
  const [result,setResult]=useState<{report:TeamTacticalReport;model:string;cached:boolean}|null>(null);
  const [stage,setStage]=useState<'idle'|'evidence'|'ai'>('idle');
  const [error,setError]=useState('');
  const [consent,setConsent]=useState(false);
  const [side,setSide]=useState<'all'|'T'|'CT'>('all');
  const revision=useRef(0);
  const context=JSON.stringify({...request,demo_files:[...request.demo_files].sort()});
  useEffect(()=>{revision.current++;setEvidence(null);setResult(null);setStage('idle');setError('');setSide('all');},[context]);
  useEffect(()=>{let active=true;getTeamAiConfiguration().then(c=>{if(active)setConfiguration(c);}).catch(()=>{if(active)setError('Could not read AI configuration. Check the backend and retry.');});return()=>{active=false;revision.current++;};},[]);
  const ready=!!request.team_name && !!request.map_name && request.demo_files.length>0 && request.demo_files.length<=12;
  const run=async(ai:boolean)=>{
    const current=++revision.current;
    setError('');setStage('evidence');
    try {
      const facts=evidence ?? await getTeamTacticalEvidence(request);
      if(current!==revision.current)return;
      setEvidence(facts);
      if(ai){setStage('ai');const report=await getTeamTacticalReport(request);if(current===revision.current)setResult(report);}
    } catch(e:any){if(current===revision.current)setError(e?.response?.data?.detail ?? 'Could not analyze this team. Please retry.');}
    finally {if(current===revision.current)setStage('idle');}
  };
  const busy=stage!=='idle';
  return <section aria-label="AI team tactical analysis" className="hud-panel p-5 space-y-4">
    <div className="flex flex-wrap justify-between items-start gap-4">
      <div><h2 className="font-semibold text-lg text-white">AI team analysis</h2>
        <p className="text-sm text-scout-muted mt-1">Pistols, economy, openings, site outcomes and utility—for {request.team_name || 'the selected team'} only.</p>
        <p className="text-xs text-scout-muted mt-1">{request.demo_files.length} selected demos · {request.map_name || 'Select a map'} · Full-game evidence, independent of the explorer's scenario filters.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="hud-btn text-sm" disabled={!ready || busy} onClick={()=>run(false)}>Build team evidence</button>
        <button className="hud-btn-primary text-sm" disabled={!ready || busy || !configuration?.configured || !consent} onClick={()=>run(true)}>{result?'Load AI report':'Generate AI report'}</button>
      </div>
    </div>
    {request.demo_files.length>12 && <p role="alert" className="text-sm text-scout-red">Select at most 12 demos per report.</p>}
    {!configuration ? <p className="text-xs text-scout-muted">Checking AI configuration…</p> : !configuration.configured ?
      <div className="rounded-lg bg-white/5 p-3 text-sm text-scout-muted">AI key not configured. Create a free key at <a className="text-scout-accent underline" href={configuration.provider==='groq'?'https://console.groq.com/keys':'https://openrouter.ai/keys'} target="_blank" rel="noreferrer">{configuration.provider}</a>, add {configuration.provider==='groq'?'GROQ_API_KEY':'OPENROUTER_API_KEY'} to your local .env, then restart the backend. Evidence works without a key. Setup: docs/ai-team-analysis.md.</div> :
      <label className="flex items-start gap-2 text-xs text-scout-muted"><input type="checkbox" aria-label="Allow AI evidence upload" checked={consent} onChange={e=>setConsent(e.target.checked)} className="accent-scout-accent mt-0.5"/>Allow sending team/player names and compact tactical evidence to {configuration.provider} ({configuration.model}). Demo files are not uploaded. No paid-provider fallback.</label>}
    {busy && <div role="status" aria-live="polite" className="flex items-center gap-3 text-sm text-scout-accent"><span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin"/>{stage==='evidence'?'Building routes, buy categories and utility evidence…':'AI is interpreting the evidence…'}</div>}
    {error && <p role="alert" className="text-sm text-scout-red">{error}</p>}
    {evidence && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-scout-muted">{evidence.rounds.length} classified rounds{evidence.skipped_rounds>0?` · ${evidence.skipped_rounds} skipped (unknown side/roster)`:''}{result?` · ${result.model} · ${result.cached?'Saved report':'New report'}`:''}</p>
        <div className="flex gap-1" aria-label="Team analysis side">{(['all','T','CT'] as const).map(v=><button key={v} className={side===v?'hud-btn-primary text-xs':'hud-btn text-xs'} aria-pressed={side===v} onClick={()=>setSide(v)}>{v==='all'?'Both sides':v}</button>)}</div>
      </div>
      {result && <div className="rounded-lg border border-scout-accent/20 p-4"><p className="text-xs uppercase tracking-wider text-scout-accent mb-2">AI interpretation · verify with the cited rounds</p><p className="text-sm leading-relaxed text-gray-200">{result.report.overview}</p></div>}
      <div className="grid gap-4 xl:grid-cols-2">{evidence.groups.filter(g=>side==='all'||g.side===side).map(g=>{
        const interpretation=result?.report.sections.find(s=>s.side===g.side && s.buy===g.buy);
        const rounds=evidence.rounds.filter(r=>g.round_refs.includes(r.id));
        return <article key={`${g.side}-${g.buy}`} className="rounded-xl border border-white/10 p-4 space-y-3">
          <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold text-white"><span style={{color:g.side==='T'?'#DCBF6E':'#5B9BD5'}}>{g.side}</span> · {label(g.buy)}</h3><span className="text-xs text-scout-muted">{g.rounds} rounds · {g.wins} wins{interpretation?` · ${interpretation.confidence} confidence`:''}</span></div>
          <p className="text-xs text-scout-muted">Observed plants: {['A','B','none','unknown'].filter(s=>g.planted_sites[s]).map(s=>`${s==='none'?'No plant':s==='unknown'?'Unknown site':`${s} site`}: ${g.planted_sites[s]}`).join(' · ') || 'None'}. Buy type is an estimate.</p>
          {interpretation && <div className="text-sm text-gray-200 leading-relaxed space-y-2"><p>{interpretation.plan}</p><p><span className="text-scout-accent">Utility: </span>{interpretation.utility}</p><p><span className="text-scout-accent">{g.side==='T'?'Possible lurks':'Defensive separation'}: </span>{interpretation.possible_lurks}</p>
            <div className="flex flex-wrap gap-2">{interpretation.round_refs.map(ref=>{const r=evidence.rounds.find(r=>r.id===ref);return r?<Link key={ref} to={roundLink(r)} className="text-xs text-scout-accent underline">Demo {request.demo_files.indexOf(r.demo_file)+1} · R{r.round} ↗</Link>:null;})}</div></div>}
          <div><h4 className="text-xs uppercase text-scout-muted mb-2">Observed common smoke / flash areas</h4>{g.common_utility.length ? <ul className="space-y-1 text-xs text-gray-200">{g.common_utility.map((u,i)=><li key={i}>{u.type} → {u.location} <span className="text-scout-muted">· {u.throws} throws in {u.rounds}/{g.rounds} rounds</span></li>)}</ul>:<p className="text-xs text-scout-muted">No smoke/flash throws recorded.</p>}</div>
          <details><summary className="text-xs text-scout-accent cursor-pointer">Check round evidence ({rounds.length})</summary><div className="space-y-3 mt-3 max-h-96 overflow-y-auto">{rounds.map(r=><div key={r.id} className="border-t border-white/10 pt-3 text-xs text-gray-200 space-y-2">
            <div className="flex justify-between gap-2"><Link className="text-scout-accent underline" to={roundLink(r)}>Demo {request.demo_files.indexOf(r.demo_file)+1} · Round {r.round} ↗</Link><span>{r.active_players} present · {r.won?'Won':'Lost'} · ${r.equipment.toLocaleString()} equipment</span></div>
            {r.routes.map(route=><p key={route.player}><span className="font-semibold">{route.player}</span>: {route.samples.length?route.samples.map(s=>`${s.seconds}s ${s.location}`).join(' → '):'No early route samples'}</p>)}
            {r.possible_lurks.map(l=><p key={l.player} className="text-scout-yellow">Possible lurk: {l.player} separated at {l.separated_at_seconds.join(', ')}s (intent unconfirmed).</p>)}
            {r.utility.map((u,i)=><p key={i}>{u.seconds}s · {u.player} · {u.type}: {u.from} → {u.to} ({u.phase})</p>)}
          </div>)}</div></details>
        </article>;
      })}</div>
      <details className="text-xs text-scout-muted"><summary className="cursor-pointer">Method and limitations</summary><ul className="mt-2 space-y-1 list-disc pl-4">{[...evidence.limitations,...(result?.report.limitations ?? [])].map((text,i)=><li key={i}>{text}</li>)}</ul></details>
    </>}
  </section>;
}
