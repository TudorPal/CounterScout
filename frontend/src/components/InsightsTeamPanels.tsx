import type { MatchTimeline, TimelineRound } from "../api/client";
import type { PlayerRoundStats } from "./InsightsPanel";
import { economyAt, money, roundAnchor, scoreAt, sideColor, snapshotAt, teamSide, type MatchIdentity } from "../utils/replayState";

interface Props {
  timeline: MatchTimeline;
  identity: MatchIdentity;
  round?: TimelineRound;
  teams: Record<number, PlayerRoundStats[]>;
  selected: Set<string>;
  onTogglePlayer: (sid: string) => void;
  onToggleTeam: (team: number) => void;
}

export default function InsightsTeamPanels({timeline, identity, round, teams, selected, onTogglePlayer, onToggleTeam}: Props) {
  const tick = round ? roundAnchor(round) : 0;
  const economy = economyAt(timeline, tick);
  const wins = scoreAt(timeline, identity);
  const columns = '16px minmax(0,1.4fr) minmax(44px,0.9fr) minmax(32px,0.7fr) minmax(60px,1.1fr)';
  return <div aria-label="Insights team and player filters" className="replay-team-panels insights-team-panels">
    {[identity.team1, identity.team1 === 2 ? 3 : 2].map(team => {
      const players = teams[team] ?? [];
      const side = teamSide(timeline, identity, team, tick);
      const color = sideColor(side);
      const label = identity.labels[team];
      return <section key={team} aria-label={`${label} player filters`} className="replay-team-panel insights-team-panel rounded-xl border border-white/10 bg-scout-bg/95 p-2 min-w-0">
        <div className="flex items-center gap-2 pb-1.5 border-b border-white/10">
          <input type="checkbox" aria-label={`Show ${label} players`} checked={players.length > 0 && players.every(p => selected.has(p.steamid))} onChange={() => onToggleTeam(team)} className="accent-scout-accent w-3.5 h-3.5 shrink-0" />
          <h2 className="text-sm font-bold truncate flex-1" style={{color}} title={label}>{label}</h2>
          <span className="text-[9px] rounded px-1 font-bold" style={{background: color, color: '#0b1118'}}>{side === 2 ? 'T' : 'CT'}</span>
          <span className="font-mono text-base font-bold text-white">{wins[team]}</span>
        </div>
        <p className="text-[10px] font-mono text-scout-muted my-1 truncate">Cash {money(economy[side].known ? economy[side].cash : null)} · equip {money(economy[side].equipment)}</p>
        <div className="grid gap-1 text-[11px] text-scout-muted uppercase px-1 pb-1" style={{gridTemplateColumns: columns}}>
          <span /><span>Player</span><span className="text-right">Swing</span><span className="text-right">DMG</span><span className="text-right">K/D/A</span>
        </div>
        {players.map(p => {
          const checked = selected.has(p.steamid);
          const cash = money(snapshotAt(timeline.positions[p.steamid], tick)?.cash);
          const swingColor = p.swingPct > 0 ? '#4ade80' : p.swingPct < 0 ? '#f87171' : '#94a3b8';
          return <label key={p.steamid} data-player-id={p.steamid} className={`grid gap-1 items-center px-1 py-1 rounded cursor-pointer text-xs hover:bg-white/5 ${checked ? '' : 'opacity-40'}`} style={{gridTemplateColumns: columns}}>
            <input type="checkbox" aria-label={`Show ${p.name}`} checked={checked} onChange={() => onTogglePlayer(p.steamid)} className="accent-scout-accent w-3.5 h-3.5" />
            <span className="min-w-0"><span className="block text-white font-semibold truncate text-[13px]" title={p.name}>{p.name}</span><span className="block truncate text-[10px] font-mono text-scout-muted" title={cash}>{cash}</span></span>
            <span className="font-mono font-bold text-right" style={{color: swingColor}}>{p.swingPct >= 0 ? '+' : ''}{p.swingPct.toFixed(1)}%</span>
            <span className="font-mono text-right text-gray-300">{p.hasRealAggregates ? p.dmg : '—'}</span>
            <span className="font-mono text-right text-gray-300">{p.kills}/{p.deaths}/{p.assists}</span>
          </label>;
        })}
      </section>;
    })}
  </div>;
}
