/**
 * Dashboard — main view. HUD-styled layout.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Callout,
  clearAllData,
  ExecuteCombo,
  getCallouts,
  getDownloadedDemos,
  getExecutes,
  getIngestionStatus,
  getMaps,
  getTopLineups,
  getMatchReplayDemos,
  MatchDemoEntry,
  DownloadedMap,
  LineupRanking,
  runPipeline,
} from "../api/client";
import LineupCard from "./LineupCard";
import ScatterPlot from "./ScatterPlot";
import SettingsPanel from "./SettingsPanel";
import AppHeader from "./AppHeader";
import AppBackdrop from "./AppBackdrop";
import Select from "./Select";
import SearchableSelect from "./SearchableSelect";
import { mapIconPath } from "../utils/mapIcons";
import { useReveal } from "../hooks/useReveal";

const GRENADE_TYPES = [
  { id: "smokegrenade", label: "Smoke" },
  { id: "hegrenade", label: "HE" },
  { id: "flashbang", label: "Flash" },
  { id: "molotov", label: "Molotov" },
];

const ALL_MAPS = [
  "de_mirage",
  "de_dust2",
  "de_inferno",
  "de_nuke",
  "de_ancient",
  "de_anubis",
  "de_vertigo",
  "de_overpass",
  "de_train",
  "de_cache",
];

export default function Dashboard() {
  const navigate = useNavigate();
  const [selectedMap, setSelectedMap] = useState(() => {
    try { return localStorage.getItem("lineups.selectedMap") || "de_mirage"; }
    catch { return "de_mirage"; }
  });
  const mapChosenRef = useRef(false);
  const lineupRequestRef = useRef(0);
  const [selectedType, setSelectedType] = useState("smokegrenade");
  const [selectedSide, setSelectedSide] = useState<"all" | "T" | "CT">("all");
  const [selectedPlayer, setSelectedPlayer] = useState<string>("");
  const [selectedTeam, setSelectedTeam] = useState("");
  const [library, setLibrary] = useState<MatchDemoEntry[]>([]);
  const [teamFilterReady, setTeamFilterReady] = useState(true);
  const teamOptions = useMemo(() => Array.from(new Set(library.filter(d => d.map_name === selectedMap)
    .flatMap(d => [d.team1_name, d.team2_name]).filter((n): n is string => !!n)))
    .sort((a, b) => a.localeCompare(b)), [library, selectedMap]);
  useEffect(() => { getMatchReplayDemos().then(setLibrary).catch(() => {}); }, []);
  useEffect(() => {
    if (selectedTeam && !teamOptions.includes(selectedTeam)) setSelectedTeam("");
    setSelectedPlayer("");
    setShowExecutes(false);
  }, [selectedTeam, teamOptions]);
  const [lineups, setLineups] = useState<LineupRanking[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<number | undefined>();
  const [clearing, setClearing] = useState(false);
  const [callouts, setCallouts] = useState<Callout[]>([]);
  const [groupByThrowFrom, setGroupByThrowFrom] = useState(true);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [expandedNades, setExpandedNades] = useState<Set<number>>(new Set());
  const [hideNoise, setHideNoise] = useState(false);
  const [executes, setExecutes] = useState<ExecuteCombo[]>([]);
  const [showExecutes, setShowExecutes] = useState(false);
  const [ingestedMaps, setIngestedMaps] = useState<Set<string>>(new Set());
  const [downloadedMaps, setDownloadedMaps] = useState<DownloadedMap[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);

  useEffect(() => {
    getMaps()
      .then((m) => setIngestedMaps(new Set(m)))
      .catch(() => {});
    getDownloadedDemos()
      .then((d) => {
        setDownloadedMaps(d.maps);
        setSelectedMap((current) =>
          mapChosenRef.current || d.maps.some((map) => map.map_name === current)
            ? current
            : (d.maps[0]?.map_name ?? current),
        );
      })
      .catch(() => {});
  }, []);

  const fetchLineups = useCallback(async () => {
    const requestId = ++lineupRequestRef.current;
    setLoading(true);
    setLineups([]);
    setSelectedClusterId(undefined);
    setError(null);
    try {
      const sideParam = selectedSide === "all" ? undefined : selectedSide;
      const res = await getTopLineups(selectedMap, selectedType, 500, sideParam, selectedTeam || undefined);
      if (requestId !== lineupRequestRef.current) return;
      setLineups(res.lineups);
      setTeamFilterReady(res.team_filter_ready);
      if (res.lineups.length) setIngestedMaps(prev => prev.has(selectedMap) ? prev : new Set([...prev, selectedMap]));
    } catch (e: any) {
      if (requestId !== lineupRequestRef.current) return;
      const detail = e?.response?.data?.detail;
      setError(detail ?? "Failed to fetch lineups");
      setLineups([]);
    } finally {
      if (requestId === lineupRequestRef.current) setLoading(false);
    }
  }, [selectedMap, selectedType, selectedSide, selectedTeam]);

  useEffect(() => {
    try { localStorage.setItem("lineups.selectedMap", selectedMap); } catch {}
    setAnalysisMessage(null);
    setSelectedClusterId(undefined);
    getCallouts(selectedMap)
      .then(setCallouts)
      .catch(() => setCallouts([]));
    setCollapsedGroups(new Set());
  }, [selectedMap]);

  // Distinct players from the loaded clusters' top_throwers, sorted by
  // total throws descending. Reset whenever the underlying lineups change
  // so a stale name from the previous map/side doesn't survive.
  const availablePlayers = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of lineups) {
      for (const t of r.cluster.top_throwers ?? []) {
        if (!t?.name) continue;
        totals.set(t.name, (totals.get(t.name) ?? 0) + (t.count ?? 0));
      }
    }
    return Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);
  }, [lineups]);

  useEffect(() => {
    if (selectedPlayer && !availablePlayers.includes(selectedPlayer)) {
      setSelectedPlayer("");
    }
  }, [availablePlayers, selectedPlayer]);

  const filteredLineups = useMemo(() => {
    let result = lineups;
    if (selectedPlayer) {
      const needle = selectedPlayer.toLowerCase();
      result = result.filter((r) =>
        (r.cluster.top_throwers ?? []).some(
          (t) => t.name?.toLowerCase() === needle,
        ),
      );
    }
    if (hideNoise) {
      result = result.filter((r) => {
        const c = r.cluster;
        // Hide singleton throws that lost
        if (c.throw_count <= 1 && c.round_win_rate === 0) return false;
        // Hide very short flight distance (accidental drops)
        const dx = c.land_centroid_x - c.throw_centroid_x;
        const dy = c.land_centroid_y - c.throw_centroid_y;
        if (dx * dx + dy * dy < 200 * 200) return false;
        return true;
      });
    }
    return result;
  }, [lineups, selectedPlayer, hideNoise]);

  // Collapse the raw bucket list into one "main nade" per landing spot, with
  // genuinely-different throw positions kept as variations underneath. The
  // bucket pipeline already merges nearby (pos+angle) throws, but two pros
  // landing the same smoke from two different sides of the map still produce
  // two clusters — we want both, but ten clusters that all land on B Default
  // from the same window should collapse into one card with a single
  // variation.
  //
  //   LANDING_GROUP_RADIUS — landings within this distance count as the same
  //     "discovered nade" (the same denial / cover spot).
  //   VARIATION_MIN_DISTANCE — within a landing group, a new throw is only
  //     accepted as a variation if its standing position is at least this far
  //     from every variation already in the group, so we never list two
  //     near-duplicate stances.
  const LANDING_GROUP_RADIUS_SQ = 250 * 250;
  const VARIATION_MIN_DISTANCE_SQ = 300 * 300;

  const mainNades = useMemo(() => {
    const sorted = [...filteredLineups].sort(
      (a, b) => b.impact_score - a.impact_score,
    );
    const groups: {
      key: number;
      primary: LineupRanking;
      // Dedup'd subset shown in the UI — no two variations within
      // VARIATION_MIN_DISTANCE of each other so the user never sees
      // near-duplicate stances for the same landing spot.
      variations: LineupRanking[];
      // Every filtered lineup that lands in this group. Used for scatter
      // click lookup so selecting a pruned variation still resolves to its
      // parent main nade (otherwise the filter silently does nothing).
      members: LineupRanking[];
    }[] = [];

    for (const r of sorted) {
      const lx = r.cluster.land_centroid_x;
      const ly = r.cluster.land_centroid_y;

      const group = groups.find((g) => {
        const dx = g.primary.cluster.land_centroid_x - lx;
        const dy = g.primary.cluster.land_centroid_y - ly;
        return dx * dx + dy * dy < LANDING_GROUP_RADIUS_SQ;
      });

      if (!group) {
        groups.push({
          key: r.cluster.cluster_id,
          primary: r,
          variations: [r],
          members: [r],
        });
        continue;
      }

      group.members.push(r);

      const tx = r.cluster.throw_centroid_x;
      const ty = r.cluster.throw_centroid_y;
      const tooClose = group.variations.some((v) => {
        const dx = v.cluster.throw_centroid_x - tx;
        const dy = v.cluster.throw_centroid_y - ty;
        return dx * dx + dy * dy < VARIATION_MIN_DISTANCE_SQ;
      });

      if (!tooClose) {
        group.variations.push(r);
      }
    }

    return groups;
  }, [filteredLineups, LANDING_GROUP_RADIUS_SQ, VARIATION_MIN_DISTANCE_SQ]);

  // When the user clicks a dot in the scatter, narrow the grid to the single
  // main nade that contains that cluster. We match against `members` (not
  // `variations`) so clicking a pruned near-duplicate still resolves — and
  // if the clicked cluster was pruned from the display set, inject it back
  // into variations so the user sees what they actually clicked.
  const focusedNade = useMemo(() => {
    if (selectedClusterId === undefined) return null;
    const parent = mainNades.find((n) =>
      n.members.some((v) => v.cluster.cluster_id === selectedClusterId),
    );
    if (!parent) return null;
    const inVariations = parent.variations.some(
      (v) => v.cluster.cluster_id === selectedClusterId,
    );
    if (inVariations) return parent;
    const clicked = parent.members.find(
      (v) => v.cluster.cluster_id === selectedClusterId,
    );
    if (!clicked) return parent;
    return { ...parent, variations: [...parent.variations, clicked] };
  }, [selectedClusterId, mainNades]);

  const groupedNades = useMemo(() => {
    if (!groupByThrowFrom || callouts.length === 0) return null;
    // Group main nades by LANDING callout — each main nade is already keyed by
    // landing spot, so this becomes a region label ("B Site", "Mid") wrapping
    // all the nades that cover that area.
    const MAX_DIST_SQ = 1200 * 1200;
    const buckets = new Map<string, typeof mainNades>();
    for (const nade of mainNades) {
      const lx = nade.primary.cluster.land_centroid_x;
      const ly = nade.primary.cluster.land_centroid_y;
      let bestName = "Unlabeled";
      let bestD2 = MAX_DIST_SQ;
      for (const c of callouts) {
        const dx = c.x - lx;
        const dy = c.y - ly;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestD2) {
          bestD2 = d2;
          bestName = c.name;
        }
      }
      const pretty = bestName.replace(
        /([a-z])([A-Z])|([A-Z])([A-Z][a-z])/g,
        "$1$3 $2$4",
      );
      const arr = buckets.get(pretty) ?? [];
      arr.push(nade);
      buckets.set(pretty, arr);
    }
    return Array.from(buckets.entries())
      .map(([name, items]) => ({
        name,
        items: items.sort(
          (a, b) => b.primary.impact_score - a.primary.impact_score,
        ),
        totalImpact: items.reduce((s, n) => s + n.primary.impact_score, 0),
      }))
      .sort((a, b) => b.totalImpact - a.totalImpact);
  }, [mainNades, callouts, groupByThrowFrom]);

  // Auto-expand a main nade when the user picks one of its variations from
  // the scatter, so the variation is immediately visible inside the card.
  useEffect(() => {
    if (focusedNade) {
      setExpandedNades((prev) => {
        if (prev.has(focusedNade.key)) return prev;
        const next = new Set(prev);
        next.add(focusedNade.key);
        return next;
      });
    }
  }, [focusedNade]);

  const toggleNade = (key: number) => {
    setExpandedNades((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleGroup = (name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  useEffect(() => {
    fetchLineups();
    getExecutes(selectedMap)
      .then(setExecutes)
      .catch(() => setExecutes([]));
  }, [fetchLineups, selectedMap]);

  const handleClearData = async () => {
    if (
      !window.confirm(
        "Delete all analysed lineups from the database? Demo files on disk will be kept — you can re-run the pipeline without re-downloading.",
      )
    ) {
      return;
    }
    setClearing(true);
    try {
      await clearAllData();
      setLineups([]);
      setSelectedClusterId(undefined);
      setIngestedMaps(new Set());
      setError(null);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      setError(detail ?? "Failed to clear data");
    } finally {
      setClearing(false);
    }
  };

  const refreshMapData = useCallback(async () => {
    const [maps, demos] = await Promise.all([getMaps(), getDownloadedDemos()]);
    setIngestedMaps(new Set(maps));
    setDownloadedMaps(demos.maps);
    await Promise.all([
      fetchLineups(),
      getExecutes(selectedMap).then(setExecutes).catch(() => setExecutes([])),
    ]);
  }, [fetchLineups, selectedMap]);

  const analyseSelectedMap = async () => {
    setAnalysing(true);
    setAnalysisMessage("Queuing demo analysis…");
    setError(null);
    try {
      const queued = await runPipeline({ map_name: selectedMap, clear_existing: true });
      const deadline = Date.now() + 10 * 60 * 1000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
        const status = await getIngestionStatus();
        if (status.last_completed_run_id >= queued.run_id) {
          if (status.phase === "error" || status.status.startsWith("error")) {
            throw new Error(status.message || status.status || "Demo analysis failed.");
          }
          await refreshMapData();
          setAnalysisMessage(
            status.lineups_created_this_run > 0
              ? null
              : "Analysis completed, but these demos contained no usable grenade throws for this map. Try another map or demo.",
          );
          return;
        }
        setAnalysisMessage(
          status.message || (status.demos_total_this_run > 0
            ? `Analysing ${status.demos_parsed_this_run}/${status.demos_total_this_run} demo(s)…`
            : "Preparing demo analysis…"),
        );
      }
      throw new Error("Demo analysis is taking longer than expected. It is still running in the background.");
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? e?.message ?? "Failed to analyse the downloaded demos");
      setAnalysisMessage(null);
    } finally {
      setAnalysing(false);
    }
  };

  const topWin = filteredLineups[0]
    ? `${(filteredLineups[0].cluster.round_win_rate * 100).toFixed(1)}%`
    : "—";

  return (
    <div className="relative h-screen flex flex-col overflow-hidden bg-[#0b1118] text-scout-text">
      <AppBackdrop tone="teal" />
      <AppHeader
        actions={
          <>
            <SearchableSelect
              value={selectedMap}
              onChange={(map) => {
                if (analysing) return;
                mapChosenRef.current = true;
                setSelectedMap(map);
              }}
              className="!w-44"
              ariaLabel="Select lineup map"
              clearable={false}
              noun="Maps"
              placeholder="Search maps…"
              groups={[
                ...(downloadedMaps.length > 0
                  ? [{
                      label: "Downloaded",
                      options: downloadedMaps.map((d) => ({
                        value: d.map_name,
                        label: d.map_name,
                        icon: mapIconPath(d.map_name),
                        hint: `${d.count}`,
                        dot: ingestedMaps.has(d.map_name) ? "#5ee0c2" : undefined,
                      })),
                    }]
                  : []),
                {
                  label: "All maps",
                  options: ALL_MAPS.filter(
                    (m) => !downloadedMaps.some((d) => d.map_name === m),
                  ).map((m) => ({
                    value: m,
                    label: m,
                    icon: mapIconPath(m),
                    dot: ingestedMaps.has(m) ? "#5ee0c2" : undefined,
                  })),
                },
              ]}
            />
            <button onClick={() => setShowSettings(true)} className="hud-btn">
              Settings
            </button>
            <button
              onClick={handleClearData}
              disabled={clearing}
              className="hud-btn-danger"
            >
              {clearing ? "Clearing…" : "Clear"}
            </button>
          </>
        }
      />

      <div className="relative flex-1 min-h-0 overflow-y-auto space-y-8 px-4 md:px-6 pt-8 pb-12" style={{ scrollbarWidth: "thin" }}>
      {/* ── Page title ── */}
      <DashboardHero
        selectedMap={selectedMap}
        demoCount={downloadedMaps.find((map) => map.map_name === selectedMap)?.count ?? 0}
        lineupCount={filteredLineups.length}
      />

      <div className="max-w-7xl mx-auto w-full space-y-6">
      <div className="hud-panel px-4 py-3 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-3 text-xs text-scout-muted">
          Team
          <SearchableSelect ariaLabel="Filter lineups by team" value={selectedTeam} allValue="" onChange={setSelectedTeam}
            options={[{value:"",label:"All teams"},...teamOptions.map(t=>({value:t,label:t}))]} />
        </label>
        <p className="text-xs text-scout-muted flex-1">{selectedTeam ? `Throws and statistics from ${selectedTeam} only.` : "Compare all throws, or focus on a team's utility."}</p>
        {selectedTeam && !teamFilterReady && <button disabled={analysing} onClick={analyseSelectedMap} className="hud-btn-primary text-xs">
          {analysing ? "Analysing…" : "Update analysis for team filters"}
        </button>}
      </div>
      {/* ── Grenade type tabs + side filter ── */}
      <>
      <div className="flex items-center gap-3 flex-wrap px-1">
        <div className="flex gap-1.5 flex-wrap">
          {GRENADE_TYPES.map((g) => (
            <button
              key={g.id}
              className={`hud-tab ${
                selectedType === g.id ? "hud-tab-active" : "hud-tab-idle"
              }`}
              onClick={() => setSelectedType(g.id)}
            >
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5 ml-auto items-center flex-wrap">
          {downloadedMaps.some((map) => map.map_name === selectedMap) && !ingestedMaps.has(selectedMap) && (
            <button
              onClick={analyseSelectedMap}
              disabled={analysing}
              className="hud-tab hud-tab-active disabled:opacity-60"
              title="Parse downloaded demos and build grenade lineup clusters"
            >
              {analysing ? "Analysing…" : `Analyse ${selectedMap.replace("de_", "")}`}
            </button>
          )}
          <button
            onClick={() => setHideNoise((v) => !v)}
            className={`hud-tab ${hideNoise ? "hud-tab-active" : "hud-tab-idle"}`}
            title="Hide noise: singleton losses + short flight distance throws"
          >
            {hideNoise ? "Noise Hidden" : "Hide Noise"}
          </button>
          <button
            onClick={() => setShowExecutes((v) => !v)}
            disabled={!!selectedTeam}
            className={`hud-tab ${showExecutes ? "hud-tab-active" : "hud-tab-idle"}`}
            title={selectedTeam ? "Execute combinations are available in the All teams view" : "Show detected execute combos for this map"}
          >
            Executes{executes.length > 0 ? ` · ${executes.length}` : ""}
          </button>
          {availablePlayers.length > 0 && (
            <Select
              value={selectedPlayer}
              onChange={setSelectedPlayer}
              minWidth={160}
              title="Filter to lineups thrown by a specific player"
              options={[
                { value: "", label: "All players" },
                ...availablePlayers.map((p) => ({ value: p, label: p })),
              ]}
            />
          )}
          <div className="flex gap-1 ml-1">
            {(["all", "T", "CT"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSelectedSide(s)}
                className={`hud-tab ${selectedSide === s ? "hud-tab-active" : "hud-tab-idle"}`}
                title={
                  s === "all"
                    ? "Show both sides"
                    : s === "T"
                      ? "Only T-side lineups"
                      : "Only CT-side lineups"
                }
              >
                {s === "all" ? "Both" : s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Execute combos ── */}
      {showExecutes && executes.length > 0 && (
        <div className="space-y-4">
          <div className="px-1">
            <span className="section-eyebrow" style={{ color: "#86efac" }}>DETECTED EXECUTES</span>
            <p className="mt-1.5 text-xs text-scout-muted">
              {selectedMap} &middot;{" "}
              <span className="text-gray-300 font-mono">{executes.length}</span> coordinated combos
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {executes.map((ex) => (
              <div
                key={ex.execute_id}
                className="hud-panel p-5 flex flex-col gap-3 relative overflow-hidden group transition-all hover:border-scout-green/40"
              >
                <div
                  className="absolute inset-x-0 top-0 h-px"
                  style={{
                    background:
                      "linear-gradient(90deg, transparent 0%, rgba(74,222,128,0.6) 50%, transparent 100%)",
                  }}
                />
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-[13px] font-semibold text-white leading-tight">
                      {ex.name}
                    </p>
                    <p className="text-[10px] text-scout-muted mt-0.5 font-mono">
                      {ex.grenade_summary}
                    </p>
                  </div>
                  {ex.side && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-md border border-scout-accent/40 text-scout-accent shrink-0">
                      {ex.side}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                  <span className="text-scout-muted uppercase tracking-[0.1em]">Rounds</span>
                  <span className="font-mono text-gray-300 text-right">{ex.occurrence_count}</span>
                  <span className="text-scout-muted uppercase tracking-[0.1em]">Win rate</span>
                  <span className="font-mono text-scout-green text-right">
                    {(ex.round_win_rate * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {ex.members.map((m) => {
                    const color =
                      m.grenade_type === "smokegrenade"
                        ? "#cbd5e1"
                        : m.grenade_type === "flashbang"
                          ? "#fde047"
                          : m.grenade_type === "hegrenade"
                            ? "#f87171"
                            : m.grenade_type === "molotov"
                              ? "#fb923c"
                              : "#9ca3af";
                    return (
                      <span
                        key={m.cluster_id}
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded border truncate max-w-[180px]"
                        style={{ borderColor: color, color }}
                        title={m.label || `Cluster #${m.cluster_id}`}
                      >
                        {m.label || `#${m.cluster_id}`}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {showExecutes && executes.length === 0 && (
        <p className="text-[12px] text-scout-muted px-1">
          No execute combos detected for {selectedMap}. Run the pipeline with multiple demos to detect coordinated utility patterns.
        </p>
      )}

      {/* ── Top row: scatter + ingest/stats ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
          {filteredLineups.length > 0 ? (
            <ScatterPlot
              lineups={filteredLineups}
              selectedId={selectedClusterId}
              onSelect={(id) =>
                setSelectedClusterId((prev) => (prev === id ? undefined : id))
              }
            />
          ) : (
            <div className="hud-panel min-h-64 px-6 py-8 flex items-center justify-center text-scout-muted">
              {loading ? (
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-scout-accent animate-pulse-glow" />
                  Loading data…
                </span>
              ) : (
                <div className="max-w-md text-center space-y-3">
                  <div className="mx-auto w-9 h-9 rounded-full border border-scout-border bg-scout-accent/5 text-scout-accent flex items-center justify-center text-lg">+</div>
                  <p className="text-sm text-gray-200 font-medium">
                    {selectedTeam && !teamFilterReady ? "Update analysis to enable team filters" : selectedTeam && teamFilterReady ? "No matching throws for this team" : analysing
                      ? "Analysing demo utility…"
                      : analysisMessage
                      ? "No grenade lineups were produced"
                      : downloadedMaps.some((map) => map.map_name === selectedMap)
                        ? "Ready to analyse downloaded demos"
                        : `No ${selectedMap.replace("de_", "")} demos in your library`}
                  </p>
                  <p className="text-xs leading-relaxed text-scout-muted">
                    {selectedTeam ? (!teamFilterReady ? "Older analysis has no per-throw roster information. Update it once; your demo files and team names are kept." : "Try another grenade type or side, or choose All teams.") : analysisMessage ??
                      (downloadedMaps.some((map) => map.map_name === selectedMap)
                        ? "Analyse extracts utility throws and groups them into replayable lineups."
                        : "Choose a map marked Downloaded above, or add a demo from the Replay page.")}
                  </p>
                  {downloadedMaps.some((map) => map.map_name === selectedMap) && !analysing && (
                    <button onClick={analyseSelectedMap} className="hud-btn-primary text-xs">
                      Analyse {selectedMap.replace("de_", "")} demos
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          <div className="hud-panel p-6 h-full flex flex-col justify-between gap-5">
            <div>
              <span className="section-eyebrow">SESSION</span>
              <p className="mt-3 text-sm text-gray-300 leading-relaxed">
                Click a dot in the chart to highlight a lineup, or browse the
                ranked grid below.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Stat label="Lineups" value={String(filteredLineups.length)} color="text-scout-accent" />
              <Stat label="Map" value={selectedMap.replace("de_", "")} color="text-scout-blue" />
              <Stat label="Type" value={selectedType.replace("grenade", "")} color="text-scout-smoke" />
              <Stat label="Top Win" value={topWin} color="text-scout-green" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Error state ── */}
      {error && (
        <div className="hud-panel border-scout-red/30 bg-scout-red/5 px-4 py-3 text-xs text-scout-red">
          {error}
        </div>
      )}

      {/* ── Lineup grid ── */}
      {filteredLineups.length > 0 && (
        <div>
          <div className="flex items-end justify-between mb-5 px-1 flex-wrap gap-3">
            <div>
              <span className="section-eyebrow">DISCOVERED NADES</span>
              <p className="mt-1.5 text-xs text-scout-muted">
                {selectedMap} &middot; {selectedType.replace("grenade", "")} &middot;{" "}
                <span className="text-gray-300 font-mono">{mainNades.length}</span>{" "}
                main &middot;{" "}
                <span className="text-gray-300 font-mono">
                  {filteredLineups.length}
                </span>{" "}
                variations
                {selectedPlayer && (
                  <>
                    {" "}
                    &middot;{" "}
                    <span className="text-scout-accent">{selectedPlayer}</span>
                  </>
                )}
                {focusedNade && (
                  <>
                    {" "}
                    &middot;{" "}
                    <span className="text-scout-accent">filtered to selection</span>
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {focusedNade && (
                <button
                  onClick={() => setSelectedClusterId(undefined)}
                  className="hud-btn"
                  title="Clear scatter selection — show every nade again"
                >
                  Clear filter
                </button>
              )}
              <button
                onClick={() => setGroupByThrowFrom((v) => !v)}
                className={groupByThrowFrom ? "hud-btn-primary" : "hud-btn"}
                title="Group nades by the callout where the grenade lands"
              >
                {groupByThrowFrom ? "Grouped" : "Flat"}
              </button>
            </div>
          </div>

          {focusedNade ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              <MainNadeCard
                nade={focusedNade}
                expanded
                onToggle={() => setSelectedClusterId(undefined)}
                selectedClusterId={selectedClusterId}
                onSelectVariation={setSelectedClusterId}
                activePlayer={selectedPlayer || null}
                activeTeam={selectedTeam || null}
              />
            </div>
          ) : groupedNades ? (
            <div className="space-y-8">
              {groupedNades.map((g) => {
                const collapsed = collapsedGroups.has(g.name);
                const variationCount = g.items.reduce(
                  (s, n) => s + n.variations.length,
                  0,
                );
                return (
                  <section key={g.name}>
                    <button
                      onClick={() => toggleGroup(g.name)}
                      className="w-full flex items-center gap-3 mb-4 group"
                    >
                      <span className="text-scout-accent font-mono text-sm group-hover:drop-shadow-[0_0_6px_rgba(94, 224, 194,0.6)] transition">
                        {collapsed ? "▸" : "▾"}
                      </span>
                      <span className="text-sm font-semibold tracking-tight text-white">
                        {g.name}
                      </span>
                      <div className="flex-1 h-px bg-gradient-to-r from-white/10 to-transparent" />
                      <span className="text-[10px] text-scout-muted font-mono uppercase tracking-[0.15em]">
                        {g.items.length} nade{g.items.length === 1 ? "" : "s"}{" "}
                        &middot; {variationCount} variation
                        {variationCount === 1 ? "" : "s"} &middot; impact{" "}
                        <span className="text-scout-accent">
                          {g.totalImpact.toFixed(2)}
                        </span>
                      </span>
                    </button>
                    {!collapsed && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {g.items.map((nade) => (
                          <MainNadeCard
                            key={nade.key}
                            nade={nade}
                            expanded={expandedNades.has(nade.key)}
                            onToggle={() => toggleNade(nade.key)}
                            selectedClusterId={selectedClusterId}
                            onSelectVariation={setSelectedClusterId}
                            activePlayer={selectedPlayer || null}
                            activeTeam={selectedTeam || null}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {mainNades.map((nade) => (
                <MainNadeCard
                  key={nade.key}
                  nade={nade}
                  expanded={expandedNades.has(nade.key)}
                  onToggle={() => toggleNade(nade.key)}
                  selectedClusterId={selectedClusterId}
                  onSelectVariation={setSelectedClusterId}
                  activePlayer={selectedPlayer || null}
                  activeTeam={selectedTeam || null}
                />
              ))}
            </div>
          )}
        </div>
      )}

      </>
      </div>{/* /max-w-7xl inner */}
      </div>{/* /scrollable content */}

      {/* ── Settings modal ── */}
      <SettingsPanel open={showSettings} onClose={() => setShowSettings(false)} />

    </div>
  );
}

function DashboardHero({
  selectedMap,
  demoCount,
  lineupCount,
}: {
  selectedMap: string;
  demoCount: number;
  lineupCount: number;
}) {
  const { ref, shown } = useReveal<HTMLDivElement>();
  return (
    <div
      ref={ref}
      className={`reveal ${shown ? "in" : ""} max-w-7xl mx-auto w-full`}
    >
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div>
          <span className="section-eyebrow">LINEUP LIBRARY</span>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white mt-2">
            {selectedMap.replace("de_", "")} <span className="accent">utility</span>
          </h1>
          <p className="mt-2 text-sm text-scout-muted leading-relaxed max-w-xl">
            Compare repeatable throws from your demos. Filter first, then select a point to inspect and replay it.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 shrink-0">
          <div className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 min-w-28">
            <p className="text-[9px] uppercase tracking-[0.14em] text-scout-muted">Demos</p>
            <p className="font-mono text-scout-accent text-lg mt-0.5">{demoCount}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 min-w-28">
            <p className="text-[9px] uppercase tracking-[0.14em] text-scout-muted">Visible</p>
            <p className="font-mono text-scout-green text-lg mt-0.5">{lineupCount}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-xl bg-white/[0.03] border border-white/5 px-3.5 py-2.5 transition-colors hover:bg-white/[0.05]">
      <p className="text-[9px] text-scout-muted uppercase tracking-[0.18em] font-semibold">{label}</p>
      <p className={`text-lg font-bold font-mono ${color} mt-1 tracking-tight`}>{value}</p>
    </div>
  );
}

interface MainNadeCardProps {
  nade: {
    key: number;
    primary: LineupRanking;
    variations: LineupRanking[];
  };
  expanded: boolean;
  onToggle: () => void;
  selectedClusterId: number | undefined;
  onSelectVariation: (id: number) => void;
  activePlayer: string | null;
  activeTeam: string | null;
}

function MainNadeCard({
  nade,
  expanded,
  onToggle,
  selectedClusterId,
  onSelectVariation,
  activePlayer,
  activeTeam,
}: MainNadeCardProps) {
  const variationCount = nade.variations.length;
  const hasVariations = variationCount > 1;
  // The "primary" is the highest-impact variation; the expand list below
  // shows the rest, so we never render the primary twice.
  const others = nade.variations.slice(1);

  return (
    <div className="flex flex-col gap-2">
      <div onClick={() => onSelectVariation(nade.primary.cluster.cluster_id)}>
        <LineupCard
          ranking={nade.primary}
          selected={selectedClusterId === nade.primary.cluster.cluster_id}
          activePlayer={activePlayer}
          activeTeam={activeTeam}
        />
      </div>
      {hasVariations && (
        <button
          onClick={onToggle}
          className="text-[10px] font-mono uppercase tracking-[0.15em] px-2 py-1.5 rounded border border-scout-border bg-scout-panel/60 text-scout-muted hover:text-scout-accent hover:border-scout-accent/60 transition flex items-center justify-between"
        >
          <span>
            <span className="text-scout-accent">{expanded ? "▾" : "▸"}</span>{" "}
            {variationCount - 1} other variation
            {variationCount - 1 === 1 ? "" : "s"}
          </span>
          <span className="text-scout-muted/70 normal-case tracking-normal">
            from different spots
          </span>
        </button>
      )}
      {expanded && others.length > 0 && (
        <div className="flex flex-col gap-3 pl-3 border-l-2 border-scout-accent/30">
          {others.map((v, i) => (
            <div key={v.cluster.cluster_id}>
              <p className="text-[9px] text-scout-muted uppercase tracking-[0.15em] mb-1 pl-1">
                Variation {i + 2} / {variationCount}
              </p>
              <div onClick={() => onSelectVariation(v.cluster.cluster_id)}>
                <LineupCard
                  ranking={v}
                  selected={selectedClusterId === v.cluster.cluster_id}
                  activePlayer={activePlayer}
                  activeTeam={activeTeam}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
