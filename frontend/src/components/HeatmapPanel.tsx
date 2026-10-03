/**
 * HeatmapPanel — position density, death location, and grenade landing heatmaps.
 * Uses a canvas overlay on the radar image with gaussian-blur additive blending.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MatchTimeline, RadarInfo, type MatchInfoResponse } from "../api/client";
import Select from "./Select";
import SearchableSelect from "./SearchableSelect";
import {matchIdentity, roundAnchor, snapshotAt, teamSide} from "../utils/replayState";
import {matchesReplayFilters, playerSideAt, type ReplaySideFilter, type ReplayTeamFilter} from "../utils/replayFilters";

interface Props {
  timeline: MatchTimeline;
  radar: RadarInfo | null;
  matchInfo?: MatchInfoResponse | null;
}

const RADAR_PX = 1024;
type HeatmapMode = "positions" | "deaths" | "grenades";

/** Convert world coordinates to radar pixel coordinates. */
const toRadar = (
  wx: number,
  wy: number,
  radar: RadarInfo,
): { x: number; y: number } => ({
  x: (wx - radar.pos_x) / radar.scale,
  y: (radar.pos_y - wy) / radar.scale,
});

/** Jet-like colormap: intensity 0–255 → RGBA. */
const intensityToColor = (v: number): [number, number, number, number] => {
  if (v === 0) return [0, 0, 0, 0];
  const t = v / 255;
  // Blue → Cyan → Green → Yellow → Red
  let r = 0, g = 0, b = 0;
  if (t < 0.25) {
    b = 255;
    g = Math.round(t * 4 * 255);
  } else if (t < 0.5) {
    g = 255;
    b = Math.round((1 - (t - 0.25) * 4) * 255);
  } else if (t < 0.75) {
    g = 255;
    r = Math.round((t - 0.5) * 4 * 255);
  } else {
    r = 255;
    g = Math.round((1 - (t - 0.75) * 4) * 255);
  }
  const a = Math.min(255, Math.round(t * 400)); // fade in alpha
  return [r, g, b, a];
};

type RoundTimeFilter = "full" | "first15" | "first30" | "last15";

export default function HeatmapPanel({ timeline, radar, matchInfo }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<HeatmapMode>("positions");
  const identity = useMemo(()=>matchIdentity(timeline,matchInfo),[timeline,matchInfo]);
  const [teamFilter, setTeamFilter] = useState<ReplayTeamFilter>("all");
  const [sideFilter, setSideFilter] = useState<ReplaySideFilter>("all");
  const [halfFilter, setHalfFilter] = useState<"all" | "first" | "second" | "ot">("all");
  const [selectedPlayer, setSelectedPlayer] = useState<string>("all");
  const [roundTime, setRoundTime] = useState<RoundTimeFilter>("first30");

  // Determine round range based on half filter
  const roundRange = useMemo(() => {
    const total = timeline.rounds[timeline.rounds.length-1]?.num ?? 0;
    const first = timeline.rounds[0];
    if (!first) return {start:1,end:0};
    const firstSide = teamSide(timeline,identity,2,roundAnchor(first));
    const swap = timeline.rounds.find(r=>teamSide(timeline,identity,2,roundAnchor(r))!==firstSide)?.num ?? 13;
    if (halfFilter === "first") return { start: 1, end: swap - 1 };
    const regulationEnd = (swap - 1) * 2;
    if (halfFilter === "second") return { start: swap, end: Math.min(total,regulationEnd) };
    if (halfFilter === "ot") return {start:regulationEnd+1,end:total};
    return { start: 1, end: total };
  }, [timeline, identity, halfFilter]);

  // Get ticks for the selected round range
  const tickRange = useMemo(() => {
    const startRound = timeline.rounds.find((r) => r.num === roundRange.start);
    const endRound = timeline.rounds.find((r) => r.num === roundRange.end);
    return {
      start: startRound?.start_tick ?? 0,
      end: startRound && endRound ? endRound.end_tick : -1,
    };
  }, [timeline, roundRange]);

  // Compute data points based on mode
  const points = useMemo(() => {
    if (!radar) return [];
    const pts: { x: number; y: number }[] = [];

    if (mode === "positions") {
      // Build per-round tick windows based on roundTime filter
      const roundWindows: { start: number; end: number }[] = [];
      for (const r of timeline.rounds) {
        if (r.num < roundRange.start || r.num > roundRange.end) continue;
        let winStart = roundAnchor(r);
        let winEnd = r.end_tick;
        if (roundTime === "first15") winEnd = Math.min(r.end_tick, winStart + 15 * 64);
        else if (roundTime === "first30") winEnd = Math.min(r.end_tick, winStart + 30 * 64);
        else if (roundTime === "last15") winStart = Math.max(r.start_tick, r.end_tick - 15 * 64);
        roundWindows.push({ start: winStart, end: winEnd });
      }

      // Sample every 4th position (~0.5s intervals) — enough for density variation
      const SKIP = 4;

      for (const p of timeline.players) {
        if (selectedPlayer !== "all" && p.steamid !== selectedPlayer) continue;
        if (teamFilter !== "all" && identity.members[p.steamid] !== Number(teamFilter)) continue;
        const samples = timeline.positions[p.steamid] ?? [];
        let skipCount = 0;
        for (const s of samples) {
          if (!s.alive) continue;
          const inWindow = roundWindows.some((w) => s.t >= w.start && s.t <= w.end);
          if (!inWindow) continue;
          if (sideFilter !== "all" && (s.tn ?? playerSideAt(timeline,identity,p.steamid,s.t)) !== sideFilter) continue;
          skipCount++;
          if (skipCount % SKIP !== 0) continue;
          const rp = toRadar(s.x, s.y, radar);
          if (rp.x >= 0 && rp.x <= RADAR_PX && rp.y >= 0 && rp.y <= RADAR_PX) {
            pts.push(rp);
          }
        }
      }
      // Decimate if over limit
      const MAX_POINTS = 15000;
      if (pts.length > MAX_POINTS) {
        const step = Math.ceil(pts.length / MAX_POINTS);
        return pts.filter((_, i) => i % step === 0);
      }
    } else if (mode === "deaths") {
      // Get death positions from events
      for (const evt of timeline.events) {
        if (evt.type !== "death") continue;
        if (evt.tick < tickRange.start || evt.tick > tickRange.end) continue;
        const victimSid = evt.data.victim;
        if (!matchesReplayFilters(timeline,identity,victimSid,evt.tick,teamFilter,sideFilter,selectedPlayer)) continue;
        if (selectedPlayer !== "all" && victimSid !== selectedPlayer) continue;
        // Get victim position from their position samples at the death tick
        const samples = timeline.positions[victimSid];
        if (!samples) continue;
        const nearest = snapshotAt(samples,evt.tick);
        if (!nearest) continue;
        const rp = toRadar(nearest.x, nearest.y, radar);
        if (rp.x >= 0 && rp.x <= RADAR_PX && rp.y >= 0 && rp.y <= RADAR_PX) {
          pts.push(rp);
        }
      }
    } else if (mode === "grenades") {
      for (const g of timeline.grenades) {
        const throwTick = g.points[0]?.[0];
        if (throwTick == null || !matchesReplayFilters(timeline,identity,g.thrower,throwTick,teamFilter,sideFilter,selectedPlayer)) continue;
        if (selectedPlayer !== "all" && g.thrower !== selectedPlayer) continue;
        // Use last point of trajectory as landing/detonate position
        const lastPt = g.points[g.points.length - 1];
        if (!lastPt) continue;
        const tick = lastPt[0];
        if (tick < tickRange.start || tick > tickRange.end) continue;
        const rp = toRadar(lastPt[1], lastPt[2], radar);
        if (rp.x >= 0 && rp.x <= RADAR_PX && rp.y >= 0 && rp.y <= RADAR_PX) {
          pts.push(rp);
        }
      }
    }

    return pts;
  }, [timeline, identity, radar, mode, teamFilter, sideFilter, selectedPlayer, tickRange, roundRange, roundTime]);

  // Draw heatmap on canvas
  const drawHeatmap = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Step 1: Draw intensity map (grayscale, additive)
    ctx.clearRect(0, 0, RADAR_PX, RADAR_PX);

    if (points.length === 0) return;

    // Create offscreen canvas for intensity accumulation
    const off = document.createElement("canvas");
    off.width = RADAR_PX;
    off.height = RADAR_PX;
    const offCtx = off.getContext("2d")!;
    offCtx.clearRect(0, 0, RADAR_PX, RADAR_PX);
    offCtx.globalCompositeOperation = "lighter";

    // Scale radius + alpha based on point count for readable heatmaps
    const n = points.length;
    const radius = n < 200 ? 16 : n < 2000 ? 12 : 8;
    const alpha = Math.max(0.005, Math.min(0.08, 2 / Math.sqrt(n)));

    for (const p of points) {
      const gradient = offCtx.createRadialGradient(p.x, p.y, 0, p.x, p.y, radius);
      gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      gradient.addColorStop(0.5, `rgba(255, 255, 255, ${alpha * 0.3})`);
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      offCtx.fillStyle = gradient;
      offCtx.beginPath();
      offCtx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      offCtx.fill();
    }

    // Step 2: Read intensity and apply colormap with percentile normalization
    const imageData = offCtx.getImageData(0, 0, RADAR_PX, RADAR_PX);
    const data = imageData.data;
    const output = ctx.createImageData(RADAR_PX, RADAR_PX);

    // Use 98th percentile as max so outliers don't flatten everything
    const intensities: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 0) intensities.push(data[i]);
    }
    if (intensities.length === 0) return;
    intensities.sort((a, b) => a - b);
    const maxIntensity = intensities[Math.min(intensities.length - 1, Math.floor(intensities.length * 0.98))] || 1;

    for (let i = 0; i < data.length; i += 4) {
      const normalized = Math.min(255, Math.round((data[i] / maxIntensity) * 255));
      const [r, g, b, a] = intensityToColor(normalized);
      output.data[i] = r;
      output.data[i + 1] = g;
      output.data[i + 2] = b;
      output.data[i + 3] = a;
    }

    ctx.putImageData(output, 0, 0);
  }, [points]);

  useEffect(() => {
    drawHeatmap();
  }, [drawHeatmap]);

  return (
    <div className="h-full flex gap-4 p-4 overflow-hidden">
      {/* Radar + canvas overlay */}
      <div className="flex-1 min-w-0 flex items-center justify-center">
        <div className="relative" style={{ width: "min(100%, 80vh)", aspectRatio: "1" }}>
          {radar && (
            <img
              src={radar.image_url}
              alt="Radar"
              className="absolute inset-0 w-full h-full object-contain rounded-lg"
              style={{ imageRendering: "auto" }}
            />
          )}
          <canvas
            ref={canvasRef}
            width={RADAR_PX}
            height={RADAR_PX}
            className="absolute inset-0 w-full h-full rounded-lg"
            style={{ mixBlendMode: "screen" }}
          />
          {points.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-scout-muted text-sm bg-black/60 px-3 py-1.5 rounded">
                No data for current filters
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Controls panel */}
      <div className="w-64 shrink-0 flex flex-col gap-3 overflow-y-auto" style={{ scrollbarWidth: "thin" }}>
        <div className="hud-panel p-3 space-y-3">
          <h3 className="text-xs text-scout-muted uppercase tracking-[0.15em]">Mode</h3>
          <div className="flex flex-col gap-1">
            {([
              { id: "positions" as const, label: "Position Density" },
              { id: "deaths" as const, label: "Death Locations" },
              { id: "grenades" as const, label: "Grenade Landings" },
            ]).map((m) => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`text-xs text-left px-2 py-1.5 rounded transition-all ${
                  mode === m.id
                    ? "bg-scout-accent/15 text-scout-accent border border-scout-accent/40"
                    : "text-scout-muted hover:text-white border border-transparent hover:bg-scout-border/20"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        {(
          <div className="hud-panel p-3 space-y-3">
            <h3 className="text-xs text-scout-muted uppercase tracking-[0.15em]">Half</h3>
            <div className="flex gap-1">
              {(["all", "first", "second", "ot"] as const).map((h) => (
                <button
                  key={h}
                  onClick={() => setHalfFilter(h)}
                  className={`flex-1 text-[10px] px-2 py-1 rounded font-semibold ${
                    halfFilter === h
                      ? "bg-scout-accent/15 text-scout-accent border border-scout-accent/40"
                      : "hud-btn"
                  }`}
                >
                  {h === "all" ? "All" : h === "first" ? "1st" : h === "second" ? "2nd" : "OT"}
                </button>
              ))}
            </div>
          </div>
        )}

        {mode === "positions" && (
          <div className="hud-panel p-3 space-y-3">
            <h3 className="text-xs text-scout-muted uppercase tracking-[0.15em]">Round Time</h3>
            <div className="grid grid-cols-2 gap-1">
              {([
                { id: "first15" as const, label: "First 15s" },
                { id: "first30" as const, label: "First 30s" },
                { id: "last15" as const, label: "Last 15s" },
                { id: "full" as const, label: "Full Round" },
              ]).map((t) => (
                <button
                  key={t.id}
                  onClick={() => setRoundTime(t.id)}
                  className={`text-[10px] px-2 py-1 rounded font-semibold ${
                    roundTime === t.id
                      ? "bg-scout-accent/15 text-scout-accent border border-scout-accent/40"
                      : "hud-btn"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <p className="text-[9px] text-scout-muted/60">
              {roundTime === "first15" ? "Shows default setups" :
               roundTime === "first30" ? "Shows early-round positions" :
               roundTime === "last15" ? "Shows late-round/retake positions" :
               "All positions (less distinct patterns)"}
            </p>
          </div>
        )}

        <div className="hud-panel p-3 space-y-3">
          <h3 className="text-xs text-scout-muted uppercase tracking-[0.15em]">Team</h3>
          <SearchableSelect ariaLabel="Heatmap team" className="!w-full" value={teamFilter}
            onChange={v=>{setTeamFilter(v as ReplayTeamFilter);setSelectedPlayer("all");}}
            options={[{value:"all",label:"All teams"},...[2,3].map(team=>({value:String(team),label:identity.labels[team]}))]} />
        </div>
        <div className="hud-panel p-3 space-y-3">
          <h3 className="text-xs text-scout-muted uppercase tracking-[0.15em]">Side</h3>
          <div className="flex gap-1">
            {([
              { id: "all" as const, label: "Both" },
              { id: 2 as const, label: "T" },
              { id: 3 as const, label: "CT" },
            ]).map((t) => (
              <button
                key={String(t.id)}
                aria-pressed={sideFilter === t.id}
                onClick={() => setSideFilter(t.id)}
                className={`flex-1 text-[10px] px-2 py-1 rounded font-semibold ${
                  sideFilter === t.id
                    ? "bg-scout-accent/15 text-scout-accent border border-scout-accent/40"
                    : "hud-btn"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="hud-panel p-3 space-y-3">
          <h3 className="text-xs text-scout-muted uppercase tracking-[0.15em]">Player</h3>
          <Select
            value={selectedPlayer}
            onChange={setSelectedPlayer}
            className="w-full"
            options={[
              { value: "all", label: "All Players" },
              ...timeline.players.filter(p=>teamFilter==="all" || identity.members[p.steamid]===Number(teamFilter)).map((p) => ({ value: p.steamid, label: p.name })),
            ]}
          />
        </div>

        <div className="hud-panel p-3">
          <p className="text-[10px] text-scout-muted">
            {points.length.toLocaleString()} data points
          </p>
        </div>
      </div>
    </div>
  );
}
