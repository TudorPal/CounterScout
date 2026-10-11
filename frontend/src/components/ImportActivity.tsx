import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {Link} from 'react-router-dom';
import {getFaceitBridgeLibrary, getIngestionStatus} from '../api/client';
import {dismissImport, importSnapshot, subscribeImports, updateImport} from '../utils/importActivity';
import {popoverPosition} from '../utils/popoverPosition';
import {bridgeMatchState} from '../utils/faceitBridgeState';

/** One app-level poller; status and uploads survive route changes. */
export function ImportActivityMonitor() {
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const observed = new Map<string, string>();
    let initial = true, pipeline = false;
    async function poll() {
      const [bridge, ingest] = await Promise.allSettled([getFaceitBridgeLibrary(false), getIngestionStatus()]);
      if (stopped) return;
      if (bridge.status === 'fulfilled') {
        for(const command of (bridge.value.commands??[]).filter(c=>c.kind==='download')) {
          const jobs=(bridge.value.imports??[]).filter(j=>j.match_id===command.match_id);
          const match=bridgeMatchState(jobs,command),signature=JSON.stringify([command.state,command.stage,command.download_count,match.label,match.error,match.demos,command.team_names]);
          if(observed.get(`download:${command.id}`)===signature)continue;
          observed.set(`download:${command.id}`,signature);
          const importing=jobs.some(j=>j.state==='queued'||j.state==='importing');
          const expected=command.expected_count||command.download_count||1;
          const complete=Boolean(command.resolved_by_import||match.demos.length>=expected);
          updateImport({id:`download:${command.id}`,label:complete?'FACEIT downloads imported':match.label==='Not imported'?'Waiting for FACEIT download…':match.label,
            state:complete?'done':match.waiting||importing||!match.error?'working':'error',error:match.error??undefined,demo:match.demos[0],
            teamNames:command.team_names,matchId:command.match_id,
            toastDismissed:initial||complete,startedAt:command.created?command.created*1000:undefined,
            ...(initial?{updatedAt:command.created?command.created*1000:undefined}:{})});
        }
        for (const item of bridge.value.imports ?? []) {
          const previous = observed.get(item.id);
          const signature=JSON.stringify([item.state,item.team_names]);
          observed.set(item.id, signature);
          if (previous === signature) continue;
          updateImport({id: `bridge:${item.id}`, label: item.state === 'done' ? 'FACEIT demo ready' : item.state === 'error' ? 'FACEIT import failed' : item.state === 'queued' ? 'FACEIT demo queued' : 'Analysing FACEIT demo',
            state: item.state === 'done' ? 'done' : item.state === 'error' ? 'error' : 'working', demo: item.demo_file ?? undefined, error: item.error ?? undefined,teamNames:item.team_names,matchId:item.match_id,
            ...(initial?{toastDismissed:true,startedAt:item.created?item.created*1000:undefined,updatedAt:item.created?item.created*1000:undefined}:{})});
        }
        initial = false;
      }
      if (ingest.status === 'fulfilled') {
        const s = ingest.value, running = s.run_id > s.last_completed_run_id;
        if (running) updateImport({id: 'pipeline', label: s.status || 'Importing demos', state: 'working',
          ...(s.demos_total_this_run > 0 ? {progress: Math.round(100*s.demos_parsed_this_run/s.demos_total_this_run)} : {})});
        else if (pipeline) updateImport({id: 'pipeline', label: 'Demo import finished', state: 'done'});
        pipeline = running;
      }
      timer = setTimeout(poll, 2000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);
  const items = useSyncExternalStore(subscribeImports, importSnapshot);
  const notifications = items.filter(item => item.state !== 'working'&&!item.toastDismissed).slice(0, 3);
  return <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-[min(360px,calc(100vw-40px))]" aria-live="polite">
    {notifications.map(item => <div key={item.id} className="rounded-xl border border-white/15 bg-[#111b24] p-4 shadow-xl">
      <div className="flex gap-3 items-start"><p className={`flex-1 text-sm font-semibold ${item.state === 'error' ? 'text-scout-red' : 'text-scout-accent'}`}>{item.label}</p>
        <button aria-label="Dismiss import notification" onClick={() => dismissImport(item.id)} className="text-scout-muted">×</button></div>
      {item.error && <p className="text-xs text-scout-muted mt-1">{item.error}</p>}
      {item.teamNames?.length ? <p className="text-sm text-white break-words mt-1">{item.teamNames.join(' vs ')}</p> : null}
      {item.demo && <Link className="hud-btn inline-block mt-2 text-xs" to={`/replay/${encodeURIComponent(item.demo)}`}>Open replay →</Link>}
    </div>)}
  </div>;
}

export default function ImportActivityMenu({align = 'right'}: {align?: 'left' | 'right'}) {
  const items = useSyncExternalStore(subscribeImports, importSnapshot);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof popoverPosition> | null>(null);
  const [page,setPage]=useState(1);
  // Completed command summaries duplicate the per-demo entries below them.
  const history=items.filter(item=>!(item.id.startsWith('download:')&&item.state==='done'&&item.matchId&&items.some(job=>job.id.startsWith('bridge:')&&job.matchId===item.matchId)));
  const pageCount=Math.max(1,Math.ceil(history.length/5)),currentPage=Math.min(page,pageCount);
  const visible=history.slice((currentPage-1)*5,currentPage*5);
  useEffect(() => {
    if (!position) return;
    panel.current?.focus();
    const outside = (e: PointerEvent) => { if (!trigger.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) setPosition(null); };
    const escape = (e: KeyboardEvent) => { if (e.key==='Escape') {setPosition(null);trigger.current?.focus();} };
    const resize = () => setPosition(null);
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);window.addEventListener('resize',resize);
    return () => {document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',resize);};
  }, [position]);
  const active = items.filter(item => item.state === 'working');
  const unread=items.filter(item=>item.state!=='working'&&!item.toastDismissed);
  const toggle = () => {
    if (position) {setPosition(null);return;}
    setPage(1);
    const rect=trigger.current!.getBoundingClientRect();
    setPosition(popoverPosition({left:align==='right'?rect.right-384:rect.left,top:rect.top,bottom:rect.bottom,width:384}, {width:innerWidth,height:innerHeight},650));
  };
  return <>
    <button ref={trigger} onClick={toggle} aria-expanded={Boolean(position)} aria-haspopup="dialog" className="app-tool-button" aria-label="Import activity" title={active.length?`${active.length} imports in progress`:'Import notifications'}>
      <img src="/icons/notifications.svg" alt="" width="20" height="20"/>
      {!!(active.length||unread.length) && <span aria-label={active.length?`${active.length} active imports`:`${unread.length} new notifications`} className={`absolute -top-1 -right-1 rounded-full px-1 min-w-4 text-[10px] text-scout-bg ${active.length?'bg-scout-accent animate-pulse':'bg-scout-accent'}`}>{active.length||unread.length}</span>}
    </button>
    {position && createPortal(<div ref={panel} role="dialog" tabIndex={-1} className="fixed z-50 overflow-auto rounded-xl border border-white/15 bg-[#111b24] p-3 shadow-xl" aria-label="Import progress"
      style={{left:position.left,top:position.top,width:position.width,maxHeight:position.height}}>
      <div className="flex justify-between items-center gap-2"><h2 className="text-sm font-semibold text-white">Imports {active.length?`· ${active.length} active`:''}</h2><button aria-label="Close import history" onClick={()=>{setPosition(null);trigger.current?.focus();}} className="text-scout-muted px-2 py-1">×</button></div>
      {!items.length && <p className="text-xs text-scout-muted py-4">No recent imports. New uploads and FACEIT imports appear here.</p>}
      {visible.map(item => <div key={item.id} data-import-entry className="py-3 border-b border-white/5 last:border-0">
        <p className="text-sm font-semibold text-white truncate" title={item.teamNames?.join(' vs ')||item.demo||item.label}>{item.teamNames?.join(' vs ')||item.demo||item.label}</p>
        {(item.teamNames?.length||item.demo) && <p className="text-xs text-scout-text mt-1 line-clamp-1" title={item.label}>{item.label}</p>}
        <p className="text-[10px] text-scout-muted mt-1">{item.state==='working'?'In progress':item.state==='done'?'Ready':'Failed'} · {new Date(item.updatedAt??Date.now()).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</p>
        {item.state === 'working' && item.progress!==undefined && <progress aria-label={item.label} max={100} value={item.progress} className="w-full accent-scout-accent"/>}
        {item.state==='working' && item.progress!==undefined && <p className="text-[10px] text-scout-muted">{item.progress}%{item.etaSeconds!==undefined?` · Upload ≈ ${item.etaSeconds<60?`${item.etaSeconds}s`:`${Math.ceil(item.etaSeconds/60)}m`} left; analysis follows`:''}</p>}
        {item.error && <p className="text-xs text-scout-red line-clamp-2 break-words" title={item.error}>{item.error}</p>}
        {item.demo && <Link onClick={()=>setPosition(null)} className="text-xs text-scout-accent" to={`/replay/${encodeURIComponent(item.demo)}`}>Replay →</Link>}
      </div>)}
      {history.length>5 && <nav aria-label="Import history pages" className="flex items-center justify-between gap-2 pt-3 text-xs">
        <button className="hud-btn !text-xs" aria-label="Previous imports page" disabled={currentPage===1} onClick={()=>setPage(currentPage-1)}>Previous</button>
        <span className="text-scout-muted">{currentPage} / {pageCount}</span>
        <button className="hud-btn !text-xs" aria-label="Next imports page" disabled={currentPage===pageCount} onClick={()=>setPage(currentPage+1)}>Next</button>
      </nav>}
    </div>,document.body)}
  </>;
}
