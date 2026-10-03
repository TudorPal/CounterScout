import {useEffect,useState} from "react";
import {Link} from "react-router-dom";
import {configureFaceitDownloads,downloadBridgedFaceitMatch,fetchFaceitTeamMatches,getFaceitBridgeLibrary,getFaceitBridgeSetup,FaceitBridgeLibrary} from "../api/client";
import SearchableSelect from "./SearchableSelect";
import Select from "./Select";
import {bridgeMatchState} from "../utils/faceitBridgeState";

const LAST_TEAM="counterscout-faceit-team-url";
const wake=()=>window.postMessage({type:"COUNTERSCOUT_BRIDGE_WAKE"},window.location.origin);
const message=(e:any)=>e?.response?.data?.detail || e?.message || "Request failed";
function date(value:number|string|null) {
  if(!value) return "—";
  const numeric=typeof value === "number" || /^\d+$/.test(value) ? Number(value) : null;
  const timestamp=numeric!=null ? numeric*(numeric<1e12?1000:1) : value;
  const parsed=new Date(timestamp);
  return Number.isNaN(parsed.getTime())?"—":parsed.toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"});
}
function matchTime(value:number|string|null):number {
  if(!value) return 0;
  const numeric=typeof value === "number" || /^\d+$/.test(value) ? Number(value) : null;
  return numeric!=null?numeric*(numeric<1e12?1000:1):Date.parse(value as string) || 0;
}
export default function FaceitBridgePanel() {
  const [url,setUrl]=useState(()=>localStorage.getItem(LAST_TEAM) || "");
  const [setup,setSetup]=useState<Awaited<ReturnType<typeof getFaceitBridgeSetup>>|null>(null);
  const [data,setData]=useState<FaceitBridgeLibrary>({matches:[],commands:[],imports:[]});
  const [folder,setFolder]=useState("");
  const [error,setError]=useState<string|null>(null), [busy,setBusy]=useState(false);
  const [filter,setFilter]=useState("all"), [team,setTeam]=useState("all");
  const [teamQuery,setTeamQuery]=useState("");
  const [connection,setConnection]=useState<"checking"|"connected"|"disconnected"|"paused">("checking");
  const [connectionError,setConnectionError]=useState("");
  const [loadedVersion,setLoadedVersion]=useState<string|null>(null);
  const [pendingDownload,setPendingDownload]=useState<string|null>(null);
  const [copied,setCopied]=useState(false);
  const [showCode,setShowCode]=useState(false);
  useEffect(()=>{
    let cancelled=false;
    let handshake=false, latestSeen=false, refreshing=false, timedOut=false;
    const request_id=crypto.randomUUID();
    const check=()=>window.postMessage({type:"COUNTERSCOUT_BRIDGE_STATUS_REQUEST",request_id},window.location.origin);
    const receive=(event:MessageEvent)=>{
      if(event.source!==window || event.origin!==window.location.origin) return;
      if(event.data?.type==="COUNTERSCOUT_BRIDGE_READY") {check();return;}
      if(event.data?.type!=="COUNTERSCOUT_BRIDGE_STATUS" || event.data.request_id!==request_id) return;
      handshake=true;setConnection(event.data.connected?(event.data.enabled?"connected":"paused"):"disconnected");
      setConnectionError(event.data.error || "");
      setLoadedVersion(event.data.version || null);
    };
    window.addEventListener("message",receive);
    const refresh=async()=>{
      if(document.hidden || refreshing) return;
      refreshing=true;
      try {
        const [s,d]=await Promise.all([getFaceitBridgeSetup(),getFaceitBridgeLibrary()]);
        if(!cancelled) {
          latestSeen=Boolean(s.last_seen && Date.now()/1000-Number(s.last_seen)<75);
          setSetup(s);setData(d);setFolder(current=>current || s.downloads_dir);
          if(!handshake && latestSeen) setConnection("connected");
          if(!handshake && !latestSeen) setConnection(timedOut?"disconnected":"checking");
          if(!handshake && !latestSeen) check();
        }
      } catch(e) {if(!cancelled)setError(message(e));}finally{refreshing=false;}
    };
    void refresh();check();wake();const timer=setInterval(refresh,4000);
    const retries=[1000,2500].map(ms=>setTimeout(()=>{if(!handshake)check();},ms));
    const timeout=setTimeout(()=>{timedOut=true;if(!handshake && !latestSeen)setConnection("disconnected");},6000);
    const visible=()=>{if(!document.hidden){handshake=false;check();void refresh();}};
    document.addEventListener("visibilitychange",visible);
    return()=>{cancelled=true;clearInterval(timer);clearTimeout(timeout);retries.forEach(clearTimeout);window.removeEventListener("message",receive);document.removeEventListener("visibilitychange",visible);};
  },[]);
  const active=connection==="connected";
  const automationReady=Boolean(setup?.automation_ready && (!loadedVersion || loadedVersion===setup.extension_version));
  const needsReload=Boolean(setup && !automationReady);
  const maps=[...new Set(data.matches.flatMap(m=>m.maps?.length?m.maps:m.map_name?[m.map_name]:[]))].sort();
  const teams=[...new Map(data.matches.flatMap(m=>[m.team1,m.team2]).filter(t=>t.id).map(t=>[t.id,t.name])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
  const query=teamQuery.trim().toLocaleLowerCase();
  const matches=data.matches.filter(m=>(filter==="all" || m.maps?.includes(filter) || m.map_name===filter) && (query?[m.team1.name,m.team2.name].some(name=>name.toLocaleLowerCase().includes(query)):(team==="all" || m.team1.id===team || m.team2.id===team)))
    .sort((a,b)=>matchTime(b.finished_at)-matchTime(a.finished_at));
  const teamCommand=data.commands.find(command=>command.kind!=="download");
  const searching=teamCommand?.kind==="search" && ["queued","running"].includes(teamCommand.state);
  async function fetchTeam(value=url) {
    setBusy(true);setError(null);
    try {await fetchFaceitTeamMatches(value);localStorage.setItem(LAST_TEAM,value);wake();setData(await getFaceitBridgeLibrary());}
    catch(e){setError(message(e));}finally{setBusy(false);}
  }
  async function download(id:string) {
    setPendingDownload(id);setError(null);
    try {await downloadBridgedFaceitMatch(id);wake();setData(await getFaceitBridgeLibrary());}
    catch(e){setError(message(e));}finally{setPendingDownload(null);}
  }
  return <div className="space-y-5">
    <div className="hud-panel p-5 space-y-4">
      <div className="flex justify-between gap-4"><div><span className="section-eyebrow">FACEIT · NO API KEY</span><h2 className="text-lg text-white font-semibold mt-1">Browse a team’s matches</h2></div>
        <span role="status" title={connectionError || undefined} className={`text-xs shrink-0 pt-1 ${active?"text-scout-green":"text-scout-muted"}`}>{connection==="checking"?"◌ Checking extension…":active?`● Extension connected${loadedVersion || setup?.extension_version?` · v${loadedVersion || setup?.extension_version}`:""}`:connection==="paused"?"○ Automatic imports paused":"○ Extension not connected"}</span></div>
      {needsReload && connection!=="checking" && <div role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200 leading-relaxed">
        <strong>Reload the Chrome extension to enable Download & import.</strong> Required version: {setup?.required_version || "0.2.2"}{setup?.extension_version?` · Loaded: ${setup.extension_version}`:" · Updated version not confirmed"}.
        <p className="mt-1">Open <code>chrome://extensions</code>, choose ↻ Reload for <strong>CounterScout — FACEIT Bridge</strong>, then refresh Import and any FACEIT tabs. Your pairing code and downloads are preserved.</p>
      </div>}
      <p className="text-sm text-scout-muted">Find a team by name or URL, then download and import its matches with both team rosters. Browsing a match room never starts a download on its own.</p>
      <div className="flex flex-wrap gap-2"><input aria-label="FACEIT team name or URL" className="hud-input flex-1 min-w-[240px]" placeholder="Team name or https://www.faceit.com/en/teams/…" value={url} onChange={e=>setUrl(e.target.value)} onKeyDown={e=>{if(e.key==="Enter" && url.trim() && !busy && !searching)void fetchTeam();}}/>
        <button className="hud-btn-primary" disabled={!url.trim() || busy || searching} onClick={()=>void fetchTeam()}>{busy?"Queueing…":searching?"Finding teams…":"Fetch team matches"}</button></div>
      {error && <p role="alert" className="text-xs text-scout-red">{error}</p>}
      {teamCommand && <p role="status" className={`text-xs ${teamCommand.state==="error"?"text-scout-red":"text-scout-muted"}`}>
        {teamCommand.error || (teamCommand.state==="queued"?"Waiting for the paired extension. Keep Chrome and the backend running.":teamCommand.state==="running"?(teamCommand.kind==="search"?"Chrome is searching FACEIT for teams…":"Chrome is reading team history and match details…"):teamCommand.kind==="search"?"Choose the correct team below. Names are not unique on FACEIT.":"Team history synced.")}</p>}
      {teamCommand?.kind==="search" && teamCommand.state==="done" && <div className="grid sm:grid-cols-2 gap-2" aria-label="FACEIT team search results">
        {teamCommand.results?.map(result=><div key={result.id} className="border border-white/10 rounded-xl p-3 flex items-center justify-between gap-3 bg-white/[.02]">
          <div className="min-w-0"><a href={result.url} target="_blank" rel="noreferrer" className="text-sm text-white hover:text-scout-accent">{result.name} ↗</a><p className="text-[11px] text-scout-muted truncate">{[result.game,result.members?`${result.members} members`:null,result.nickname!==result.name?result.nickname:null,`ID ${result.id.slice(0,8)}`].filter(Boolean).join(" · ")}</p></div>
          <button className="hud-btn text-xs shrink-0" disabled={busy} onClick={()=>{setUrl(result.url);void fetchTeam(result.url);}}>Use this team</button>
        </div>)}
      </div>}
      <details className="border-t border-white/10 pt-3">
        <summary className="text-sm cursor-pointer text-scout-accent">Extension setup & monitored folder</summary>
        <ol className="list-decimal pl-5 text-xs text-scout-muted mt-3 space-y-2">
          <li>In Chrome, open <code>chrome://extensions</code>, enable Developer mode, choose <strong>Load unpacked</strong>, and select <code className="break-all">{setup?.extension_path || "browser-extension"}</code>.</li>
          <li>Open the extension popup, paste the pairing code below, enable automatic imports, and choose <strong>Save & connect</strong>.</li>
          <li>After an extension update, choose <strong>Reload</strong> in Chrome’s extension manager, then refresh this app and any already-open FACEIT tabs. Sign in to FACEIT normally to download demos.</li>
        </ol>
        <div className="flex gap-2 items-center my-3"><input aria-label="Extension pairing code" className="hud-input flex-1 min-w-0 text-xs" type={showCode?"text":"password"} readOnly value={setup?.token || ""}/><button className="hud-btn text-xs" aria-pressed={showCode} onClick={()=>setShowCode(!showCode)}>{showCode?"Hide":"Show"}</button><button className="hud-btn text-xs" disabled={!setup} onClick={async()=>{try{await navigator.clipboard.writeText(setup!.token);setCopied(true);}catch{setError("Choose Show, then select and copy the pairing code manually.");}}}>{copied?"Copied":"Copy code"}</button></div>
        <label className="text-xs text-scout-muted block mb-2" htmlFor="faceit-download-folder">Chrome’s download folder (only this folder can be read)</label>
        <div className="flex gap-2"><input id="faceit-download-folder" className="hud-input flex-1 text-xs" value={folder} onChange={e=>setFolder(e.target.value)}/><button className="hud-btn text-xs" disabled={busy} onClick={async()=>{setBusy(true);try{await configureFaceitDownloads(folder);setError(null);}catch(e){setError(message(e));}finally{setBusy(false);}}}>Save folder</button></div>
        <p className="text-xs text-scout-muted mt-3">No FACEIT API key or copied login token is needed. Imports wait for download completion, preserve the original file, and run Replay, roster and lineup ingestion. Compressed .dem.zst and .dem.gz files are supported.</p>
      </details>
    </div>
    <section className="hud-panel p-4 space-y-3" aria-label="FACEIT match library">
      <div className="flex flex-wrap gap-3 items-center justify-between"><div><h3 className="text-sm text-white font-semibold">Match library <span className="text-scout-muted">({matches.length})</span></h3><p className="text-[11px] text-scout-muted mt-1">Download & import opens Chrome and downloads every available demo in the series.</p></div><div className="flex flex-wrap gap-2">
        <SearchableSelect ariaLabel="Filter FACEIT team" value={team} onChange={setTeam} onSearch={setTeamQuery} options={[{value:"all",label:"All teams",hint:String(data.matches.length)},...teams.map(([id,name])=>({value:id,label:name,hint:String(data.matches.filter(m=>m.team1.id===id || m.team2.id===id).length)}))]}/>
        <Select title="Filter FACEIT map" className="text-xs" minWidth={140} value={filter} onChange={setFilter} options={[{value:"all",label:"All maps"},...maps.map(map=>({value:map,label:map.replace(/^de_/,"")}))]}/>
        {(team!=="all" || filter!=="all") && <button className="text-xs text-scout-muted hover:text-white px-2" onClick={()=>{setTeam("all");setFilter("all");setTeamQuery("");}}>Reset</button>}
      </div></div>
      {!matches.length?<p className="text-sm text-scout-muted py-6">{data.matches.length?"No matches match these filters.":"Fetch a team above, or open its FACEIT Stats page and select Sync current page in the extension."}</p>:
        <div className="overflow-x-auto"><table className="w-full text-xs text-left"><thead className="text-scout-muted"><tr>{["Date","Match","Map","Score","Import",""].map((title,i)=><th key={i} className="px-2 py-2 font-normal">{title}</th>)}</tr></thead>
          <tbody>{matches.map(m=>{const jobs=data.imports.filter(j=>j.match_id===m.match_id),command=data.commands.find(c=>c.kind==="download" && c.match_id===m.match_id),{waiting,demos,label,error:rowError,tone}=bridgeMatchState(jobs,command);return <tr key={m.match_id} className="border-t border-white/5 hover:bg-white/[.025]">
            <td className="p-2 whitespace-nowrap text-scout-muted">{date(m.finished_at)}</td><td className="p-2"><span className="text-white">{m.team1.name}</span><span className="text-scout-muted"> vs </span><span className="text-white">{m.team2.name}</span></td>
            <td className="p-2 text-scout-muted">{(m.maps?.length?m.maps:m.map_name?[m.map_name]:[]).map(map=>map.replace("de_","")).join(", ") || "—"}</td><td className="p-2 font-mono whitespace-nowrap">{m.team1.score!=null && m.team2.score!=null?`${m.team1.score} : ${m.team2.score}`:"—"}</td>
            <td className={`p-2 ${tone==="error"?"text-scout-red":tone==="warning"?"text-amber-300":tone==="success"?"text-scout-green":"text-scout-muted"}`} title={rowError || "Download from FACEIT with the paired extension enabled"}>
              {label}
              {rowError && <p className="max-w-[220px] text-[10px] mt-1 leading-relaxed whitespace-normal">{rowError}</p>}
            </td>
            <td className="p-2"><div className="flex flex-wrap gap-3 items-center min-w-[240px]"><button className="hud-btn text-xs !px-3 !py-1.5" disabled={!active || !automationReady || waiting || pendingDownload===m.match_id} title={!automationReady?"Reload the Chrome extension to version 0.2.2, then refresh Import":!active?"Connect and enable the Chrome extension first":"Download all available demos; completed files are imported with both team names"} onClick={()=>void download(m.match_id)}>{waiting || pendingDownload===m.match_id?"In progress…":"Download & import"}</button><a className="text-scout-accent hover:underline whitespace-nowrap" href={m.faceit_url} target="_blank" rel="noreferrer">Match room ↗</a>{demos.map((demo,i)=><Link key={demo} title={demo} className="text-scout-accent hover:underline" to={`/replay/${encodeURIComponent(demo)}`}>Replay{demos.length>1?` ${i+1}`:""}</Link>)}</div></td>
          </tr>;})}</tbody></table></div>}
    </section>
    {!!data.imports.length && <section className="hud-panel p-4 space-y-2"><h3 className="text-sm text-white font-semibold">Recent imports</h3>{data.imports.slice(0,6).map(job=><div key={job.id} className="text-xs flex flex-wrap gap-2 border-t border-white/5 pt-2"><span className={job.state==="error"?"text-scout-red":"text-scout-accent"}>{job.state}</span><span className="text-scout-muted">{job.error || job.demo_file || job.match_id}</span></div>)}</section>}
  </div>;
}
