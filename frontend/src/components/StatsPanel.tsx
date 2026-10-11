/**
 * StatsPanel — per-player stats dashboard.
 * Computes K/D, HS%, opening duels, clutches, multi-kills, utility usage
 * all client-side from the timeline data.
 */
import { useMemo, useState } from "react";
import { MatchInfoResponse, MatchTimeline } from "../api/client";
import {matchIdentity} from '../utils/replayState';
import {calculateReplayStats, ESTIMATE_DESCRIPTION} from '../utils/replayStats';

interface Props {
  timeline: MatchTimeline;
  matchInfo: MatchInfoResponse | null;
}

interface PlayerStats {
  steamid: string;
  name: string;
  team: number; // 2=T, 3=CT (first half)
  kills: number;
  deaths: number;
  hsKills: number;
  wallbangKills: number;
  noscopeKills: number;
  smokeKills: number;
  blindKills: number;
  openingKills: number;
  openingDeaths: number;
  clutchWins: number;
  clutchAttempts: number;
  multiKills: { "2k": number; "3k": number; "4k": number; "5k": number };
  smokesThrown: number;
  flashesThrown: number;
  hesThrown: number;
  molovsThrown: number;
  roundsAlive: number; // rounds survived
  totalRounds: number;
  assists: number; adr: number; kast: number; rating: number | null; swingPct: number; participated: number;
}

export default function StatsPanel({ timeline, matchInfo }: Props) {
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const identity = useMemo(() => matchIdentity(timeline, matchInfo), [timeline, matchInfo]);
  const shared = useMemo(() => calculateReplayStats(timeline, identity), [timeline, identity]);

  const stats = useMemo<PlayerStats[]>(() => {
    const map = new Map<string, PlayerStats>();
    for (const p of timeline.players) {
      map.set(p.steamid, {
        steamid: p.steamid,
        name: p.name,
        team: identity.members[p.steamid],
        kills: 0, deaths: 0, hsKills: 0,
        wallbangKills: 0, noscopeKills: 0, smokeKills: 0, blindKills: 0,
        openingKills: 0, openingDeaths: 0,
        clutchWins: 0, clutchAttempts: 0,
        multiKills: { "2k": 0, "3k": 0, "4k": 0, "5k": 0 },
        smokesThrown: 0, flashesThrown: 0, hesThrown: 0, molovsThrown: 0,
        roundsAlive: 0, totalRounds: timeline.rounds.length,
        assists: 0, adr: 0, kast: 0, rating: null, swingPct: 0, participated: 0,
      });
    }

    // Process death events per round
    const roundKills = new Map<number, Map<string, number>>(); // round -> attacker -> kill count
    const roundFirstKill = new Map<number, boolean>(); // track if first kill of round seen

    for (const r of timeline.rounds) {
      roundKills.set(r.num, new Map());
      roundFirstKill.set(r.num, false);
    }

    // Find which round a tick belongs to
    const tickToRound = (tick: number): number => {
      for (const r of timeline.rounds) {
        if (tick >= r.start_tick && tick <= r.end_tick) return r.num;
      }
      return 0;
    };

    // Process kills
    for (const evt of timeline.events) {
      if (evt.type !== "death") continue;
      const rnd = tickToRound(evt.tick);
      if (!rnd) continue; // Warmup, between-round and post-match deaths are not stats.
      const attacker = evt.data.attacker;
      const victim = evt.data.victim;

      // Deaths
      const victimStats = map.get(victim);
      if (victimStats) victimStats.deaths++;

      // Kills (ignore suicides/team kills for stats)
      if (attacker && attacker !== victim && identity.members[attacker] !== identity.members[victim]) {
        const attackerStats = map.get(attacker);
        if (attackerStats) {
          attackerStats.kills++;
          if (evt.data.headshot === "True" || evt.data.headshot === "true" || evt.data.headshot === "1") {
            attackerStats.hsKills++;
          }
          if (evt.data.penetrated && evt.data.penetrated !== "0" && evt.data.penetrated !== "False") {
            attackerStats.wallbangKills++;
          }
          if (evt.data.noscope === "True" || evt.data.noscope === "true" || evt.data.noscope === "1") {
            attackerStats.noscopeKills++;
          }
          if (evt.data.thrusmoke === "True" || evt.data.thrusmoke === "true" || evt.data.thrusmoke === "1") {
            attackerStats.smokeKills++;
          }
          if (evt.data.attackerblind === "True" || evt.data.attackerblind === "true" || evt.data.attackerblind === "1") {
            attackerStats.blindKills++;
          }

          // Opening kill tracking
          if (!roundFirstKill.get(rnd)) {
            roundFirstKill.set(rnd, true);
            attackerStats.openingKills++;
            if (victimStats) victimStats.openingDeaths++;
          }

          // Multi-kill tracking
          const rk = roundKills.get(rnd);
          if (rk) {
            rk.set(attacker, (rk.get(attacker) ?? 0) + 1);
          }
        }
      }
    }

    // Count multi-kills per round
    for (const [, rk] of roundKills) {
      for (const [sid, count] of rk) {
        const s = map.get(sid);
        if (!s) continue;
        if (count >= 5) s.multiKills["5k"]++;
        else if (count >= 4) s.multiKills["4k"]++;
        else if (count >= 3) s.multiKills["3k"]++;
        else if (count >= 2) s.multiKills["2k"]++;
      }
    }

    // Grenade usage
    for (const g of timeline.grenades) {
      const s = map.get(g.thrower);
      if (!s) continue;
      if (g.type === "smokegrenade") s.smokesThrown++;
      else if (g.type === "flashbang") s.flashesThrown++;
      else if (g.type === "hegrenade") s.hesThrown++;
      else if (g.type === "molotov" || g.type === "incgrenade") s.molovsThrown++;
    }

    return Array.from(map.values()).map(p => {
      const s = shared.playerTotals.find(s => s.steamid === p.steamid)!;
      return {...p, kills:s.kills, deaths:s.deaths, hsKills:s.hsk, assists:s.assists,
        roundsAlive:s.survived, participated:s.rounds, adr:timeline.rounds.length?s.dmg/timeline.rounds.length:0,
        kast:timeline.rounds.length?100*s.kast/timeline.rounds.length:0, rating:s.rating, swingPct:s.swingPct};
    });
  }, [timeline, identity, shared]);

  // Sort by kills desc within each team
  const teamPlayers = (team: number) =>
    stats.filter((s) => s.team === team).sort((a, b) => b.kills - a.kills);

  const renderTeamTable = (team: number) => {
    const players = teamPlayers(team);
    const teamColor = team === 2 ? "#DCBF6E" : "#5B9BD5";
    const teamLabel = team === 2 ? "T" : "CT";

    return (
      <div className="hud-panel overflow-hidden">
        <div className="px-4 py-2 border-b border-scout-border/50 flex items-center gap-2">
          <span
            className="px-2 py-0.5 rounded text-[10px] font-bold"
            style={{ background: `${teamColor}20`, color: teamColor }}
          >
            {teamLabel}
          </span>
          <span className="text-sm font-semibold text-white">
            {identity.labels[team]}
          </span>
        </div>
        <div className="text-[11px] overflow-x-auto">
        <div className="min-w-[1100px]">
          {/* Header row */}
          <div
            className="grid text-scout-muted uppercase tracking-[0.08em] border-b border-scout-border/30"
            style={{ gridTemplateColumns: "2fr repeat(16, 1fr)" }}
          >
            <div className="px-3 py-2 font-medium text-left">Player</div>
            <div className="px-2 py-2 font-medium text-center">K</div>
            <div className="px-2 py-2 font-medium text-center">D</div>
            <div className="px-2 py-2 font-medium text-center">A</div>
            <div className="px-2 py-2 font-medium text-center">ADR</div>
            <div className="px-2 py-2 font-medium text-center">KAST</div>
            <div className="px-2 py-2 font-medium text-center" title={ESTIMATE_DESCRIPTION}>Rating ≈</div>
            <div className="px-2 py-2 font-medium text-center" title={ESTIMATE_DESCRIPTION}>Swing ≈</div>
            <div className="px-2 py-2 font-medium text-center">+/-</div>
            <div className="px-2 py-2 font-medium text-center">HS%</div>
            <div className="px-2 py-2 font-medium text-center">FK</div>
            <div className="px-2 py-2 font-medium text-center">FD</div>
            <div className="px-2 py-2 font-medium text-center">2K</div>
            <div className="px-2 py-2 font-medium text-center">3K</div>
            <div className="px-2 py-2 font-medium text-center">4K</div>
            <div className="px-2 py-2 font-medium text-center">5K</div>
            <div className="px-2 py-2 font-medium text-center" title="Survival rate">SRV%</div>
          </div>
          {/* Player rows */}
          {players.map((p) => {
            const diff = p.kills - p.deaths;
            const hsPct = p.kills > 0 ? Math.round((p.hsKills / p.kills) * 100) : 0;
            const survPct = p.totalRounds > 0 ? Math.round((p.roundsAlive / p.totalRounds) * 100) : 0;
            const isExpanded = expandedPlayer === p.steamid;

            return (
              <div key={p.steamid}>
                <div
                  className={`border-b border-scout-border/20 cursor-pointer transition-colors ${
                    isExpanded ? "bg-scout-accent/5" : "hover:bg-scout-border/10"
                  }`}
                  onClick={() => setExpandedPlayer(isExpanded ? null : p.steamid)}
                >
                  {/* Main row */}
                  <div className="grid" style={{ gridTemplateColumns: "2fr repeat(16, 1fr)" }}>
                    <div className="px-3 py-2 font-semibold text-white truncate" title={`${p.name}: present/alive in ${p.participated} of ${p.totalRounds} rounds`}>{p.name}</div>
                    <div className="px-2 py-2 text-center font-mono font-bold text-white">{p.kills}</div>
                    <div className="px-2 py-2 text-center font-mono text-gray-400">{p.deaths}</div>
                    <div className="px-2 py-2 text-center font-mono text-gray-300">{p.assists}</div>
                    <div className="px-2 py-2 text-center font-mono text-gray-300">{shared.hasRealAggregates ? p.adr.toFixed(1) : '—'}</div>
                    <div className="px-2 py-2 text-center font-mono text-gray-300">{p.kast.toFixed(0)}%</div>
                    <div className="px-2 py-2 text-center font-mono text-scout-accent" title={ESTIMATE_DESCRIPTION}>{p.rating?.toFixed(2) ?? '—'}</div>
                    <div className={`px-2 py-2 text-center font-mono ${p.swingPct>=0?'text-scout-green':'text-scout-red'}`} title={ESTIMATE_DESCRIPTION}>{p.swingPct>=0?'+':''}{p.swingPct.toFixed(2)}%</div>
                    <div className={`px-2 py-2 text-center font-mono font-bold ${diff > 0 ? "text-scout-green" : diff < 0 ? "text-scout-red" : "text-gray-400"}`}>
                      {diff > 0 ? `+${diff}` : diff}
                    </div>
                    <div className="px-2 py-2 text-center font-mono text-gray-300">{hsPct}%</div>
                    <div className="px-2 py-2 text-center font-mono text-scout-green">{p.openingKills}</div>
                    <div className="px-2 py-2 text-center font-mono text-scout-red">{p.openingDeaths}</div>
                    <div className="px-2 py-2 text-center font-mono text-gray-300">{p.multiKills["2k"] || "-"}</div>
                    <div className="px-2 py-2 text-center font-mono text-gray-300">{p.multiKills["3k"] || "-"}</div>
                    <div className="px-2 py-2 text-center font-mono text-yellow-400">{p.multiKills["4k"] || "-"}</div>
                    <div className="px-2 py-2 text-center font-mono text-scout-accent">{p.multiKills["5k"] || "-"}</div>
                    <div className="px-2 py-2 text-center font-mono text-gray-300">{survPct}%</div>
                  </div>

                  {/* Expanded detail */}
                      {isExpanded && (
                        <div className="px-4 pb-3 pt-1 grid grid-cols-2 md:grid-cols-4 gap-3">
                          <div className="hud-panel p-2 space-y-1">
                            <p className="text-[9px] text-scout-muted uppercase tracking-wide">Kill Breakdown</p>
                            <div className="space-y-0.5 text-[11px]">
                              <div className="flex justify-between">
                                <span className="text-gray-400">Headshots</span>
                                <span className="text-white font-mono">{p.hsKills}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Wallbangs</span>
                                <span className="text-white font-mono">{p.wallbangKills}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">No-scopes</span>
                                <span className="text-white font-mono">{p.noscopeKills}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Through smoke</span>
                                <span className="text-white font-mono">{p.smokeKills}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">While blind</span>
                                <span className="text-white font-mono">{p.blindKills}</span>
                              </div>
                            </div>
                          </div>
                          <div className="hud-panel p-2 space-y-1">
                            <p className="text-[9px] text-scout-muted uppercase tracking-wide">Opening Duels</p>
                            <div className="text-lg font-bold font-mono text-white">
                              <span className="text-scout-green">{p.openingKills}</span>
                              {" - "}
                              <span className="text-scout-red">{p.openingDeaths}</span>
                            </div>
                            <p className="text-[10px] text-scout-muted">
                              {p.openingKills + p.openingDeaths > 0
                                ? `${Math.round((p.openingKills / (p.openingKills + p.openingDeaths)) * 100)}% win rate`
                                : "No opening duels"}
                            </p>
                          </div>
                          <div className="hud-panel p-2 space-y-1">
                            <p className="text-[9px] text-scout-muted uppercase tracking-wide">Utility Usage</p>
                            <div className="space-y-0.5 text-[11px]">
                              <div className="flex justify-between">
                                <span className="text-gray-400">Smokes</span>
                                <span className="text-white font-mono">{p.smokesThrown}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Flashes</span>
                                <span className="text-white font-mono">{p.flashesThrown}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">HE Grenades</span>
                                <span className="text-white font-mono">{p.hesThrown}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Molotovs</span>
                                <span className="text-white font-mono">{p.molovsThrown}</span>
                              </div>
                            </div>
                          </div>
                          <div className="hud-panel p-2 space-y-1">
                            <p className="text-[9px] text-scout-muted uppercase tracking-wide">Multi-Kills</p>
                            <div className="space-y-0.5 text-[11px]">
                              <div className="flex justify-between">
                                <span className="text-gray-400">Double kills</span>
                                <span className="text-white font-mono">{p.multiKills["2k"]}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-gray-400">Triple kills</span>
                                <span className="text-white font-mono">{p.multiKills["3k"]}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-yellow-400">Quad kills</span>
                                <span className="text-yellow-400 font-mono">{p.multiKills["4k"]}</span>
                              </div>
                              <div className="flex justify-between">
                                <span className="text-scout-accent">Aces</span>
                                <span className="text-scout-accent font-mono">{p.multiKills["5k"]}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
              );
          })}
          </div>
          </div>
        </div>
    );
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4" style={{ scrollbarWidth: "thin" }}>
      <h2 className="text-xs text-scout-muted uppercase tracking-[0.15em]">
        Player Statistics · {timeline.rounds.length} rounds
      </h2>
      <p className="text-xs text-scout-muted">Rating ≈ and Swing ≈ are local estimates inspired by HLTV 3.0, not official HLTV or FACEIT values. Averages use all {timeline.rounds.length} match rounds. Assists use 40 enemy damage or a flash assist on new parses.</p>
      {renderTeamTable(identity.team1)}
      {renderTeamTable(identity.team1===2?3:2)}
    </div>
  );
}
