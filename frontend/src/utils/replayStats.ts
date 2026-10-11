import type {MatchTimeline, TimelineEvent, TimelinePosition} from '../api/client';
import {roundAnchor, snapshotAt, teamSide, type MatchIdentity} from './replayState';

export const ESTIMATE_DESCRIPTION = 'Local estimate inspired by HLTV 3.0, not an official HLTV/FACEIT rating. Uses equipment, alive counts, plant state, damage/flash/trade credit and six performance components. See docs/statistics.md.';
export const eventTrue = (value: unknown) => value === true || value === 1 || ['true','1'].includes(String(value).toLowerCase());
const clamp = (n: number, low = 0, high = 3) => Math.max(low, Math.min(high, n));
export interface ReplayPlayerStat {
  steamid: string; name: string; team: number; rounds: number;
  kills: number; deaths: number; assists: number; dmg: number; utildmg: number; flashed: number; hsk: number;
  openingKills: number; openingDeaths: number; survived: number; kast: number;
  swing: number; swingPct: number; rating: number | null; hasRealAggregates: boolean;
  ecoKills: number; ecoDmg: number; multi: number; survivalCredit: number;
}
function empty(steamid: string, name: string, team: number): ReplayPlayerStat {
  return {steamid,name,team,rounds:0,kills:0,deaths:0,assists:0,dmg:0,utildmg:0,flashed:0,hsk:0,
    openingKills:0,openingDeaths:0,survived:0,kast:0,swing:0,swingPct:0,rating:null,hasRealAggregates:false,
    ecoKills:0,ecoDmg:0,multi:0,survivalCredit:0};
}
// These constants are transparent local modelling assumptions, not fitted
// HLTV parameters. Unknown equipment has neutral strength.
const strength = (s?: TimelinePosition) => s?.eq == null ? 1 : .35 + Math.sqrt(clamp(s.eq / 4000, 0, 4));
export function localWinProbability(t: number, ct: number, planted = false) {
  if (ct <= 0) return t > 0 || planted ? 1 : .5;
  // A planted bomb can still win after the last Terrorist dies. Without a
  // fitted defuse/time model retain a small, explicit local explosion prior.
  if (t <= 0) return planted ? 1 / (1 + (1 + ct) ** 2) : 0;
  const z = 3 * Math.log(t / ct) + (planted ? .8 : 0);
  return 1 / (1 + Math.exp(-z));
}
export function estimateRating(s: ReplayPlayerStat, rounds: number) {
  if (!rounds || !s.hasRealAggregates) return null;
  return .25 * clamp(s.ecoKills / rounds / .70)
    + .20 * clamp(s.ecoDmg / rounds / 75)
    + .10 * clamp(s.survivalCredit / rounds / .20)
    + .20 * clamp(s.kast / rounds / .70)
    + .10 * clamp(s.multi / rounds / .18)
    + .15 * clamp(1 + s.swingPct / 10);
}

/** Shared by Insights and Stats. Only played rounds are eligible; no team-
 * average normalization, future samples or post-match deaths are counted. */
export function calculateReplayStats(timeline: MatchTimeline, identity: MatchIdentity) {
  const totals = timeline.players.map(p => empty(p.steamid,p.name,identity.members[p.steamid]));
  const byRound: Record<number, Record<string, ReplayPlayerStat>> = {};
  // Parser batches event types. A lethal hurt and its death share a tick:
  // damage must be credited before that victim is removed from the alive set.
  const priority = (e: TimelineEvent) => ['damage','hurt'].includes(e.type) ? 0 : e.type==='death' ? 2 : 1;
  const events = [...timeline.events].sort((a,b) => a.tick-b.tick || priority(a)-priority(b));
  const detailedDamage = events.some(e => e.type === 'damage');
  for (const r of timeline.rounds) {
    const stats: Record<string, ReplayPlayerStat> = {};
    byRound[r.num] = stats;
    const roundEvents = events.filter(e => e.tick >= r.start_tick && e.tick <= r.end_tick);
    const side: Record<string, number> = {}, alive = new Set<string>(), dead = new Set<string>(), traded = new Set<string>();
    const equipment: Record<string, TimelinePosition | undefined> = {};
    const health: Record<string, number> = {};
    const damage = new Map<string, Map<string, number>>();
    const killHistory: TimelineEvent[] = [];
    let first = true, planted = false;
    for (const p of timeline.players) {
      const samples = timeline.positions[p.steamid], anchor = snapshotAt(samples,roundAnchor(r));
      const end = snapshotAt(samples,r.end_tick), begin = snapshotAt(samples,r.start_tick);
      const s = stats[p.steamid] = empty(p.steamid,p.name,identity.members[p.steamid]);
      side[p.steamid] = teamSide(timeline,identity,s.team,roundAnchor(r));
      equipment[p.steamid] = anchor;
      health[p.steamid] = anchor?.hp || 100;
      if (anchor && anchor.t >= r.start_tick && anchor.alive) { alive.add(p.steamid); s.rounds = 1; }
      if (end && end.t >= r.start_tick) {
        for (const key of ['utildmg','flashed'] as const) s[key] = Math.max(0,(end[key] ?? 0)-(begin?.[key] ?? 0));
        if (!detailedDamage && end.dmg != null) {
          s.dmg = Math.max(0,end.dmg-(begin?.dmg ?? 0));
          s.ecoDmg = s.dmg;
          s.assists = Math.max(0,(end.ast ?? 0)-(begin?.ast ?? 0));
          s.hasRealAggregates = true;
        }
      }
      if (detailedDamage) s.hasRealAggregates = true;
    }
    const probability = () => {
      let t=0, ct=0;
      for (const sid of alive) {
        if (side[sid]===2) t += strength(equipment[sid]); else if (side[sid]===3) ct += strength(equipment[sid]);
      }
      return localWinProbability(t,ct,planted);
    };
    for (const e of roundEvents) {
      if (e.type === 'bomb_plant') { planted = true; continue; }
      if (!['death','damage','hurt'].includes(e.type)) continue;
      const attacker=e.data.attacker, victim=e.data.victim, a=stats[attacker], v=stats[victim];
      // Add genuine mid-round joins from fresh state, never stale disconnected
      // uniforms. A previous death in this round cannot be respawned by a sample.
      for (const sid of [attacker,victim]) {
        const sample = snapshotAt(timeline.positions[sid],e.tick-1);
        if (stats[sid] && sample && sample.t>=r.start_tick && sample.alive && !dead.has(sid)) {
          alive.add(sid); stats[sid].rounds=1;
          if (sample.eq != null && sample.eq>0) equipment[sid]=sample;
        }
      }
      if (e.type !== 'death') {
        if (!v || dead.has(victim)) continue;
        const amount=clamp(Number(e.data.dmg) || 0,0,health[victim] ?? 100);
        health[victim]=Math.max(0,(health[victim] ?? 100)-amount);
        if (!a || a.team===v.team) continue;
        const pool=damage.get(victim) ?? new Map<string,number>();
        pool.set(attacker,(pool.get(attacker) ?? 0)+amount); damage.set(victim,pool);
        if (detailedDamage) {
          a.dmg+=amount;
          a.ecoDmg+=amount*clamp(strength(equipment[victim])/strength(equipment[attacker]),.5,1.5);
        }
        continue;
      }
      if (!v || dead.has(victim)) continue;
      const before=probability();
      alive.delete(victim);dead.add(victim);v.deaths++;v.rounds=1;
      if (!a || attacker===victim || a.team===v.team) continue;
      a.kills++;a.rounds=1;
      a.hsk+=eventTrue(e.data.headshot)?1:0;
      a.ecoKills+=clamp(strength(equipment[victim])/strength(equipment[attacker]),.5,1.5);
      if(first) {a.openingKills++;v.openingDeaths++;first=false;}
      const trade=[...killHistory].reverse().find(k => e.tick-k.tick<=5*timeline.tick_rate && k.data.attacker===victim && stats[k.data.victim]?.team===a.team);
      if(trade)traded.add(trade.data.victim);
      const contributors=damage.get(victim), shares=new Map<string,number>();
      const totalDamage=Array.from(contributors?.values() ?? []).reduce((sum,n)=>sum+n,0);
      shares.set(attacker,totalDamage ? .5 : 1);
      if(totalDamage)for(const [sid,amount] of contributors!)shares.set(sid,(shares.get(sid) ?? 0)+.5*amount/totalDamage);
      const assister=e.data.assister, flash=eventTrue(e.data.assistedflash);
      const assists=new Set<string>();
      if(detailedDamage)for(const [sid,amount] of contributors ?? [])if(sid!==attacker && amount>=40)assists.add(sid);
      if(stats[assister]?.team===a.team && assister!==attacker) {
        if(detailedDamage && flash)assists.add(assister);
        if(flash) { for(const [sid,w] of shares)shares.set(sid,w*.9);shares.set(assister,(shares.get(assister) ?? 0)+.1); }
      }
      if(detailedDamage)for(const sid of assists)stats[sid].assists++;
      if(trade)shares.set(attacker,(shares.get(attacker) ?? 0)+.1);
      const shareTotal=Array.from(shares.values()).reduce((sum,n)=>sum+n,0);
      const delta=(probability()-before)*(side[attacker]===2?1:-1);
      for(const [sid,w] of shares)if(stats[sid])stats[sid].swing+=delta*w/shareTotal;
      v.swing-=delta;
      killHistory.push(e);
    }
    // Credit a won round's remaining probability when opponents save. Keep
    // positive and negative impact conserved; there is no survival bonus here.
    const winner=r.winner==='T'?2:r.winner==='CT'?3:0;
    const losers=Array.from(alive).filter(sid=>side[sid]!==winner);
    const winners=Object.values(stats).filter(s=>side[s.steamid]===winner && s.swing>0);
    const sum=winners.reduce((n,s)=>n+s.swing,0);
    if(winner && losers.length && sum>0) {
      const residual=winner===2?1-probability():probability();
      winners.forEach(s=>s.swing+=residual*s.swing/sum);
      losers.forEach(sid=>stats[sid].swing-=residual/losers.length);
    }
    for(const p of totals) {
      const s=stats[p.steamid],end=snapshotAt(timeline.positions[p.steamid],r.end_tick);
      s.survived=s.rounds && !dead.has(p.steamid) && end?.t!=null && end.t>=r.start_tick && end.alive ? 1 : 0;
      s.survivalCredit=s.survived*(side[p.steamid]===winner?1:.25);
      s.kast=s.rounds && (s.kills>0 || s.assists>0 || s.survived>0 || traded.has(p.steamid))?1:0;
      s.multi=Math.max(0,s.kills-1);
      s.swingPct=s.swing*100;
      s.rating=estimateRating(s,1);
      for(const key of ['rounds','kills','deaths','assists','dmg','utildmg','flashed','hsk','openingKills','openingDeaths','survived','kast','swing','ecoKills','ecoDmg','multi','survivalCredit'] as const)p[key]+=s[key];
      p.hasRealAggregates ||= s.hasRealAggregates;
    }
  }
  for(const p of totals) {
    // Match averages use ALL played match rounds, explicitly including absence.
    p.swingPct=timeline.rounds.length ? 100*p.swing/timeline.rounds.length : 0;
    p.rating=estimateRating(p,timeline.rounds.length);
  }
  return {perPlayerRoundStats:byRound,playerTotals:totals,hasRealAggregates:totals.some(p=>p.hasRealAggregates)};
}
