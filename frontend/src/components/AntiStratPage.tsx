/**
 * AntiStratPage — Opponent Tendencies / Anti-Strat Report.
 *
 * Aggregates multiple demos of the same team on the same map to produce
 * a strategic scouting report: site hit frequency, utility tendencies,
 * AWP positions, timing patterns, round win stats, and per-player habits.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mapIconPath } from "../utils/mapIcons";
import {
  Callout,
  MatchDemoEntry,
  MatchInfoResponse,
  MatchTimeline,
  RadarInfo,
  TimelinePosition,
  getCallouts,
  getMatchInfo,
  getMatchReplayDemos,
  getMatchReplayTimeline,
  getRadarInfo,
} from "../api/client";
import AppHeader from "./AppHeader";
import AppBackdrop from "./AppBackdrop";
import Select from "./Select";
import { useReveal } from "../hooks/useReveal";
import SearchableSelect from "./SearchableSelect";
import TeamScoutExplorer from "./TeamScoutExplorer";
import { buildScoutRounds, defaultScoutFilters, filterScoutTimeline, scoutTeamIds } from "../utils/teamScout";
import type { ScoutFilters, ScoutSource } from "../utils/teamScout";
import { roundAnchor, snapshotAt } from "../utils/replayState";
import { scoutTeamNames, scoutTeamDemos } from "../utils/scoutDiscovery";

// ─── Constants ─────────────────────────────────────────────────────────
const RADAR_PX = 1024;
const T_COLOR = "#DCBF6E";
const CT_COLOR = "#5B9BD5";

// ─── Helpers ───────────────────────────────────────────────────────────
const toRadar = (wx: number, wy: number, radar: RadarInfo) => ({
  x: (wx - radar.pos_x) / radar.scale,
  y: (radar.pos_y - wy) / radar.scale,
});

const sampleAtTick = (samples: TimelinePosition[], tick: number): TimelinePosition | null => {
  if (!samples || samples.length === 0) return null;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t < tick) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(samples[lo - 1].t - tick) < Math.abs(samples[lo].t - tick)) return samples[lo - 1];
  return samples[lo];
};

const nearestCallout = (x: number, y: number, callouts: Callout[]): string => {
  let best = "Unknown";
  let bestDist = Infinity;
  for (const c of callouts) {
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestDist) { bestDist = d; best = c.name; }
  }
  return best;
};

const isTruthy = (v: string | undefined): boolean =>
  v === "True" || v === "true" || v === "1";

const classifyBuy = (teamEquipValue: number): { label: string; color: string; bg: string } => {
  if (teamEquipValue < 5000) return { label: "Eco", color: "text-scout-red", bg: "bg-red-500/20" };
  if (teamEquipValue < 15000) return { label: "Force", color: "text-yellow-400", bg: "bg-yellow-500/20" };
  if (teamEquipValue < 22000) return { label: "Half", color: "text-orange-400", bg: "bg-orange-500/20" };
  return { label: "Full", color: "text-scout-green", bg: "bg-green-500/20" };
};

/** Jet-like colormap: intensity 0–255 → RGBA. */
const intensityToColor = (v: number): [number, number, number, number] => {
  if (v === 0) return [0, 0, 0, 0];
  const t = v / 255;
  let r = 0, g = 0, b = 0;
  if (t < 0.25) { b = 255; g = Math.round(t * 4 * 255); }
  else if (t < 0.5) { g = 255; b = Math.round((1 - (t - 0.25) * 4) * 255); }
  else if (t < 0.75) { g = 255; r = Math.round((t - 0.5) * 4 * 255); }
  else { r = 255; g = Math.round((1 - (t - 0.75) * 4) * 255); }
  return [r, g, b, Math.min(255, Math.round(t * 400))];
};

// ─── RadarHeatmap sub-component ────────────────────────────────────────
function RadarHeatmap({ radar, points, label }: {
  radar: RadarInfo;
  points: { x: number; y: number }[];
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, RADAR_PX, RADAR_PX);
    if (points.length === 0) return;

    const off = document.createElement("canvas");
    off.width = RADAR_PX;
    off.height = RADAR_PX;
    const offCtx = off.getContext("2d")!;
    offCtx.clearRect(0, 0, RADAR_PX, RADAR_PX);
    offCtx.globalCompositeOperation = "lighter";

    // Scale radius + alpha based on point count for readable heatmaps
    const n = points.length;
    const RADIUS = n < 100 ? 22 : n < 500 ? 16 : n < 2000 ? 12 : 8;
    const alpha = Math.max(0.008, Math.min(0.12, 3 / Math.sqrt(n)));

    for (const p of points) {
      const gradient = offCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, RADIUS);
      gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
      gradient.addColorStop(0.5, `rgba(255,255,255,${alpha * 0.3})`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      offCtx.fillStyle = gradient;
      offCtx.beginPath();
      offCtx.arc(p.x, p.y, RADIUS, 0, Math.PI * 2);
      offCtx.fill();
    }

    // Read intensity and apply colormap with a percentile-based normalization
    // to prevent a single hot pixel from washing out everything
    const imageData = offCtx.getImageData(0, 0, RADAR_PX, RADAR_PX);
    const intensities: number[] = [];
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (imageData.data[i] > 0) intensities.push(imageData.data[i]);
    }
    if (intensities.length === 0) return;
    intensities.sort((a, b) => a - b);
    // Use 98th percentile as the max so extreme outliers don't flatten everything
    const maxI = intensities[Math.min(intensities.length - 1, Math.floor(intensities.length * 0.98))] || 1;

    const output = ctx.createImageData(RADAR_PX, RADAR_PX);
    for (let i = 0; i < imageData.data.length; i += 4) {
      const normalized = Math.min(255, Math.round((imageData.data[i] / maxI) * 255));
      const [r, g, b, a] = intensityToColor(normalized);
      output.data[i] = r; output.data[i + 1] = g; output.data[i + 2] = b; output.data[i + 3] = a;
    }
    ctx.putImageData(output, 0, 0);
  }, [points]);

  return (
    <div className="relative rounded-lg overflow-hidden" style={{ width: "100%", aspectRatio: "1" }}>
      <img src={radar.image_url} alt="Radar" className="absolute inset-0 w-full h-full object-contain" />
      <canvas ref={canvasRef} width={RADAR_PX} height={RADAR_PX}
        className="absolute inset-0 w-full h-full" style={{ mixBlendMode: "screen" }} />
      {label && (
        <div className="absolute top-2 left-2 text-[10px] text-white bg-black/60 px-2 py-0.5 rounded">
          {label}
        </div>
      )}
      {points.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-scout-muted text-xs bg-black/60 px-3 py-1.5 rounded">No data</p>
        </div>
      )}
    </div>
  );
}

// ─── Stat card sub-component ───────────────────────────────────────────
function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="hud-panel p-3">
      <p className="text-[9px] text-scout-muted uppercase tracking-[0.15em]">{label}</p>
      <p className={`text-lg font-bold font-mono mt-0.5 ${color ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-[10px] text-scout-muted mt-0.5">{sub}</p>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════════
export default function AntiStratPage() {
  // ── Discovery state ──
  const [allDemos, setAllDemos] = useState<MatchDemoEntry[]>([]);
  const [matchInfoCache, setMatchInfoCache] = useState<Record<string, MatchInfoResponse>>({});
  const [selectedMap, setSelectedMap] = useState("");
  const [teamName, setTeamName] = useState("");

  // ── Loading state ──
  const [phase, setPhase] = useState<"idle" | "info" | "timelines" | "done">("idle");
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0 });

  // ── Loaded data ──
  const [sources, setSources] = useState<ScoutSource[]>([]);
  const [selectedDemos,setSelectedDemos] = useState<Set<string>>(new Set());
  const [filters,setFilters] = useState<ScoutFilters>(defaultScoutFilters);
  const [analysisErrors,setAnalysisErrors] = useState<string[]>([]);
  const requestVersion=useRef(0);
  const selectedSources=useMemo(()=>sources.filter(s=>selectedDemos.has(s.demoFile)),[sources,selectedDemos]);
  const timelines=useMemo(()=>selectedSources.map(s=>filterScoutTimeline(s,filters)),[selectedSources,filters]);
  const teamSidSets=useMemo(()=>selectedSources.map(s=>s.sids),[selectedSources]);
  const scoutRounds=useMemo(()=>buildScoutRounds(selectedSources,filters),[selectedSources,filters]);
  const [radar, setRadar] = useState<RadarInfo | null>(null);
  const [callouts, setCallouts] = useState<Callout[]>([]);

  // ── UI state ──
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);

  // ── Load demos on mount ──
  useEffect(() => {
    getMatchReplayDemos().then(setAllDemos).catch(()=>setAnalysisErrors(["Could not load the demo library. Refresh to retry."]));
    return ()=>{requestVersion.current++;};
  }, []);

  // ── Unique maps ──
  const teamDemos=useMemo(()=>scoutTeamDemos(allDemos,matchInfoCache,teamName),[allDemos,matchInfoCache,teamName]);
  const maps = useMemo(() => {
    const s = new Set(teamDemos.map((d) => d.map_name).filter(Boolean));
    return Array.from(s).sort();
  }, [teamDemos]);

  // ── Demos for selected map ──
  const mapDemos = useMemo(
    () => allDemos.filter((d) => d.map_name === selectedMap),
    [allDemos, selectedMap],
  );

  // ── Fetch match info when map changes ──
  useEffect(() => {
    if (!selectedMap || mapDemos.length === 0) return;
    let active=true;const version=requestVersion.current;
    setPhase("info");
    const toFetch = mapDemos.filter((d) => !matchInfoCache[d.demo_file]);
    if (toFetch.length === 0) { setPhase("idle"); return; }
    Promise.allSettled(toFetch.map((d) => getMatchInfo(d.demo_file))).then((results) => {
      if(!active)return;
      const next:Record<string,MatchInfoResponse> = {};
      for (const r of results) {
        if (r.status === "fulfilled") next[r.value.demo_file] = r.value;
      }
      setMatchInfoCache(prev=>({...prev,...next}));
      if(version===requestVersion.current)setPhase("idle");
    });
    return ()=>{active=false;};
  }, [selectedMap, mapDemos.length]);

  // ── Discovered team names ──
  const teamNames = useMemo(() => scoutTeamNames(allDemos,matchInfoCache), [allDemos,matchInfoCache]);

  // ── Demos matching team ──
  const matchedDemos = useMemo(() => {
    if (!teamName) return [];
    return teamDemos.filter(d=>d.map_name===selectedMap);
  }, [teamDemos, selectedMap, teamName]);

  // ── Analyze ──
  const handleAnalyze = useCallback(async () => {
    if (matchedDemos.length === 0) return;
    const version=++requestVersion.current;
    setPhase("timelines");
    setSources([]);setAnalysisErrors([]);setFilters(defaultScoutFilters);
    setLoadProgress({ loaded: 0, total: matchedDemos.length });

    // Load radar + callouts
    setRadar(null);
    getRadarInfo(selectedMap).then(value=>{if(version===requestVersion.current)setRadar(value);}).catch(()=>{if(version===requestVersion.current)setAnalysisErrors(e=>[...e,"Radar calibration is unavailable for this map."]);});
    getCallouts(selectedMap).then(value=>{if(version===requestVersion.current)setCallouts(value);}).catch(() => {if(version===requestVersion.current)setCallouts([]);});

    const loaded:ScoutSource[]=[];
    const errors:string[]=[];let attempted=0;

    for (const d of matchedDemos) {
      try {
        const tl = await getMatchReplayTimeline(d.demo_file);
        if(version!==requestVersion.current)return;

        // Build steamid set for the team in this demo
        const mi = matchInfoCache[d.demo_file] ?? await getMatchInfo(d.demo_file);
        if(version!==requestVersion.current)return;
        const sids=scoutTeamIds(tl,mi,teamName);
        if(!sids.size)throw new Error("The selected roster could not be identified in the demo.");
        loaded.push({demoFile:d.demo_file,timeline:tl,info:mi,sids});
      } catch(e:any) {errors.push(`${d.demo_file}: ${e?.response?.data?.detail ?? e.message ?? "Could not load demo"}`);}
      if(version!==requestVersion.current)return;
      setLoadProgress({ loaded: ++attempted, total: matchedDemos.length });
    }

    setSources(loaded);setSelectedDemos(new Set(loaded.map(s=>s.demoFile)));
    setAnalysisErrors(existing=>[...existing,...errors]);
    setPhase("done");
  }, [matchedDemos, selectedMap, teamName, matchInfoCache]);

  // ════════════════════════════════════════════════════════════════════
  // Aggregated computations (only run when phase === "done")
  // ════════════════════════════════════════════════════════════════════

  // Helper: get team's side in a round for a specific timeline
  const getTeamSide = useCallback((tl: MatchTimeline, sids: Set<string>, roundStartTick: number): 2 | 3 => {
    const round=tl.rounds.find(r=>r.start_tick===roundStartTick);
    const anchor=round?roundAnchor(round):roundStartTick+320;
    let t=0,ct=0;for(const sid of sids){const side=snapshotAt(tl.positions[sid],anchor)?.tn;if(side===2)t++;if(side===3)ct++;}
    return ct>t?3:2;
  }, []);

  // ── A. Site Hit Frequency ──
  const siteHits = useMemo(() => {
    if (phase !== "done") return { A: 0, B: 0, unknown: 0, total: 0 };
    let A = 0, B = 0, unknown = 0;

    for (let i = 0; i < timelines.length; i++) {
      const tl = timelines[i];
      const sids = teamSidSets[i];
      for (const r of tl.rounds) {
        const side = getTeamSide(tl, sids, r.start_tick);
        if (side !== 2) continue; // T-side only

        // Check for bomb plant
        const plant = tl.events.find(
          (e) => e.type === "bomb_plant" && e.tick >= r.start_tick && e.tick <= r.end_tick,
        );
        if (plant?.data.site) {
          if (plant.data.site.toUpperCase().includes("A")) A++;
          else if (plant.data.site.toUpperCase().includes("B")) B++;
          else unknown++;
        } else {
          unknown++;
        }
      }
    }
    return { A, B, unknown, total: A + B + unknown };
  }, [timelines, teamSidSets, callouts, phase, getTeamSide]);

  // ── B. First Kill Timing ──
  const firstKillTiming = useMemo(() => {
    if (phase !== "done") return { avg: 0, tAvg: 0, ctAvg: 0, times: [] as number[] };
    const times: number[] = [];
    const tTimes: number[] = [];
    const ctTimes: number[] = [];

    for (let i = 0; i < timelines.length; i++) {
      const tl = timelines[i];
      const sids = teamSidSets[i];
      for (const r of tl.rounds) {
        const side = getTeamSide(tl, sids, r.start_tick);
        const firstDeath = tl.events
          .filter((e) => e.type === "death" && e.tick >= r.start_tick && e.tick <= r.end_tick)
          .sort((a, b) => a.tick - b.tick)[0];
        if (!firstDeath) continue;
        const plant=tl.events.find(e=>e.type==="bomb_plant" && e.tick>=r.start_tick && e.tick<=r.end_tick);
        const anchor=filters.phase==="postplant" && plant ? plant.tick : roundAnchor(r);
        const secs = (firstDeath.tick - anchor) / (tl.tick_rate || 64);
        if (secs < 0 || secs > 120) continue;
        times.push(secs);
        if (side === 2) tTimes.push(secs);
        else ctTimes.push(secs);
      }
    }

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    return { avg: avg(times), tAvg: avg(tTimes), ctAvg: avg(ctTimes), times };
  }, [timelines, teamSidSets, phase, getTeamSide, filters.phase]);

  // ── C. Utility Tendencies ──
  const utilityTendencies = useMemo(() => {
    if (phase !== "done" || !radar) return { points: [] as { x: number; y: number }[], table: [] as { type: string; callout: string; count: number; pct: number }[] };
    const pts: { x: number; y: number }[] = [];
    const counts = new Map<string, { type: string; callout: string; count: number }>();
    let totalRounds = 0;

    for (let i = 0; i < timelines.length; i++) {
      const tl = timelines[i];
      const sids = teamSidSets[i];
      totalRounds += tl.rounds.length;

      for (const g of tl.grenades) {
        if (!sids.has(g.thrower)) continue;
        const lastPt = g.points[g.points.length - 1];
        if (!lastPt) continue;
        const rp = toRadar(lastPt[1], lastPt[2], radar);
        if (rp.x >= 0 && rp.x <= RADAR_PX && rp.y >= 0 && rp.y <= RADAR_PX) {
          pts.push(rp);
        }
        if (callouts.length > 0) {
          const callout = nearestCallout(lastPt[1], lastPt[2], callouts);
          const key = `${g.type}|${callout}`;
          const existing = counts.get(key);
          if (existing) existing.count++;
          else counts.set(key, { type: g.type, callout, count: 1 });
        }
      }
    }

    const table = Array.from(counts.values())
      .map((c) => ({ ...c, pct: totalRounds > 0 ? Math.round((c.count / totalRounds) * 100) : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);

    return { points: pts, table };
  }, [timelines, teamSidSets, radar, callouts, phase]);

  // ── D. AWP Positions ──
  const awpData = useMemo(() => {
    if (phase !== "done" || !radar) return { points: [] as { x: number; y: number }[], primaryAwper: "" };
    const pts: { x: number; y: number }[] = [];
    const awpTicks = new Map<string, number>();

    // Only sample every ~2 seconds (skip sequential samples) and filter out
    // movement — only keep positions where the player is roughly stationary
    // (consecutive samples within 50 world units = holding an angle)
    const SKIP = 16; // sample every 16th tick (~2 seconds at 8-tick decimation)
    const MOVE_THRESH = 50; // world units — if moved more than this, it's a rotation/walk

    for (let i = 0; i < timelines.length; i++) {
      const tl = timelines[i];
      const sids = teamSidSets[i];
      for (const sid of sids) {
        const samples = tl.positions[sid] ?? [];
        let lastX = -9999, lastY = -9999;
        let skipCount = 0;
        for (const s of samples) {
          if (!s.alive || (s.tn !== 3)) continue; // CT-side only
          const wpn = (s.w ?? "").toLowerCase();
          if (wpn === "awp") {
            awpTicks.set(sid, (awpTicks.get(sid) ?? 0) + 1);
            skipCount++;
            if (skipCount % SKIP !== 0) continue;
            // Only add if roughly stationary (not running between positions)
            const dist = Math.hypot(s.x - lastX, s.y - lastY);
            if (dist < MOVE_THRESH || lastX === -9999) {
              const rp = toRadar(s.x, s.y, radar);
              if (rp.x >= 0 && rp.x <= RADAR_PX && rp.y >= 0 && rp.y <= RADAR_PX) {
                pts.push(rp);
              }
            }
            lastX = s.x;
            lastY = s.y;
          } else {
            lastX = -9999;
            lastY = -9999;
            skipCount = 0;
          }
        }
      }
    }

    const decimated = pts;

    let primaryAwper = "";
    let maxTicks = 0;
    for (const [sid, count] of awpTicks) {
      if (count > maxTicks) {
        maxTicks = count;
        // Find name
        for (const tl of timelines) {
          const p = tl.players.find((pl) => pl.steamid === sid);
          if (p) { primaryAwper = p.name; break; }
        }
      }
    }

    return { points: decimated, primaryAwper };
  }, [timelines, teamSidSets, radar, phase]);

  // ── E. Round Win Patterns ──
  const winPatterns = useMemo(() => {
    if (phase !== "done") return { tWins: 0, tTotal: 0, ctWins: 0, ctTotal: 0, pistolWins: 0, pistolTotal: 0, ecoWins: 0, ecoTotal: 0 };
    let tWins = 0, tTotal = 0, ctWins = 0, ctTotal = 0;
    let pistolWins = 0, pistolTotal = 0;
    let ecoWins = 0, ecoTotal = 0;

    for (let i = 0; i < timelines.length; i++) {
      const tl = timelines[i];
      const sids = teamSidSets[i];
      for (const r of tl.rounds) {
        const side = getTeamSide(tl, sids, r.start_tick);
        const sideLabel = side === 2 ? "T" : "CT";
        const won = r.winner === sideLabel;

        if (side === 2) { tTotal++; if (won) tWins++; }
        else { ctTotal++; if (won) ctWins++; }

        // Pistol rounds
        if (r.num === 1 || r.num === 13) {
          pistolTotal++;
          if (won) pistolWins++;
        }

        // Eco detection
        let teamEquip = 0;
        for (const sid of sids) {
          const samples = selectedSources[i]?.timeline.positions[sid] ?? [];
          const s = snapshotAt(samples, roundAnchor(r));
          if (s) teamEquip += (s.eq ?? 0);
        }
        if (classifyBuy(teamEquip).label === "Eco") {
          ecoTotal++;
          if (won) ecoWins++;
        }
      }
    }

    return { tWins, tTotal, ctWins, ctTotal, pistolWins, pistolTotal, ecoWins, ecoTotal };
  }, [timelines, teamSidSets, phase, getTeamSide, selectedSources]);

  // ── F. Player Breakdown ──
  const playerStats = useMemo(() => {
    if (phase !== "done") return [];
    const map = new Map<string, {
      steamid: string; name: string; kills: number; deaths: number;
      hsKills: number; openingKills: number; openingDeaths: number;
      smokesThrown: number; flashesThrown: number; hesThrown: number; molovsThrown: number;
      weaponKills: Map<string, number>;
    }>();

    for (let i = 0; i < timelines.length; i++) {
      const tl = timelines[i];
      const sids = teamSidSets[i];

      // Init players
      for (const p of tl.players) {
        if (!sids.has(p.steamid) || map.has(p.steamid)) continue;
        map.set(p.steamid, {
          steamid: p.steamid, name: p.name, kills: 0, deaths: 0, hsKills: 0,
          openingKills: 0, openingDeaths: 0,
          smokesThrown: 0, flashesThrown: 0, hesThrown: 0, molovsThrown: 0,
          weaponKills: new Map(),
        });
      }

      // Track first kill per round — need to process deaths sorted by tick
      const roundFirstKill = new Map<number, boolean>();
      const deaths = tl.events
        .filter((e) => e.type === "death")
        .sort((a, b) => a.tick - b.tick);

      for (const evt of deaths) {
        const rnd = tl.rounds.find((r) => evt.tick >= r.start_tick && evt.tick <= r.end_tick)?.num ?? 0;
        const attacker = evt.data.attacker;
        const victim = evt.data.victim;

        // Count deaths for team players
        if (sids.has(victim)) {
          const s = map.get(victim);
          if (s) s.deaths++;
        }

        // Opening duel tracking — first kill of the round regardless of who did it
        if (!roundFirstKill.get(rnd) && attacker && attacker !== victim) {
          roundFirstKill.set(rnd, true);
          // If our player got the opening kill
          if (sids.has(attacker)) {
            const s = map.get(attacker);
            if (s) s.openingKills++;
          }
          // If our player died in the opening duel
          if (sids.has(victim)) {
            const vs = map.get(victim);
            if (vs) vs.openingDeaths++;
          }
        }

        // Count kills for team players
        if (attacker && attacker !== victim && sids.has(attacker)) {
          const s = map.get(attacker);
          if (s) {
            s.kills++;
            if (isTruthy(evt.data.headshot)) s.hsKills++;
            const wpn = evt.data.weapon ?? "unknown";
            s.weaponKills.set(wpn, (s.weaponKills.get(wpn) ?? 0) + 1);
          }
        }
      }

      // Grenades
      for (const g of tl.grenades) {
        if (!sids.has(g.thrower)) continue;
        const s = map.get(g.thrower);
        if (!s) continue;
        if (g.type === "smokegrenade") s.smokesThrown++;
        else if (g.type === "flashbang") s.flashesThrown++;
        else if (g.type === "hegrenade") s.hesThrown++;
        else if (g.type === "molotov" || g.type === "incgrenade") s.molovsThrown++;
      }
    }

    return Array.from(map.values()).sort((a, b) => b.kills - a.kills);
  }, [timelines, teamSidSets, phase]);

  // Total rounds analyzed
  const totalRounds = useMemo(
    () => timelines.reduce((sum, tl) => sum + tl.rounds.length, 0),
    [timelines],
  );

  // ════════════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════════════
  const pct = (n: number, d: number) => d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
  const pctNum = (n: number, d: number) => d > 0 ? Math.round((n / d) * 100) : 0;
  const overallWins = winPatterns.tWins + winPatterns.ctWins;
  const overallTotal = winPatterns.tTotal + winPatterns.ctTotal;
  const maxPlayerKills = Math.max(1, ...playerStats.map((p) => p.kills));

  // Find team logo from match info cache
  const teamLogo = useMemo(() => {
    if (!teamName) return "";
    const lower = teamName.toLowerCase();
    for (const d of matchedDemos) {
      const mi = matchInfoCache[d.demo_file];
      if (!mi) continue;
      if (mi.team1?.name.toLowerCase() === lower && mi.team1?.logo) return mi.team1.logo;
      if (mi.team2?.name.toLowerCase() === lower && mi.team2?.logo) return mi.team2.logo;
    }
    return "";
  }, [teamName, matchedDemos, matchInfoCache]);

  // Section header component
  const SectionHeader = ({ num, title, sub }: { num: string; title: string; sub?: string }) => (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-7 h-7 rounded-md bg-scout-accent/10 border border-scout-accent/30 flex items-center justify-center shrink-0">
        <span className="text-scout-accent font-mono font-bold text-[11px]">{num}</span>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        {sub && <p className="text-[10px] text-scout-muted">{sub}</p>}
      </div>
    </div>
  );

  // Win rate ring (SVG donut)
  const WinRateRing = ({ rate, size = 64, color, label }: { rate: number; size?: number; color: string; label: string }) => {
    const r = (size - 8) / 2;
    const circ = 2 * Math.PI * r;
    const offset = circ * (1 - rate / 100);
    const fontSize = size < 70 ? 14 : 18;
    return (
      <div className="flex flex-col items-center gap-1.5">
        <svg width={size} height={size}>
          {/* Background ring */}
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1e2636" strokeWidth={5} />
          {/* Progress ring (rotated -90 so it starts from top) */}
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={5}
            strokeDasharray={circ} strokeDashoffset={offset} strokeLinecap="round"
            className="transition-all duration-700"
            style={{ transform: "rotate(-90deg)", transformOrigin: "50% 50%" }} />
          {/* Centered percentage text */}
          <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central"
            fill={color} fontSize={fontSize} fontWeight="bold" fontFamily="JetBrains Mono, monospace">
            {rate}%
          </text>
        </svg>
        <span className="text-[9px] text-scout-muted uppercase tracking-wide">{label}</span>
      </div>
    );
  };

  return (
    <div className="relative h-screen flex flex-col overflow-hidden bg-[#0b1118] text-scout-text">
      <AppBackdrop tone="violet" />
      <AppHeader />

      <div className="relative flex-1 min-h-0 flex overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-80 shrink-0 border-r border-white/5 flex flex-col overflow-y-auto glass-sidebar" style={{ scrollbarWidth: "thin" }}>

        {/* Controls */}
        <div className="px-5 py-5 space-y-4 border-b border-white/5">
          <div className="mb-1">
            <span className="section-eyebrow" style={{ color: "#fca5a5" }}>SCOUT</span>
            <p className="mt-2 text-sm font-semibold text-white">Configure the report</p>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] text-scout-muted uppercase tracking-[0.12em] font-semibold">Team</label>
            <SearchableSelect ariaLabel="Scout team" allValue="" value={teamName}
              onChange={v=>{requestVersion.current++;setTeamName(v);setSources([]);setPhase("idle");
                if(!scoutTeamDemos(allDemos,matchInfoCache,v).some(d=>d.map_name===selectedMap))setSelectedMap("");}}
              placeholder="Select a team…" options={[{value:"",label:"Select a team…"},...teamNames.map(t=>({value:t,label:t}))]}/>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] text-scout-muted uppercase tracking-[0.12em] font-semibold">Map</label>
            <Select
              value={selectedMap}
              onChange={(v) => { requestVersion.current++;setSelectedMap(v); setPhase("idle"); setSources([]); }}
              className="w-full"
              placeholder="Select a map…"
              options={[
                { value: "", label: "Select a map…" },
                ...maps.map((m) => ({
                  value: m,
                  label: m,
                  icon: mapIconPath(m),
                  hint: `${teamDemos.filter((d) => d.map_name === m).length}`,
                })),
              ]}
            />
          </div>

            {phase === "info" ? (
              <div className="flex items-center gap-2 py-2">
                <div className="w-3 h-3 border border-scout-accent border-t-transparent rounded-full animate-spin" />
                <span className="text-[11px] text-scout-muted">Loading rosters…</span>
              </div>
            ) : null}

          <button
            onClick={handleAnalyze}
            disabled={!teamName || !selectedMap || !matchedDemos.length || phase === "timelines" || phase === "info"}
            className="hud-btn-primary w-full"
          >
            {phase === "timelines" ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-3 h-3 border-2 border-scout-accent border-t-transparent rounded-full animate-spin" />
                Loading {loadProgress.loaded}/{loadProgress.total}
              </span>
            ) : (
              "Analyze"
            )}
          </button>
        </div>

        {/* Matched demos */}
        {matchedDemos.length > 0 && (
          <div className="px-4 py-3 flex-1">
            <p className="text-[10px] text-scout-muted uppercase tracking-[0.12em] font-semibold mb-2">
              Demos ({matchedDemos.length})
            </p>
            <div className="space-y-1">
              {phase==="done" && <div className="flex gap-3 text-xs mb-2"><button className="text-scout-accent" onClick={()=>setSelectedDemos(new Set(sources.map(s=>s.demoFile)))}>Select all</button><button className="text-scout-muted" onClick={()=>setSelectedDemos(new Set())}>Clear</button></div>}
              {matchedDemos.map((d) => {
                const mi = matchInfoCache[d.demo_file];
                const isLoaded = sources.some(s=>s.demoFile===d.demo_file);
                return (
                  <label key={d.demo_file} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-scout-border/10 transition-colors cursor-pointer">
                    <input type="checkbox" aria-label={`Include ${d.demo_file}`} disabled={!isLoaded || phase!=="done"} checked={isLoaded && selectedDemos.has(d.demo_file)} onChange={e=>setSelectedDemos(prev=>{const next=new Set(prev);if(e.target.checked)next.add(d.demo_file);else next.delete(d.demo_file);return next;})} className="accent-scout-accent"/>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] text-gray-300 truncate">
                        {mi?.team1 && mi?.team2 ? `${mi.team1.name} vs ${mi.team2.name}` : d.demo_file}
                      </p>
                      {mi?.event && <p className="text-[9px] text-scout-muted truncate">{mi.event}</p>}
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </aside>

      {/* ── Main report ── */}
      <main className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        {analysisErrors.length>0 && <div role="alert" className="m-6 hud-panel p-4 text-sm text-scout-red">{analysisErrors.map(e=><p key={e}>{e}</p>)}</div>}
        {phase === "idle" && timelines.length === 0 && (
          <AntiStratEmptyState
            hasMap={!!selectedMap}
            hasTeam={!!teamName}
            teamCount={teamNames.length}
          />
        )}

        {phase === "timelines" && (
          <div className="flex flex-col items-center justify-center h-full gap-5 px-8">
            <div className="w-12 h-12 border-2 border-scout-accent border-t-transparent rounded-full animate-spin" />
            <div className="text-center">
              <p className="text-lg font-semibold text-white">Parsing demos</p>
              <p className="text-sm text-scout-muted mt-1 font-mono">
                {loadProgress.loaded} / {loadProgress.total}
              </p>
            </div>
            <div className="w-80 h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${loadProgress.total > 0 ? (loadProgress.loaded / loadProgress.total) * 100 : 0}%`,
                  background: "linear-gradient(90deg, #5ee0c2, #4ade80)",
                  boxShadow: "0 0 12px rgba(94, 224, 194,0.4)",
                }}
              />
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="p-6 space-y-6 max-w-6xl mx-auto">
            <section className="hud-panel p-4 space-y-3" aria-label="Scouting scenario filters">
              <div className="flex flex-wrap items-end gap-4">
                <label className="text-xs text-scout-muted">Side<SearchableSelect ariaLabel="Scout side" value={filters.side} allValue="all" onChange={v=>setFilters(f=>({...f,side:v as ScoutFilters["side"]}))} options={[{value:"all",label:"Both sides"},{value:"T",label:"T · Attacking"},{value:"CT",label:"CT · Defending / retaking"}]}/></label>
                <label className="text-xs text-scout-muted">Scenario<SearchableSelect ariaLabel="Scout scenario" noun="Scenarios" placeholder="Search scenarios…" value={filters.phase} allValue="all" onChange={v=>setFilters(f=>({...f,phase:v as ScoutFilters["phase"],site:v==="postplant" && f.site==="none"?"all":f.site}))} options={[{value:"all",label:"All round phases"},{value:"postplant",label:"After plant only"}]}/></label>
                <label className="text-xs text-scout-muted">{filters.side==="T"?"Site hit (planted site)":"Bomb planted at"}<SearchableSelect ariaLabel="Scout bombsite" value={filters.site} allValue="all" onChange={v=>setFilters(f=>({...f,site:v as ScoutFilters["site"]}))} options={[{value:"all",label:"All sites"},{value:"A",label:"A site"},{value:"B",label:"B site"},...(filters.phase==="all"?[{value:"none",label:"No plant"}]:[])]}/></label>
                <button className="hud-btn text-xs" onClick={()=>{setFilters(defaultScoutFilters);setSelectedDemos(new Set(sources.map(s=>s.demoFile)));}}>Reset filters</button>
              </div>
              <p className="text-xs text-scout-muted">{scoutRounds.length} matching rounds in {selectedSources.length} selected matches. Site filters use the actual bomb plant, not a guessed attack. CT + After plant shows retake/defuse setups; T + After plant shows post-plant holds.</p>
            </section>
            {radar && <TeamScoutExplorer rounds={scoutRounds} radar={radar} teamName={teamName} postplant={filters.phase==="postplant"}/>}
            {/* ═══ Summary Banner ═══ */}
            <div className="hud-panel hud-corner p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  {teamLogo ? (
                    <img
                      src={teamLogo}
                      alt={teamName}
                      className="w-12 h-12 object-contain rounded-xl"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-xl border border-scout-accent/60 flex items-center justify-center bg-scout-accent/10 shadow-[0_0_20px_rgba(94, 224, 194,0.15)]">
                      <span className="text-scout-accent font-mono font-bold text-base">VS</span>
                    </div>
                  )}
                  <div>
                    <h1 className="text-xl font-bold text-white tracking-tight">{teamName}</h1>
                    <p className="text-xs text-scout-muted mt-0.5">
                      {selectedMap.replace("de_", "").charAt(0).toUpperCase() + selectedMap.replace("de_", "").slice(1)} · {timelines.length} demo{timelines.length === 1 ? "" : "s"} · {totalRounds} rounds analyzed
                    </p>
                  </div>
                </div>
                {/* Overall win rate rings */}
                <div className="flex items-center gap-6">
                  <WinRateRing rate={pctNum(winPatterns.tWins, winPatterns.tTotal)} color={T_COLOR} label="T-side" />
                  <WinRateRing rate={pctNum(overallWins, overallTotal)} size={80} color="#5ee0c2" label="Overall" />
                  <WinRateRing rate={pctNum(winPatterns.ctWins, winPatterns.ctTotal)} color={CT_COLOR} label="CT-side" />
                </div>
              </div>
            </div>

            {/* ═══ Top row: Win Patterns + Site Hits side by side ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Win Patterns */}
              <div className="hud-panel p-5">
                <SectionHeader num="01" title="Round Win Patterns" sub="Win rates by category" />
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="T-side" value={pct(winPatterns.tWins, winPatterns.tTotal)} sub={`${winPatterns.tWins}W – ${winPatterns.tTotal - winPatterns.tWins}L`} color="text-[#DCBF6E]" />
                  <StatCard label="CT-side" value={pct(winPatterns.ctWins, winPatterns.ctTotal)} sub={`${winPatterns.ctWins}W – ${winPatterns.ctTotal - winPatterns.ctWins}L`} color="text-[#5B9BD5]" />
                  <StatCard label="Pistol Rounds" value={pct(winPatterns.pistolWins, winPatterns.pistolTotal)} sub={`${winPatterns.pistolWins} / ${winPatterns.pistolTotal} rounds`} />
                  <StatCard label="Eco Conversion" value={pct(winPatterns.ecoWins, winPatterns.ecoTotal)} sub={`${winPatterns.ecoWins} / ${winPatterns.ecoTotal} eco rounds`} />
                </div>
              </div>

              {/* Site Hit Frequency */}
              <div className="hud-panel p-5">
                <SectionHeader num="02" title="T-Side Site Hits" sub={`${siteHits.total} T-side rounds`} />
                {siteHits.total > 0 ? (
                  <div className="space-y-3">
                    {[
                      { label: "A Site", count: siteHits.A, color: T_COLOR },
                      { label: "B Site", count: siteHits.B, color: CT_COLOR },
                      { label: "No plant", count: siteHits.unknown, color: "#4b5563" },
                    ].map((s) => {
                      const p = siteHits.total > 0 ? Math.round((s.count / siteHits.total) * 100) : 0;
                      return (
                        <div key={s.label}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-white">{s.label}</span>
                            <span className="text-xs font-mono font-bold" style={{ color: s.color }}>{p}%</span>
                          </div>
                          <div className="h-3 rounded-full bg-scout-border/30 overflow-hidden">
                            <div className="h-full rounded-full transition-all duration-500" style={{ width: `${p}%`, background: s.color, minWidth: s.count > 0 ? 4 : 0 }} />
                          </div>
                          <p className="text-[9px] text-scout-muted mt-0.5">{s.count} round{s.count !== 1 ? "s" : ""}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-scout-muted">No T-side rounds found.</p>
                )}
              </div>
            </div>

            {/* ═══ First Blood Timing ═══ */}
            <div className="hud-panel p-5">
              <SectionHeader num="03" title={filters.phase==="postplant"?"First Post-Plant Duel":"First Blood Timing"} sub={filters.phase==="postplant"?"Seconds from plant to first kill in the selected phase":"Average live-round seconds to first kill"} />
              <div className="grid grid-cols-3 gap-4">
                <div className="hud-panel p-3 text-center">
                  <p className="text-2xl font-bold font-mono text-white">{firstKillTiming.avg.toFixed(1)}<span className="text-sm text-scout-muted">s</span></p>
                  <p className="text-[9px] text-scout-muted uppercase tracking-wide mt-1">Overall</p>
                </div>
                <div className="hud-panel p-3 text-center">
                  <p className="text-2xl font-bold font-mono" style={{ color: T_COLOR }}>{firstKillTiming.tAvg.toFixed(1)}<span className="text-sm text-scout-muted">s</span></p>
                  <p className="text-[9px] text-scout-muted uppercase tracking-wide mt-1">T-side</p>
                </div>
                <div className="hud-panel p-3 text-center">
                  <p className="text-2xl font-bold font-mono" style={{ color: CT_COLOR }}>{firstKillTiming.ctAvg.toFixed(1)}<span className="text-sm text-scout-muted">s</span></p>
                  <p className="text-[9px] text-scout-muted uppercase tracking-wide mt-1">CT-side</p>
                </div>
              </div>
            </div>

            {/* ═══ Radar row: Utility + AWP side by side ═══ */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Utility Tendencies */}
              <div className="hud-panel p-5">
                <SectionHeader num="04" title="Utility Tendencies" sub="Most common grenade usage" />
                <div className="space-y-4">
                  {radar && <RadarHeatmap radar={radar} points={utilityTendencies.points} label="Grenade landings" />}
                  {utilityTendencies.table.length > 0 && (
                    <div className="max-h-48 overflow-y-auto rounded" style={{ scrollbarWidth: "thin" }}>
                      {utilityTendencies.table.slice(0, 12).map((t, i) => (
                        <div key={i} className="flex items-center gap-2 py-1.5 px-2 border-b border-scout-border/10 last:border-0">
                          <span className="text-[10px] text-scout-muted font-mono w-5 shrink-0">#{i + 1}</span>
                          <img
                            src={`/icons/${t.type === "molotov" ? "molotov" : t.type}.svg`}
                            alt={t.type}
                            className="w-4 h-4 object-contain shrink-0"
                            style={{ filter: "brightness(0) invert(0.6)" }}
                          />
                          <span className="text-[11px] capitalize text-gray-400 w-14 shrink-0">{t.type.replace("grenade", "")}</span>
                          <span className="text-[11px] text-white flex-1 truncate">{t.callout}</span>
                          <span className="text-[11px] font-mono font-bold text-scout-accent shrink-0">{t.pct}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* AWP Positions */}
              <div className="hud-panel p-5">
                <SectionHeader num="05" title="AWP Positions" sub={awpData.primaryAwper ? `Primary: ${awpData.primaryAwper}` : "CT-side AWP holding spots"} />
                {radar && <RadarHeatmap radar={radar} points={awpData.points} label="AWP positions (CT)" />}
              </div>
            </div>

            {/* ═══ Player Breakdown ═══ */}
            <div>
              <SectionHeader num="06" title="Player Breakdown" sub={`${playerStats.length} players across ${timelines.length} demos`} />
              <div className="space-y-2">
                {playerStats.map((p) => {
                  const isExpanded = expandedPlayer === p.steamid;
                  const hsPct = p.kills > 0 ? Math.round((p.hsKills / p.kills) * 100) : 0;
                  const diff = p.kills - p.deaths;
                  const kdr = p.deaths > 0 ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2);
                  const topWeapons = Array.from(p.weaponKills.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
                  const killBarWidth = (p.kills / maxPlayerKills) * 100;
                  return (
                    <div key={p.steamid} className="hud-panel overflow-hidden">
                      <div
                        className={`flex items-center gap-4 px-4 py-3 cursor-pointer transition-colors ${isExpanded ? "bg-scout-accent/5" : "hover:bg-scout-border/10"}`}
                        onClick={() => setExpandedPlayer(isExpanded ? null : p.steamid)}
                      >
                        {/* Name + KDR */}
                        <div className="w-36 shrink-0">
                          <p className="text-sm font-semibold text-white">{p.name}</p>
                          <p className="text-[10px] text-scout-muted font-mono">{kdr} KDR</p>
                        </div>
                        {/* Kill bar */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 rounded-full bg-scout-border/30 overflow-hidden">
                              <div className="h-full rounded-full bg-scout-accent/60 transition-all" style={{ width: `${killBarWidth}%` }} />
                            </div>
                            <span className="text-xs font-mono font-bold text-white w-8 text-right">{p.kills}</span>
                          </div>
                        </div>
                        {/* Quick stats */}
                        <div className="flex items-center gap-3 text-[10px] shrink-0">
                          <span className="font-mono">
                            <span className="text-white font-bold">{p.kills}</span>
                            <span className="text-scout-muted">/</span>
                            <span className="text-gray-400">{p.deaths}</span>
                            <span className="text-scout-muted ml-0.5">
                              (<span className={diff >= 0 ? "text-scout-green" : "text-scout-red"}>{diff >= 0 ? "+" : ""}{diff}</span>)
                            </span>
                          </span>
                          <span className="text-gray-400">{hsPct}% HS</span>
                          <span className="text-scout-green">FK {p.openingKills}</span>
                          <span className="text-scout-muted">{isExpanded ? "▾" : "▸"}</span>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="px-4 pb-4 grid grid-cols-3 gap-3 border-t border-scout-border/20 pt-3">
                          <div className="hud-panel p-3 space-y-1.5">
                            <p className="text-[9px] text-scout-muted uppercase tracking-wide font-semibold">Top Weapons</p>
                            {topWeapons.map(([wpn, count]) => {
                              const wpnPct = p.kills > 0 ? Math.round((count / p.kills) * 100) : 0;
                              return (
                                <div key={wpn} className="flex items-center gap-2 text-[11px]">
                                  <img
                                    src={`/icons/${wpn}.svg`}
                                    alt={wpn}
                                    className="w-5 h-3 object-contain shrink-0"
                                    style={{ filter: "brightness(0) invert(0.85)" }}
                                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                                  />
                                  <span className="text-gray-400 w-16 truncate">{wpn}</span>
                                  <div className="flex-1 h-1.5 rounded-full bg-scout-border/30 overflow-hidden">
                                    <div className="h-full rounded-full bg-scout-accent/50" style={{ width: `${wpnPct}%` }} />
                                  </div>
                                  <span className="text-white font-mono w-6 text-right">{count}</span>
                                </div>
                              );
                            })}
                          </div>
                          <div className="hud-panel p-3 space-y-1.5">
                            <p className="text-[9px] text-scout-muted uppercase tracking-wide font-semibold">Opening Duels</p>
                            <div className="text-xl font-bold font-mono text-center py-2">
                              <span className="text-scout-green">{p.openingKills}</span>
                              <span className="text-scout-muted mx-1">–</span>
                              <span className="text-scout-red">{p.openingDeaths}</span>
                            </div>
                            <p className="text-[10px] text-scout-muted text-center">
                              {p.openingKills + p.openingDeaths > 0
                                ? `${Math.round((p.openingKills / (p.openingKills + p.openingDeaths)) * 100)}% success`
                                : "No duels"}
                            </p>
                          </div>
                          <div className="hud-panel p-3 space-y-1.5">
                            <p className="text-[9px] text-scout-muted uppercase tracking-wide font-semibold">Utility Thrown</p>
                            <div className="space-y-1 text-[11px]">
                              {([
                                { icon: "smokegrenade", label: "Smokes", count: p.smokesThrown },
                                { icon: "flashbang", label: "Flashes", count: p.flashesThrown },
                                { icon: "hegrenade", label: "HEs", count: p.hesThrown },
                                { icon: "molotov", label: "Molotovs", count: p.molovsThrown },
                              ] as const).map((u) => (
                                <div key={u.label} className="flex items-center gap-2">
                                  <img
                                    src={`/icons/${u.icon}.svg`}
                                    alt={u.label}
                                    className="w-4 h-4 object-contain shrink-0"
                                    style={{ filter: "brightness(0) invert(0.7)" }}
                                  />
                                  <span className="text-gray-400 flex-1">{u.label}</span>
                                  <span className="text-white font-mono">{u.count}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </main>
      </div>{/* /flex content area */}
    </div>
  );
}

/**
 * Empty-state hero shown before the user picks a map + team. Sets expectations
 * for what Anti-Strat does and nudges them through the sidebar flow.
 */
function AntiStratEmptyState({
  hasMap,
  hasTeam,
  teamCount,
}: {
  hasMap: boolean;
  hasTeam: boolean;
  teamCount: number;
}) {
  const hero = useReveal<HTMLDivElement>();
  const cards = useReveal<HTMLDivElement>();
  const step = hasTeam && hasMap ? 3 : hasTeam ? 2 : 1;

  const features = [
    {
      title: "Site hit frequency",
      desc: "See which bombsite the opponent prefers, split by pistol / eco / force / full-buy rounds.",
      color: "#f87171",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
          <path d="M3 12h6l2-6 4 12 2-6h4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
    },
    {
      title: "Utility tendencies",
      desc: "Aggregate smokes, flashes, and molotovs across every parsed demo onto a single radar heatmap.",
      color: "#fb923c",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18M3 12h18" />
        </svg>
      ),
    },
    {
      title: "AWP positions",
      desc: "Common AWP hold spots and peek timings, colour-coded by scope state and round phase.",
      color: "#5B9BD5",
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
        </svg>
      ),
    },
  ];

  return (
    <div className="relative min-h-full flex items-center justify-center px-8 py-16 overflow-hidden">
      {/* Ambient violet glow behind the hero. */}
      <div
        className="absolute inset-0 pointer-events-none"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(192,132,252,0.08) 0%, transparent 60%)",
        }}
      />

      <div
        ref={hero.ref}
        className={`reveal ${hero.shown ? "in" : ""} relative max-w-3xl w-full text-center`}
      >
        <span className="section-eyebrow" style={{ color: "#fca5a5" }}>
          SCOUT
        </span>
        <h1 className="mt-4 text-[clamp(2rem,5vw,3.5rem)] font-bold tracking-tight leading-[1.05] text-white">
          Scout the{" "}
          <span className="gradient-text">opponent</span>.
        </h1>
        <p className="mt-5 text-sm md:text-base text-scout-muted leading-relaxed max-w-xl mx-auto">
          Aggregate every parsed demo of a team on a single map to surface their
          habits — site preference, utility patterns, AWP hold spots, and
          per-player timing.
        </p>

        {/* Step indicator — matches sidebar flow */}
        <div className="mt-10 inline-flex items-center gap-3 px-4 py-2 rounded-full bg-white/[0.04] border border-white/10">
          <StepDot n={1} label="Pick a team" active={step >= 1} done={hasTeam} />
          <div className="w-6 h-px bg-white/10" />
          <StepDot n={2} label="Pick a map" active={step >= 2} done={hasMap} />
          <div className="w-6 h-px bg-white/10" />
          <StepDot n={3} label="Analyze" active={step >= 3} done={false} />
        </div>

        {hasMap && !hasTeam && teamCount === 0 && (
          <p className="mt-4 text-[11px] text-scout-muted font-mono">
            No teams found for this map — parse at least one demo first.
          </p>
        )}

        {/* Feature cards */}
        <div
          ref={cards.ref}
          className={`reveal reveal-delay-2 ${cards.shown ? "in" : ""} mt-14 grid grid-cols-1 md:grid-cols-3 gap-3 text-left`}
        >
          {features.map((f) => (
            <div
              key={f.title}
              className="hud-panel p-4 transition-all hover:-translate-y-0.5"
              style={{ borderColor: `${f.color}18` }}
            >
              <div className="flex items-center gap-2 mb-2" style={{ color: f.color }}>
                {f.icon}
                <span className="text-xs font-semibold uppercase tracking-[0.15em]">
                  {f.title}
                </span>
              </div>
              <p className="text-[11px] text-scout-muted leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>

        <p className="mt-10 text-[10px] text-scout-muted/70 font-mono uppercase tracking-[0.2em]">
          Configure on the left · Runs locally
        </p>
      </div>
    </div>
  );
}

function StepDot({ n, label, active, done }: { n: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono border transition-colors ${
          done
            ? "bg-scout-green/20 border-scout-green/40 text-scout-green"
            : active
              ? "bg-scout-accent/20 border-scout-accent/50 text-scout-accent"
              : "bg-white/[0.04] border-white/10 text-scout-muted"
        }`}
      >
        {done ? "✓" : n}
      </span>
      <span
        className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${
          active ? "text-white" : "text-scout-muted"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
