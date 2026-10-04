import type { MatchInfoResponse, MatchTimeline, TimelineGrenade, TimelinePlayer, TimelinePosition, TimelineRound } from "../api/client";
import { roundAnchor, snapshotAt } from "./replayState";

export type ScoutFilters = {side:"all"|"T"|"CT"; phase:"all"|"postplant"; site:"all"|"A"|"B"|"none"};
export const defaultScoutFilters:ScoutFilters = {side:"all",phase:"all",site:"all"};
export type ScoutSource = {demoFile:string; timeline:MatchTimeline; info:MatchInfoResponse; sids:Set<string>};
export type ScoutRound = {key:string;demoFile:string;round:TimelineRound;side:"T"|"CT";site:string;anchor:number;duration:number;
  players:TimelinePlayer[];positions:Record<string,TimelinePosition[]>;grenades:TimelineGrenade[];tickRate:number};

export function scoutTeamIds(timeline:MatchTimeline, info:MatchInfoResponse, teamName:string) {
  const team=[info.team1,info.team2].find(t=>t?.name.toLocaleLowerCase()===teamName.toLocaleLowerCase());
  const ids=new Set(team?.players_detailed?.map(p=>p.steamid).filter(Boolean));
  const names=new Set(team?.players.map(n=>n.trim().toLocaleLowerCase()));
  return new Set(timeline.players.filter(p=>ids.has(p.steamid) || names.has(p.name.trim().toLocaleLowerCase())).map(p=>p.steamid));
}

export function scoutRoundContext(source:ScoutSource, round:TimelineRound, filters:ScoutFilters) {
  let t=0,ct=0;
  for(const sid of source.sids) {
    const side=snapshotAt(source.timeline.positions[sid],roundAnchor(round))?.tn;
    if(side===2)t++;if(side===3)ct++;
  }
  if(!t && !ct) return null; // Never guess an unidentified team's uniform.
  const side=ct>t?"CT":"T";
  const plant=source.timeline.events.find(e=>e.type==="bomb_plant" && e.tick>=round.start_tick && e.tick<=round.end_tick);
  const site=plant ? (["A","B"].includes(plant.data.site?.toUpperCase()) ? plant.data.site.toUpperCase() : "unknown") : "none";
  if(filters.side!=="all" && filters.side!==side || filters.site!=="all" && filters.site!==site || filters.phase==="postplant" && !plant) return null;
  const anchor=filters.phase==="postplant" ? plant!.tick : roundAnchor(round);
  return {side:side as "T"|"CT",site,anchor};
}

function between(samples:TimelinePosition[], start:number, end:number) {
  let lo=0,hi=samples.length;
  while(lo<hi) {const m=(lo+hi)>>>1;if(samples[m].t<start)lo=m+1;else hi=m;}
  let finish=lo;while(finish<samples.length && samples[finish].t<=end)finish++;
  return samples.slice(lo,finish);
}

export function buildScoutRounds(sources:ScoutSource[], filters:ScoutFilters):ScoutRound[] {
  const result:ScoutRound[]=[];
  for(const source of sources) for(const round of source.timeline.rounds) {
    const ctx=scoutRoundContext(source,round,filters);if(!ctx)continue;
    const tl=source.timeline, rate=tl.tick_rate || 64;
    const players=tl.players.filter(p=>source.sids.has(p.steamid));
    const positions:Record<string,TimelinePosition[]>={};
    for(const p of players) {
      let last=-Infinity;
      positions[p.steamid]=between(tl.positions[p.steamid] ?? [],ctx.anchor,round.end_tick)
        .filter((s,i,a)=>{if(s.t-last>=rate/2 || i===a.length-1){last=s.t;return true;}return false;});
    }
    // Only this roster's throws enter the explorer. Keep active pre-plant
    // smokes/fire for post-plant views, but never pre-plant movement trails.
    const grenades=tl.grenades.filter(g=>{
      if(!source.sids.has(g.thrower) || !g.points.length)return false;
      const thrown=g.points[0][0], det=g.detonate_tick ?? g.points[g.points.length-1][0];
      const life=g.type==="smokegrenade"?20:g.type==="molotov"?7:0;
      return thrown>=round.start_tick && thrown<=round.end_tick && (thrown>=ctx.anchor || det+life*rate>=ctx.anchor);
    });
    result.push({key:`${source.demoFile}:${round.num}`,demoFile:source.demoFile,round,...ctx,
      duration:Math.max(0,(round.end_tick-ctx.anchor)/rate),players,positions,grenades,tickRate:rate});
  }
  return result;
}

/** Keep existing report statistics on the same selected matches/round windows. */
export function filterScoutTimeline(source:ScoutSource, filters:ScoutFilters):MatchTimeline {
  const windows=source.timeline.rounds.flatMap(r=>{const c=scoutRoundContext(source,r,filters);return c?[{round:r,start:filters.phase==="postplant"?c.anchor:r.start_tick}]:[];});
  const includes=(tick:number)=>windows.some(w=>tick>=w.start && tick<=w.round.end_tick);
  return {...source.timeline,rounds:windows.map(w=>w.round),
    positions:Object.fromEntries([...source.sids].map(sid=>[sid,(source.timeline.positions[sid] ?? []).filter(s=>includes(s.t))])),
    players:source.timeline.players.filter(p=>source.sids.has(p.steamid)),
    events:source.timeline.events.filter(e=>includes(e.tick)),
    grenades:source.timeline.grenades.filter(g=>source.sids.has(g.thrower) && g.points.length && includes(g.points[0][0]))};
}
