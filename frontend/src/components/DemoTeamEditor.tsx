import { useEffect, useRef, useState } from "react";
import { getMatchInfo, getMatchReplayTimeline, MatchInfoResponse, updateLocalDemoTeamNames } from "../api/client";

export default function DemoTeamEditor({demoFile, onClose, onSaved}: {
  demoFile:string; onClose:()=>void; onSaved:()=>void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [info,setInfo] = useState<MatchInfoResponse | null>(null);
  const [names,setNames] = useState(["", ""]);
  const [error,setError] = useState("");
  const [saving,setSaving] = useState(false);
  useEffect(() => {
    dialog.current?.showModal(); let active=true;
    (async()=>{
      let value=await getMatchInfo(demoFile);
      if (!value.team1 || !value.team2) {await getMatchReplayTimeline(demoFile);value=await getMatchInfo(demoFile);}
      if(active) {setInfo(value);setNames([value.team1?.name ?? "",value.team2?.name ?? ""]);}
    })().catch(e=>{if(active)setError(e?.response?.data?.detail ?? "Could not load the demo roster.");});
    return ()=>{active=false;};
  },[demoFile]);
  const save=async()=>{
    setSaving(true);setError("");
    try {await updateLocalDemoTeamNames(demoFile,names[0],names[1]);onSaved();}
    catch(e:any) {setError(e?.response?.data?.detail ?? "Could not save team names.");}
    finally {setSaving(false);}
  };
  return <dialog ref={dialog} onCancel={e=>{e.preventDefault();if(!saving)onClose();}}
    aria-labelledby="team-editor-title" className="bg-scout-bg text-scout-text rounded-xl border border-scout-border p-6 w-[min(640px,calc(100vw-32px))] backdrop:bg-black/70">
    <h2 id="team-editor-title" className="text-lg font-semibold">Edit demo teams</h2>
    <p className="text-xs text-scout-muted mt-1 break-all">{demoFile}</p>
    <p className="text-sm text-scout-muted my-4">Names belong to these player rosters, not their changing T/CT sides.</p>
    {!info && !error && <p role="status">Loading rosters…</p>}
    <form onSubmit={e=>{e.preventDefault();void save();}}>
      {info && <div className="grid sm:grid-cols-2 gap-4">{[info.team1,info.team2].map((team,i)=><fieldset key={i} className="hud-panel p-4">
        <label htmlFor={`edit-team-${i}`} className="text-xs text-scout-muted">Team {i+1} name</label>
        <input id={`edit-team-${i}`} autoFocus={i===0} required maxLength={80} value={names[i]} className="hud-input w-full mt-2" onChange={e=>setNames(n=>n.map((v,j)=>j===i?e.target.value:v))} disabled={saving}/>
        <ul className="mt-3 text-sm space-y-1">{(team?.players ?? []).map(p=><li key={p}>{p}</li>)}</ul>
      </fieldset>)}</div>}
      {error && <p role="alert" className="text-scout-red text-sm mt-3">{error}</p>}
      <div className="flex justify-end gap-2 mt-5"><button type="button" onClick={onClose} disabled={saving} className="hud-btn">Cancel</button>
        <button disabled={saving || !info?.team1 || !info.team2} className="hud-btn-primary">{saving ? "Saving…" : "Save names"}</button></div>
    </form>
  </dialog>;
}
