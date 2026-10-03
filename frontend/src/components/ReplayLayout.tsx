/**
 * ReplayLayout — wrapper for all replay sub-views.
 *
 * Loads the timeline, radar, and match info once (shared across tabs).
 * Provides compact sidebar navigation and a shared match summary.
 * Renders the active sub-view via nested Routes.
 */
import { useEffect, useState } from "react";
import { NavLink, Routes, Route, useParams, useNavigate, useLocation } from "react-router-dom";
import {
  MatchInfoResponse,
  MatchTimeline,
  RadarInfo,
  getMatchInfo,
  getMatchReplayTimeline,
  getRadarInfo,
} from "../api/client";
import MatchReplayViewer, { LiveReplayStatus } from "./MatchReplayViewer";
import EconomyPanel from "./EconomyPanel";
import HeatmapPanel from "./HeatmapPanel";
import StatsPanel from "./StatsPanel";
import InsightsPanel from "./InsightsPanel";
import LogoMark from "./LogoMark";
import { matchIdentity, scoreAt, sideColor } from "../utils/replayState";
import AppBackdrop from "./AppBackdrop";

const TABS = [
  { to: "", label: "Replay", end: true },
  { to: "insights", label: "Insights", end: false },
  { to: "economy", label: "Economy", end: false },
  { to: "heatmap", label: "Heatmap", end: false },
  { to: "stats", label: "Stats", end: false },
] as const;

export default function ReplayLayout() {
  const { demoFile: rawDemoFile } = useParams();
  const demoFile = decodeURIComponent(rawDemoFile ?? "");
  const navigate = useNavigate();
  const basePath = `/replay/${encodeURIComponent(demoFile)}`;

  const [timeline, setTimeline] = useState<MatchTimeline | null>(null);
  const [radar, setRadar] = useState<RadarInfo | null>(null);
  const [matchInfo, setMatchInfo] = useState<MatchInfoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Live playback status published by MatchReplayViewer — score / round /
  // time / bomb update as the user scrubs or plays.
  const [liveStatus, setLiveStatus] = useState<LiveReplayStatus | null>(null);
  const location = useLocation();
  useEffect(() => { if (location.pathname !== basePath && location.pathname !== `${basePath}/insights`) setLiveStatus(null); }, [location.pathname, basePath]);

  useEffect(() => {
    if (!demoFile) return;
    let cancelled = false;
    setError(null);
    setTimeline(null);
    setRadar(null);
    setMatchInfo(null);
    setLiveStatus(null);

    getMatchInfo(demoFile)
      .then((mi) => { if (!cancelled) setMatchInfo(mi); })
      .catch(() => {});

    getMatchReplayTimeline(demoFile)
      .then((t) => {
        if (cancelled) return;
        setTimeline(t);
        return getRadarInfo(t.map_name);
      })
      .then((r) => {
        if (cancelled || !r) return;
        setRadar(r);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.response?.data?.detail ?? "Failed to load timeline");
      });

    return () => { cancelled = true; };
  }, [demoFile]);

  if (!demoFile) {
    return (
      <div className="flex items-center justify-center h-screen text-scout-muted">
        No demo file specified.
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p className="text-scout-red">{error}</p>
        <button onClick={() => navigate("/replay")} className="hud-btn">
          ← Back to picker
        </button>
      </div>
    );
  }

  if (!timeline) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <div className="w-8 h-8 border-2 border-scout-accent border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-scout-muted">
          Loading replay… The first parse of a large demo can take a few minutes.
        </p>
        <button onClick={() => navigate("/replay")} className="hud-btn text-xs mt-2">
          ← Back
        </button>
      </div>
    );
  }

  const identity = matchIdentity(timeline, matchInfo);
  const finalScore = scoreAt(timeline, identity);
  const firstScore = liveStatus?.team1Score ?? finalScore[identity.team1];
  const secondScore = liveStatus?.team2Score ?? finalScore[identity.team1 === 2 ? 3 : 2];
  const firstSide = liveStatus?.team1CurrentSide;
  return (
    <div className="relative h-screen flex flex-col overflow-hidden bg-[#0b1118]">
      <AppBackdrop tone="green" />

      <div className="relative flex flex-1 min-h-0">
      <aside className="w-32 2xl:w-36 shrink-0 border-r border-white/5 bg-white/[0.015] flex flex-col p-2 gap-3 overflow-y-auto">
        <details className="relative group">
          <summary aria-label="Application navigation" className="list-none cursor-pointer rounded-lg hover:bg-white/5 flex items-center gap-2 p-2 text-xs text-white">
            <LogoMark className="w-4 h-4 shrink-0" /><span className="flex-1">CounterScout</span><span aria-hidden="true">⋮</span>
          </summary>
          <nav aria-label="Application navigation" className="flex flex-col gap-1 mt-1 border border-white/10 rounded-lg bg-[#0d1320] p-1">
            {[{label:"Home",to:"/"},{label:"Lineups",to:"/lineups"},{label:"Replay library",to:"/replay"},{label:"Anti-Strat",to:"/anti-strat"},{label:"Players",to:"/players"},{label:"Import",to:"/import"}].map(item => <NavLink key={item.to} to={item.to} className="text-xs text-scout-muted hover:text-white hover:bg-white/5 px-2 py-2 rounded">{item.label}</NavLink>)}
          </nav>
        </details>
        <button onClick={() => navigate("/replay")} className="hud-btn text-xs">← Library</button>
        <nav aria-label="Demo views" className="flex flex-col gap-1">
          {TABS.map(tab => <NavLink key={tab.label} to={tab.to ? `${basePath}/${tab.to}` : basePath} end
            className={({ isActive }) => `rounded-lg px-3 py-2.5 text-xs text-left transition ${isActive ? "bg-scout-accent/10 text-scout-accent border border-scout-accent/30" : "text-scout-muted hover:text-white hover:bg-white/5 border border-transparent"}`}>
            {tab.label}
          </NavLink>)}
        </nav>
        <div className="border-t border-white/10 pt-4 space-y-3 text-xs">
          <p className="text-scout-muted uppercase tracking-wider text-[10px]">Match</p>
          <p className="text-scout-muted text-[10px] break-all">{demoFile}</p>
          <p className="text-scout-muted">{timeline.map_name}</p>
          {liveStatus && <p className="text-scout-accent">Round {liveStatus.round}{liveStatus.currentTimeStr && <><br /><span className="text-scout-muted">{liveStatus.currentTimeStr} / {liveStatus.totalTimeStr}</span></>}</p>}
          {matchInfo?.event && <p className="text-scout-muted break-words">{matchInfo.event}</p>}
        </div>
      </aside>

      {/* Sub-views */}
      <div className="flex-1 min-w-0 min-h-0 overflow-hidden flex flex-col">
        <header aria-label="Match score" className="h-11 shrink-0 border-b border-white/5 flex items-center justify-center gap-3 px-3 bg-[#0b1118]/70">
          <span className="min-w-0 flex-1 text-right text-sm font-semibold truncate" style={{color:firstSide ? sideColor(firstSide) : "white"}}>{matchInfo?.team1?.name ?? identity.labels[identity.team1]}</span>
          {firstSide && <span className="text-[9px] text-scout-muted">{firstSide === 2 ? "T" : "CT"}</span>}
          <span className="font-mono text-xl text-white font-bold tabular-nums">{firstScore} : {secondScore}</span>
          {firstSide && <span className="text-[9px] text-scout-muted">{firstSide === 2 ? "CT" : "T"}</span>}
          <span className="min-w-0 flex-1 text-sm font-semibold truncate" style={{color:firstSide ? sideColor(firstSide === 2 ? 3 : 2) : "white"}}>{matchInfo?.team2?.name ?? identity.labels[identity.team1 === 2 ? 3 : 2]}</span>
          <span className="hidden lg:inline text-[9px] text-scout-muted">{location.pathname === basePath ? "LIVE" : location.pathname.endsWith("/insights") ? "ROUND RESULT" : "FINAL"}</span>
        </header>
        <div className="flex-1 min-h-0 overflow-hidden">
        <Routes>
          <Route
            index
            element={
              <MatchReplayViewer
                demoFile={demoFile}
                timeline={timeline}
                radar={radar}
                matchInfo={matchInfo}
                onBack={() => navigate("/replay")}
                onLiveStatus={setLiveStatus}
              />
            }
          />
          <Route
            path="insights"
            element={
              <InsightsPanel
                onRoundStatus={setLiveStatus}
                timeline={timeline}
                radar={radar}
                matchInfo={matchInfo}
                demoFile={demoFile}
                onReloadTimeline={() => {
                  // Force the parent useEffect to refetch by resetting timeline.
                  // A more explicit approach would bump a counter dep, but the
                  // user clicked "re-parse" knowing the tab will reload.
                  setTimeline(null);
                  getMatchReplayTimeline(demoFile).then(setTimeline).catch(() => {});
                }}
              />
            }
          />
          <Route
            path="economy"
            element={<EconomyPanel timeline={timeline} radar={radar} matchInfo={matchInfo} />}
          />
          <Route
            path="heatmap"
            element={<HeatmapPanel timeline={timeline} radar={radar} matchInfo={matchInfo} />}
          />
          <Route
            path="stats"
            element={<StatsPanel timeline={timeline} matchInfo={matchInfo} />}
          />
        </Routes>
        </div>
      </div>
      </div>
    </div>
  );
}
