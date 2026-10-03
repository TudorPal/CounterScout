import type {MatchTimeline} from "../api/client";
import {snapshotAt, teamSide, type MatchIdentity, type Side} from "./replayState";

export type ReplaySideFilter = "all" | Side;
export type ReplayTeamFilter = "all" | "2" | "3";

/** Roster membership is stable; the player's uniform changes at every swap. */
export function playerSideAt(timeline: MatchTimeline, identity: MatchIdentity, sid: string, tick: number): Side | undefined {
  const side = snapshotAt(timeline.positions[sid], tick)?.tn;
  if (side === 2 || side === 3) return side;
  const team = identity.members[sid];
  return team === 2 || team === 3 ? teamSide(timeline, identity, team, tick) : undefined;
}

export function matchesReplayFilters(timeline: MatchTimeline, identity: MatchIdentity, sid: string, tick: number,
  team: ReplayTeamFilter, side: ReplaySideFilter, player = "all"): boolean {
  return (player === "all" || player === sid) &&
    (team === "all" || identity.members[sid] === Number(team)) &&
    (side === "all" || playerSideAt(timeline, identity, sid, tick) === side);
}

/** Scope a contextual Patterns view by the focused players' round, not by
 * the uniforms of dimmed opponents that are retained for context. */
export function focusedRoundMatchesSide(timeline: MatchTimeline, identity: MatchIdentity, sids: Iterable<string>, tick:number, side:ReplaySideFilter):boolean {
  return side === "all" || Array.from(sids).some(sid=>playerSideAt(timeline,identity,sid,tick)===side);
}
