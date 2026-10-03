import type { MatchInfoResponse, MatchTimeline, TimelinePosition, TimelineRound } from "../api/client";

export type Side = 2 | 3;
export const sideColor = (side: number) => side === 2 ? "#DCBF6E" : "#5B9BD5";
export const money = (value: number | null | undefined) => value == null ? "—" : `$${Math.round(value).toLocaleString()}`;

/** Discrete state must never look ahead into a side swap or the next spawn. */
export function snapshotAt(samples: TimelinePosition[] | undefined, tick: number) {
  if (!samples?.length) return undefined;
  let lo = 0, hi = samples.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (samples[mid].t <= tick) lo = mid + 1; else hi = mid; }
  return samples[Math.max(0, lo - 1)];
}

export const roundAnchor = (round: TimelineRound) => round.freeze_end_tick ?? Math.min(round.start_tick + 320, round.end_tick);

export function matchIdentity(timeline: MatchTimeline, info?: MatchInfoResponse | null) {
  const first = timeline.rounds[0];
  const tick = first ? roundAnchor(first) : 0;
  const members: Record<string, number> = {};
  for (const p of timeline.players) {
    const side = snapshotAt(timeline.positions[p.steamid], tick)?.tn;
    members[p.steamid] = side === 2 || side === 3 ? side : p.team_num;
  }
  const roster = info?.team1;
  const ids = new Set((roster?.players_detailed ?? []).map(p => p.steamid).filter(Boolean));
  const names = new Set((roster?.players ?? []).map(n => n.trim().toLowerCase()));
  const votes = { 2: 0, 3: 0 };
  for (const p of timeline.players) if (ids.size ? ids.has(p.steamid) : names.has(p.name.trim().toLowerCase())) {
    if (members[p.steamid] === 2) votes[2]++; else if (members[p.steamid] === 3) votes[3]++;
  }
  const team1: Side = votes[3] > votes[2] ? 3 : 2;
  const labels: Record<number, string> = info?.team1 && info?.team2 ? {
    [team1]: info.team1.name, [team1 === 2 ? 3 : 2]: info.team2.name,
  } : {2: "Terrorists", 3: "Counter-Terrorists"};
  return { members, labels, team1 };
}
export type MatchIdentity = ReturnType<typeof matchIdentity>;

/** A team is a stable cohort of players; T/CT is a changing uniform. */
export function teamSide(timeline: MatchTimeline, identity: MatchIdentity, team: number, tick: number): Side {
  let t = 0, ct = 0;
  for (const p of timeline.players) if (identity.members[p.steamid] === team) {
    const side = snapshotAt(timeline.positions[p.steamid], tick)?.tn;
    if (side === 2) t++; else if (side === 3) ct++;
  }
  return ct > t ? 3 : t > ct ? 2 : team as Side;
}

export function scoreAt(timeline: MatchTimeline, identity: MatchIdentity, tick = Infinity) {
  const result: Record<number, number> = {2: 0, 3: 0};
  for (const r of timeline.rounds) {
    if (r.end_tick > tick || !r.winner) continue;
    const winnerSide = r.winner === "T" ? 2 : r.winner === "CT" ? 3 : 0;
    if (!winnerSide) continue;
    const winner = teamSide(timeline, identity, 2, roundAnchor(r)) === winnerSide ? 2 : 3;
    result[winner]++;
  }
  return result;
}

export function economyAt(timeline: MatchTimeline, tick: number) {
  const sides = {2: {cash: 0, equipment: 0, known: 0, players: [] as {name: string; cash?: number; equipment?: number}[]},
                 3: {cash: 0, equipment: 0, known: 0, players: [] as {name: string; cash?: number; equipment?: number}[]}};
  for (const p of timeline.players) {
    const s = snapshotAt(timeline.positions[p.steamid], tick);
    const side = s?.tn;
    if (!s || (side !== 2 && side !== 3)) continue;
    if (s.cash != null) { sides[side].cash += s.cash; sides[side].known++; }
    sides[side].equipment += s.eq ?? 0;
    sides[side].players.push({name: p.name, cash: s.cash, equipment: s.eq});
  }
  return sides;
}

export function roundResult(timeline: MatchTimeline, round: TimelineRound) {
  const deaths = new Set(timeline.events.filter(e => e.type === "death" && e.tick >= round.start_tick && e.tick <= round.end_tick).map(e => e.data.victim));
  let tAlive = 0, ctAlive = 0;
  for (const p of timeline.players) {
    const side = snapshotAt(timeline.positions[p.steamid], roundAnchor(round))?.tn ?? p.team_num;
    if (!deaths.has(p.steamid)) { if (side === 2) tAlive++; else if (side === 3) ctAlive++; }
  }
  const events = timeline.events.filter(e => e.tick >= round.start_tick && e.tick <= round.end_tick);
  const planted = events.some(e => e.type === "bomb_plant"), defused = events.some(e => e.type === "bomb_defuse");
  return { tAlive, ctAlive, planted, defused, exploded: planted && !defused && round.winner === "T" };
}
