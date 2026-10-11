import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import {createPortal} from 'react-dom';
import {Link} from 'react-router-dom';
import {getFaceitBridgeLibrary, getIngestionStatus} from '../api/client';
import {dismissImport, importSnapshot, subscribeImports, updateImport} from '../utils/importActivity';
import {popoverPosition} from '../utils/popoverPosition';

/** One app-level poller; status and uploads survive route changes. */
export function ImportActivityMonitor() {
  useEffect(() => {
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    const observed = new Map<string, string>();
    let initial = true, pipeline = false;
    async function poll() {
      const [bridge, ingest] = await Promise.allSettled([getFaceitBridgeLibrary(), getIngestionStatus()]);
      if (stopped) return;
      if (bridge.status === 'fulfilled') {
        for (const item of bridge.value.imports ?? []) {
          const previous = observed.get(item.id);
          observed.set(item.id, item.state);
          if (previous === item.state || (initial && ['done','error'].includes(item.state))) continue;
          updateImport({id: `bridge:${item.id}`, label: item.state === 'done' ? 'FACEIT demo ready' : item.state === 'error' ? 'FACEIT import failed' : item.state === 'queued' ? 'FACEIT demo queued' : 'Analysing FACEIT demo',
            state: item.state === 'done' ? 'done' : item.state === 'error' ? 'error' : 'working', demo: item.demo_file ?? undefined, error: item.error ?? undefined});
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
  const notifications = items.filter(item => item.state !== 'working').slice(0, 3);
  return <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-[min(360px,calc(100vw-40px))]" aria-live="polite">
    {notifications.map(item => <div key={item.id} className="rounded-xl border border-white/15 bg-[#111b24] p-4 shadow-xl">
      <div className="flex gap-3 items-start"><p className={`flex-1 text-sm font-semibold ${item.state === 'error' ? 'text-scout-red' : 'text-scout-accent'}`}>{item.label}</p>
        <button aria-label="Dismiss import notification" onClick={() => dismissImport(item.id)} className="text-scout-muted">×</button></div>
      {item.error && <p className="text-xs text-scout-muted mt-1">{item.error}</p>}
      {item.demo && <Link className="hud-btn inline-block mt-2 text-xs" to={`/replay/${encodeURIComponent(item.demo)}`}>Open replay →</Link>}
    </div>)}
  </div>;
}

export default function ImportActivityMenu({align = 'right'}: {align?: 'left' | 'right'}) {
  const items = useSyncExternalStore(subscribeImports, importSnapshot);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<ReturnType<typeof popoverPosition> | null>(null);
  useEffect(() => {
    if (!position) return;
    const outside = (e: PointerEvent) => { if (!trigger.current?.contains(e.target as Node) && !panel.current?.contains(e.target as Node)) setPosition(null); };
    const escape = (e: KeyboardEvent) => { if (e.key==='Escape') {setPosition(null);trigger.current?.focus();} };
    const resize = () => setPosition(null);
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape);window.addEventListener('resize',resize);
    return () => {document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);window.removeEventListener('resize',resize);};
  }, [position]);
  if (!items.length) return null;
  const active = items.filter(item => item.state === 'working');
  const toggle = () => {
    if (position) {setPosition(null);return;}
    const rect=trigger.current!.getBoundingClientRect();
    setPosition(popoverPosition({left:align==='right'?rect.right-288:rect.left,top:rect.top,bottom:rect.bottom,width:288}, {width:innerWidth,height:innerHeight},320));
  };
  return <>
    <button ref={trigger} onClick={toggle} aria-expanded={Boolean(position)} className="cursor-pointer hud-btn text-xs" aria-label="Import activity">{active.length ? `Importing (${active.length})…` : 'Imports'}</button>
    {position && createPortal(<div ref={panel} className="fixed z-50 overflow-auto rounded-xl border border-white/15 bg-[#111b24] p-3 shadow-xl" aria-label="Import progress"
      style={{left:position.left,top:position.top,width:position.width,maxHeight:position.height}}>
      {items.map(item => <div key={item.id} className="py-2 border-b border-white/5 last:border-0">
        <p className="text-xs text-scout-text">{item.label}</p>
        {item.state === 'working' && (item.progress !== undefined ? <progress aria-label={item.label} max={100} value={item.progress} className="w-full accent-scout-accent"/> : <p className="text-xs text-scout-muted mt-1 animate-pulse">Please wait…</p>)}
        {item.error && <p className="text-xs text-scout-red">{item.error}</p>}
        {item.demo && <Link onClick={()=>setPosition(null)} className="text-xs text-scout-accent" to={`/replay/${encodeURIComponent(item.demo)}`}>Replay →</Link>}
      </div>)}
    </div>,document.body)}
  </>;
}
