import { useEffect, useMemo, useRef, useState } from "react";
import type { RadarInfo } from "../api/client";
import type { ScoutRound } from "../utils/teamScout";
import { snapshotAt } from "../utils/replayState";

const colors=["#5ee0c2","#DCBF6E","#5B9BD5","#c69bf4","#f58c82","#92bd62","#f3ab66"];
const utilityColors:Record<string,string>={smokegrenade:"#d6e1e9",hegrenade:"#f58c82",flashbang:"#DCBF6E",molotov:"#ff944b"};
const utilityLabels:Record<string,string>={smokegrenade:"Smoke",hegrenade:"HE",flashbang:"Flash",molotov:"Molotov"};
type RadarPath={key:string;label:string;segments:number[][]};
export default function TeamScoutExplorer({rounds,radar,teamName,postplant}: {rounds:ScoutRound[];radar:RadarInfo;teamName:string;postplant:boolean}) {
  const [mode,setMode]=useState<"movement"|"utility">("movement");
  const [hiddenPlayers,setHiddenPlayers]=useState<Set<string>>(new Set());
  const [utilities,setUtilities]=useState<Set<string>>(new Set(Object.keys(utilityColors)));
  const [highlight,setHighlight]=useState<{key:string;label:string}|null>(null);
  const [elapsed,setElapsed]=useState(30);const [playing,setPlaying]=useState(false);
  const canvas=useRef<HTMLCanvasElement>(null);
  const paths=useRef<RadarPath[]>([]);
  const players=useMemo(()=>Array.from(new Map(rounds.flatMap(r=>r.players.map(p=>[p.steamid,p] as const))).values()),[rounds]);
  const playerColors=useMemo(()=>new Map(players.map((p,i)=>[p.steamid,colors[i%colors.length]])),[players]);
  const duration=Math.ceil(Math.max(1,...rounds.map(r=>r.duration)));
  useEffect(()=>{setElapsed(Math.min(30,duration));setPlaying(false);},[rounds,duration]);
  useEffect(()=>setHiddenPlayers(new Set()),[teamName]);
  useEffect(()=>setHighlight(null),[mode,rounds,hiddenPlayers,utilities]);
  useEffect(()=>{
    if(!playing)return;const timer=window.setInterval(()=>setElapsed(v=>{if(v>=duration){setPlaying(false);return duration;}return Math.min(duration,v+0.5);}),250);
    return ()=>window.clearInterval(timer);
  },[playing,duration]);
  useEffect(()=>{
    const ctx=canvas.current?.getContext("2d");if(!ctx)return;ctx.clearRect(0,0,1024,1024);paths.current=[];
    const xy=(x:number,y:number)=>[(x-radar.pos_x)/radar.scale,(radar.pos_y-y)/radar.scale];
    const alpha=Math.max(0.06,Math.min(0.7,2.5/Math.sqrt(Math.max(1,rounds.length))));
    const demos=[...new Set(rounds.map(r=>r.demoFile))];
    for(const r of rounds) {
      const until=r.anchor+elapsed*r.tickRate;
      if(mode==="movement") for(const p of r.players) {
        if(hiddenPlayers.has(p.steamid))continue;
        const path:RadarPath={key:`${r.key}:player:${p.steamid}`,label:`${p.name} · Match ${demos.indexOf(r.demoFile)+1} · R${r.round.num} · ${r.side}`,segments:[]};
        ctx.strokeStyle=playerColors.get(p.steamid)!;ctx.globalAlpha=highlight?.key===path.key?1:alpha;ctx.lineWidth=highlight?.key===path.key?5:2.5;ctx.setLineDash([]);ctx.beginPath();
        let started=false,lastTick=-Infinity,lastX=0,lastY=0;
        for(const s of r.positions[p.steamid]) {
          if(s.t>until)break;
          if(!s.alive){started=false;continue;}
          const [x,y]=xy(s.x,s.y);
          if(!started || s.t-lastTick>r.tickRate*2)ctx.moveTo(x,y);else {ctx.lineTo(x,y);path.segments.push([lastX,lastY,x,y]);}
          started=true;lastTick=s.t;lastX=x;lastY=y;
        }
        ctx.stroke();
        paths.current.push(path);
        if(elapsed<=r.duration) {
          const s=snapshotAt(r.positions[p.steamid],until);
          if(s?.alive && s.t<=until) {const [x,y]=xy(s.x,s.y);ctx.globalAlpha=Math.min(1,alpha*1.8);ctx.fillStyle=playerColors.get(p.steamid)!;ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();}
        }
      }
      if(mode==="utility") for(const [index,g] of r.grenades.entries()) {
        if(hiddenPlayers.has(g.thrower) || !utilities.has(g.type) || g.points[0][0]>until)continue;
        const path:RadarPath={key:`${r.key}:throw:${index}`,label:`${r.players.find(p=>p.steamid===g.thrower)?.name ?? "Player"} · ${utilityLabels[g.type] ?? g.type} · Match ${demos.indexOf(r.demoFile)+1} · R${r.round.num} · ${r.side}`,segments:[]};
        ctx.strokeStyle=utilityColors[g.type] ?? "#5ee0c2";ctx.fillStyle=ctx.strokeStyle;ctx.globalAlpha=highlight?.key===path.key?1:alpha;ctx.lineWidth=highlight?.key===path.key?5:2;ctx.setLineDash([6,4]);ctx.beginPath();
        let first=true,lastX=0,lastY=0;
        for(const [tick,wx,wy] of g.points) {
          if(tick<r.anchor || tick>until)continue;const [x,y]=xy(wx,wy);if(first)ctx.moveTo(x,y);else {ctx.lineTo(x,y);path.segments.push([lastX,lastY,x,y]);}first=false;lastX=x;lastY=y;
        }
        ctx.stroke();
        ctx.setLineDash([]);
        if((g.detonate_tick ?? g.points[g.points.length-1][0])<=until) {
          const [,wx,wy]=g.points[g.points.length-1], [x,y]=xy(wx,wy);ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();
          path.segments.push([x,y,x,y]);
        }
        paths.current.push(path);
      }
    }
    ctx.globalAlpha=1;
  },[rounds,elapsed,mode,hiddenPlayers,utilities,radar,playerColors,highlight]);
  const throws=useMemo(()=>rounds.flatMap(r=>r.grenades.map((g,index)=>({r,g,index}))).filter(({g})=>!hiddenPlayers.has(g.thrower) && utilities.has(g.type)),[rounds,hiddenPlayers,utilities]);
  const playerStats=useMemo(()=>new Map(players.map(p=>[p.steamid,{
    rounds:rounds.filter(r=>r.positions[p.steamid]?.length).length,
    throws:rounds.reduce((sum,r)=>sum+r.grenades.filter(g=>g.thrower===p.steamid).length,0),
  }])),[players,rounds]);
  return <section className="hud-panel p-5" aria-label="Team movement and utility explorer">
    <div className="flex flex-wrap justify-between gap-3 items-start"><div><h2 className="text-lg font-semibold">{teamName} · Movement & utility</h2>
      <p className="text-xs text-scout-muted mt-1">{rounds.length} rounds overlaid · {postplant?"Aligned to bomb plant":"Aligned to freeze-time end"} · Only this team’s players and utility</p></div>
      <div className="flex gap-1">{(["movement","utility"] as const).map(m=><button key={m} aria-pressed={mode===m} onClick={()=>setMode(m)} className={`hud-tab ${mode===m?"hud-tab-active":"hud-tab-idle"}`}>{m==="movement"?"Movement":"Utility"}</button>)}</div></div>
    <div className="flex flex-wrap gap-3 mt-4">
      {mode==="utility" && <div role="group" aria-label="Scout utility types" className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-scout-muted mr-1">Utility</span>{Object.entries(utilityLabels).map(([type,label])=><button key={type} aria-pressed={utilities.has(type)}
          onClick={()=>setUtilities(prev=>{const next=new Set(prev);if(next.has(type))next.delete(type);else next.add(type);return next;})}
          className="rounded border px-3 py-1.5 text-xs font-semibold transition-colors" style={{borderColor:utilityColors[type],background:utilities.has(type)?utilityColors[type]:"transparent",color:utilities.has(type)?"#0b1118":utilityColors[type]}}>{label}</button>)}
        <button className="hud-btn text-xs" onClick={()=>setUtilities(new Set(Object.keys(utilityColors)))}>All utility</button>
      </div>}
    </div>
    <div className="grid xl:grid-cols-[260px_minmax(0,1fr)] gap-4 mt-3 items-start">
      <aside className="hud-panel p-3" aria-label={`${teamName} player selection`}>
        <div className="flex items-center justify-between gap-2 mb-3"><h3 className="font-semibold text-sm truncate">{teamName}</h3>
          <input type="checkbox" aria-label="Select all scout players" checked={players.length>0 && players.every(p=>!hiddenPlayers.has(p.steamid))}
            ref={node=>{if(node)node.indeterminate=players.some(p=>hiddenPlayers.has(p.steamid)) && players.some(p=>!hiddenPlayers.has(p.steamid));}}
            onChange={e=>setHiddenPlayers(e.target.checked?new Set():new Set(players.map(p=>p.steamid)))} className="accent-scout-accent"/>
        </div>
        <table className="w-full text-sm"><thead className="text-[10px] uppercase text-scout-muted"><tr><th className="text-left pb-2 font-normal">Player</th><th className="text-right pb-2 font-normal">Rounds</th><th className="text-right pb-2 font-normal">Throws</th></tr></thead>
          <tbody>{players.map(p=><tr key={p.steamid} className={hiddenPlayers.has(p.steamid)?"opacity-50":""}>
            <td className="py-2"><label className="flex gap-2 items-center cursor-pointer"><input type="checkbox" aria-label={`Show ${p.name}`} checked={!hiddenPlayers.has(p.steamid)}
              onChange={e=>setHiddenPlayers(prev=>{const next=new Set(prev);if(e.target.checked)next.delete(p.steamid);else next.add(p.steamid);return next;})} className="accent-scout-accent"/>
              <span className="w-2 h-2 rounded-full shrink-0" style={{background:playerColors.get(p.steamid)}}/><span className="font-semibold break-all">{p.name}</span></label></td>
            <td className="text-right font-mono text-xs">{playerStats.get(p.steamid)?.rounds}</td><td className="text-right font-mono text-xs">{playerStats.get(p.steamid)?.throws}</td>
          </tr>)}</tbody>
        </table>
        <p className="text-xs text-scout-muted mt-2">Select players to show their paths and utility. Counts cover the selected rounds.</p>
      </aside>
    <div className="relative mx-auto w-full max-w-[740px] aspect-square rounded-lg overflow-hidden bg-black/10">
      <img src={radar.image_url} alt={`${teamName} movement on map radar`} className="absolute inset-0 w-full h-full"/>
      <canvas ref={canvas} width={1024} height={1024} className="absolute inset-0 w-full h-full" aria-label="Team radar paths; hover a line to identify player, match and round"
        onPointerLeave={()=>setHighlight(null)} onPointerMove={e=>{
          const bounds=e.currentTarget.getBoundingClientRect(),x=(e.clientX-bounds.left)*1024/bounds.width,y=(e.clientY-bounds.top)*1024/bounds.height;
          let best:RadarPath|null=null,distance=10*1024/bounds.width;
          for(const path of paths.current) for(const [ax,ay,bx,by] of path.segments) {
            const dx=bx-ax,dy=by-ay,t=Math.max(0,Math.min(1,((x-ax)*dx+(y-ay)*dy)/(dx*dx+dy*dy || 1)));
            const d=Math.hypot(x-ax-t*dx,y-ay-t*dy);if(d<distance){best=path;distance=d;}
          }
          setHighlight(prev=>prev?.key===best?.key?prev:best?{key:best.key,label:best.label}:null);
        }}/>
      {highlight && <div role="status" className="absolute bottom-3 left-3 right-3 pointer-events-none rounded bg-black/90 p-3 text-sm">{highlight.label}</div>}
      {!rounds.length && <div className="absolute inset-0 flex items-center justify-center"><p role="status" className="hud-panel p-4 text-sm">No rounds match these filters.</p></div>}
    </div>
    </div>
    <div className="flex items-center gap-3 mt-3"><button className="hud-btn" disabled={!rounds.length} onClick={()=>{if(elapsed>=duration)setElapsed(0);setPlaying(v=>!v);}}>{playing?"Pause":"Play"}</button>
      <input type="range" aria-label="Scout elapsed time" min={0} max={duration} step={0.5} value={elapsed} onChange={e=>{setPlaying(false);setElapsed(Number(e.target.value));}} className="flex-1 accent-scout-accent"/>
      <span className="text-xs font-mono w-28 text-right">{elapsed.toFixed(1)}s / {duration}s</span></div>
    <p className="text-xs text-scout-muted mt-2">{postplant?"Seconds after plant":"Seconds into live round"}. Paths accumulate up to the selected time; dots show players in rounds still in progress. Deselect players or matches to reduce overlap.</p>
    <p className="text-xs text-scout-muted mt-2">{mode==="movement"?"Solid lines = player movement (colours match the roster); dots = live positions.":"Dashed lines = grenade flight (colours match the utility buttons); dots = landing positions."} Hover a line to highlight its player, match and round.</p>
    {mode==="utility" &&
      <details className="mt-3 text-sm"><summary className="cursor-pointer">Throws in selected rounds ({throws.length})</summary><div className="max-h-64 overflow-auto mt-2">{throws.map(({r,g,index})=><button key={`${r.key}:${index}`} className="flex w-full gap-3 border-b border-white/5 py-2 text-xs text-left hover:bg-white/5"
        onClick={()=>{setPlaying(false);setElapsed(Math.max(0,((g.detonate_tick ?? g.points[g.points.length-1][0])-r.anchor)/r.tickRate));setHighlight({key:`${r.key}:throw:${index}`,label:`${r.players.find(p=>p.steamid===g.thrower)?.name} · ${utilityLabels[g.type]} · ${r.demoFile} · R${r.round.num} · ${r.side}`});}}>
        <span className="flex-1">{r.players.find(p=>p.steamid===g.thrower)?.name}</span><span style={{color:utilityColors[g.type]}}>{utilityLabels[g.type]}</span><span>R{r.round.num} · {r.side}</span><span>{((g.points[0][0]-r.anchor)/r.tickRate).toFixed(1)}s</span><span className="text-scout-accent">Highlight</span></button>)}</div></details>}
  </section>;
}
