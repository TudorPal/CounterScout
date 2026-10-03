import type { MatchIdentity } from "./replayState";

/** Scoreboard order is an organisation order, never the current T/CT order. */
export function replayRosterGroups<P extends { steamid: string; name: string; team: number }>(
  players: P[], identity: MatchIdentity,
) {
  return [identity.team1, identity.team1 === 2 ? 3 : 2].map(team => {
    const roster = players.filter(p => identity.members[p.steamid] === team)
      .sort((a, b) => a.name.localeCompare(b.name));
    const t = roster.filter(p => p.team === 2).length;
    const ct = roster.filter(p => p.team === 3).length;
    return { team, label: identity.labels[team], side: ct > t ? 3 : t > ct ? 2 : team, players: roster };
  });
}
