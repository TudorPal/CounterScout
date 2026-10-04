import { useEffect, useMemo, useRef, useState } from "react";
import type { RadarInfo } from "../api/client";
import type { ScoutRound } from "../utils/teamScout";
import { snapshotAt } from "../utils/replayState";
import SearchableSelect from "./SearchableSelect";

const colors=["#5ee0c2","#DCBF6E","#5B9BD5","#c69bf4","#f58c82","#92bd62","#f3ab66"];
const utilityColors:Record<string,string>={smokegrenade:"#d6e1e9",hegrenade:"#f58c82",flashbang:"#DCBF6E",molotov:"#ff944b"};
export default function TeamScoutExplorer({rounds,radar,teamName,postplant}: {rounds:ScoutRound[];radar:RadarInfo;teamName:string;postplant:boolean}) {
  const [mode,setMode]=useState<"movement"|"utility">("movement");
  const [player,setPlayer]=useState("");const [utility,setUtility]=useState("all");
  const [elapsed,setElapsed]=useState(30);const [playing,setPlaying]=useState(false);
  const canvas=useRef<HTMLCanvasElement>(null);
  const players=useMemo(()=>Array.from(new Map(rounds.flatMap(r=>r.players.map(p=>[p.steamid,p] as const))).values()),[rounds]);
  const playerColors=useMemo(()=>new Map(players.map((p,i)=>[p.steamid,colors[i%colors.length]])),[players]);
  const duration=Math.ceil(Math.max(1,...rounds.map(r=>r.duration)));
  useEffect(()=>{setElapsed(Math.min(30,duration));setPlaying(false);setPlayer("");},[rounds,duration]);
  useEffect(()=>{
    if(!playing)return;const timer=window.setInterval(()=>setElapsed(v=>{if(v>=duration){setPlaying(false);return duration;}return Math.min(duration,v+0.5);}),250);
    return ()=>window.clearInterval(timer);
  },[playing,duration]);
  useEffect(()=>{
    const ctx=canvas.current?.getContext("2d");if(!ctx)return;ctx.clearRect(0,0,1024,1024);
    const xy=(x:number,y:number)=>[(x-radar.pos_x)/radar.scale,(radar.pos_y-y)/radar.scale];
    const alpha=Math.max(0.06,Math.min(0.7,2.5/Math.sqrt(Math.max(1,rounds.length))));
    for(const r of rounds) {
      const until=r.anchor+elapsed*r.tickRate;
      if(mode==="movement") for(const p of r.players) {
        if(player && p.steamid!==player)continue;
        ctx.strokeStyle=playerColors.get(p.steamid)!;ctx.globalAlpha=alpha;ctx.lineWidth=2.5;ctx.beginPath();
        let started=false,lastTick=-Infinity;
        for(const s of r.positions[p.steamid]) {
          if(s.t>until)break;
          if(!s.alive){started=false;continue;}
          const [x,y]=xy(s.x,s.y);
          if(!started || s.t-lastTick>r.tickRate*2)ctx.moveTo(x,y);else ctx.lineTo(x,y);
          started=true;lastTick=s.t;
        }
        ctx.stroke();
        if(elapsed<=r.duration) {
          const s=snapshotAt(r.positions[p.steamid],until);
          if(s?.alive && s.t<=until) {const [x,y]=xy(s.x,s.y);ctx.globalAlpha=Math.min(1,alpha*1.8);ctx.fillStyle=playerColors.get(p.steamid)!;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();}
        }
      }
      if(mode==="utility") for(const g of r.grenades) {
        if(player && g.thrower!==player || utility!=="all" && g.type!==utility || g.points[0][0]>until)continue;
        ctx.strokeStyle=utilityColors[g.type] ?? "#5ee0c2";ctx.fillStyle=ctx.strokeStyle;ctx.globalAlpha=alpha;ctx.lineWidth=2;ctx.beginPath();
        let first=true;
        for(const [tick,wx,wy] of g.points) {
          if(tick<r.anchor || tick>until)continue;const [x,y]=xy(wx,wy);if(first)ctx.moveTo(x,y);else ctx.lineTo(x,y);first=false;
        }
        ctx.stroke();
        if((g.detonate_tick ?? g.points[g.points.length-1][0])<=until) {
          const [,wx,wy]=g.points[g.points.length-1], [x,y]=xy(wx,wy);ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();
        }
      }
    }
    ctx.globalAlpha=1;
  },[rounds,elapsed,mode,player,utility,radar,playerColors]);
  const throws=useMemo(()=>rounds.flatMap(r=>r.grenades.map(g=>({r,g}))).filter(({g})=>(!player || player===g.thrower) && (utility==="all" || utility===g.type)),[rounds,player,utility]);
  return <section className="hud-panel p-5" aria-label="Team movement and utility explorer">
    <div className="flex flex-wrap justify-between gap-3 items-start"><div><h2 className="text-lg font-semibold">{teamName} · Movement & utility</h2>
      <p className="text-xs text-scout-muted mt-1">{rounds.length} rounds overlaid · {postplant?"Aligned to bomb plant":"Aligned to freeze-time end"} · Only this team’s players and utility</p></div>
      <div className="flex gap-1">{(["movement","utility"] as const).map(m=><button key={m} aria-pressed={mode===m} onClick={()=>setMode(m)} className={`hud-tab ${mode===m?"hud-tab-active":"hud-tab-idle"}`}>{m==="movement"?"Movement":"Utility"}</button>)}</div></div>
    <div className="flex flex-wrap gap-3 mt-4"><SearchableSelect ariaLabel="Scout player" value={player} allValue="" onChange={setPlayer} options={[{value:"",label:"All team players"},...players.map(p=>({value:p.steamid,label:p.name}))]}/>
      {mode==="utility" && <SearchableSelect ariaLabel="Scout grenade type" value={utility} allValue="all" onChange={setUtility} options={[{value:"all",label:"All utility"},{value:"smokegrenade",label:"Smoke"},{value:"flashbang",label:"Flash"},{value:"hegrenade",label:"HE"},{value:"molotov",label:"Molotov"}]}/>}
    </div>
    <div className="relative mx-auto w-full max-w-[740px] aspect-square mt-3 rounded-lg overflow-hidden bg-black/10">
      <img src={radar.image_url} alt={`${teamName} movement on map radar`} className="absolute inset-0 w-full h-full"/>
      <canvas ref={canvas} width={1024} height={1024} className="absolute inset-0 w-full h-full"/>
      {!rounds.length && <div className="absolute inset-0 flex items-center justify-center"><p role="status" className="hud-panel p-4 text-sm">No rounds match these filters.</p></div>}
    </div>
    <div className="flex items-center gap-3 mt-3"><button className="hud-btn" disabled={!rounds.length} onClick={()=>{if(elapsed>=duration)setElapsed(0);setPlaying(v=>!v);}}>{playing?"Pause":"Play"}</button>
      <input type="range" aria-label="Scout elapsed time" min={0} max={duration} step={0.5} value={elapsed} onChange={e=>{setPlaying(false);setElapsed(Number(e.target.value));}} className="flex-1 accent-scout-accent"/>
      <span className="text-xs font-mono w-28 text-right">{elapsed.toFixed(1)}s / {duration}s</span></div>
    <p className="text-xs text-scout-muted mt-2">{postplant?"Seconds after plant":"Seconds into live round"}. Paths accumulate up to the selected time; dots show players in rounds still in progress. Use fewer matches or one player to reduce overlap.</p>
    {mode==="movement"?<div className="flex flex-wrap gap-x-4 gap-y-2 mt-3">{players.filter(p=>!player || player===p.steamid).map(p=><span key={p.steamid} className="text-xs" style={{color:playerColors.get(p.steamid)}}>● {p.name}</span>)}</div>:
      <details className="mt-3 text-sm"><summary className="cursor-pointer">Throws in selected rounds ({throws.length})</summary><div className="max-h-64 overflow-auto mt-2">{throws.map(({r,g},i)=><div key={`${r.key}:${i}`} className="flex gap-3 border-b border-white/5 py-2 text-xs"><span className="flex-1">{r.players.find(p=>p.steamid===g.thrower)?.name}</span><span>{g.type.replace("grenade","")}</span><span>R{r.round.num} · {r.side}</span><span>{((g.points[0][0]-r.anchor)/r.tickRate).toFixed(1)}s</span></div>)}</div></details>}
  </section>;
}
