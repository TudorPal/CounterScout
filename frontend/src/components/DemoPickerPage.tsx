/**
 * DemoPickerPage — full-page list of demos with upload support.
 *
 * Users can:
 * - Search and filter demos, grouping by map or team → map
 * - Drag-and-drop or click to upload new .dem files (with progress bar)
 * - Delete demos they no longer need
 * - Click a card to open the replay viewer
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Cs2PathResponse,
  MatchDemoEntry,
  MatchInfoResponse,
  deleteDemo,
  getCs2Path,
  getMatchInfo,
  getMatchReplayDemos,
  uploadDemos,
  updateLocalDemoTeamNames,
  updateLocalDemoTeamNamesBatch,
} from "../api/client";
import AppHeader from "./AppHeader";
import { mapIconPath } from "../utils/mapIcons";
import AppBackdrop from "./AppBackdrop";
import { useReveal } from "../hooks/useReveal";
import SearchableSelect from "./SearchableSelect";
import DemoTeamEditor from "./DemoTeamEditor";

const formatBytes = (n: number): string => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const formatDate = (mtime: number): string => {
  const d = new Date(mtime * 1000);
  return d.toLocaleString();
};

// Keep the compact demo index while navigating between pages. The server still
// remains authoritative after uploads/deletes, but returning to Replay no
// longer blocks on a full library fetch plus N roster lookups.
let demoLibraryCache: MatchDemoEntry[] | null = null;
let demoLibraryFetchedAt = 0;
const DEMO_LIBRARY_TTL_MS = 30_000;

export default function DemoPickerPage() {
  const navigate = useNavigate();
  const hero = useReveal<HTMLDivElement>();
  const [demos, setDemos] = useState<MatchDemoEntry[] | null>(demoLibraryCache);
  const [error, setError] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<"map" | "team">(() => {
    try { return localStorage.getItem("replay.groupBy") === "team" ? "team" : "map"; } catch { return "map"; }
  });
  const [teamFilter, setTeamFilter] = useState("");
  const [mapFilter, setMapFilter] = useState("");
  const [search, setSearch] = useState("");
  const teams = useMemo(() => Array.from(new Set((demos ?? []).flatMap(d => [d.team1_name, d.team2_name])
    .filter((n): n is string => !!n))).sort((a, b) => a.localeCompare(b)), [demos]);
  const maps = useMemo(() => Array.from(new Set((demos ?? []).map(d => d.map_name))).sort(), [demos]);
  const visibleDemos = useMemo(() => (demos ?? []).filter(d =>
    (!teamFilter || [d.team1_name, d.team2_name].includes(teamFilter)) && (!mapFilter || d.map_name === mapFilter) &&
    `${d.demo_file} ${d.team1_name ?? ""} ${d.team2_name ?? ""} ${d.map_name}`.toLowerCase().includes(search.toLowerCase().trim())),
    [demos, teamFilter, mapFilter, search]);
  useEffect(() => { try { localStorage.setItem("replay.groupBy", groupBy); } catch {} }, [groupBy]);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadFile, setUploadFile] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [team1Name, setTeam1Name] = useState("");
  const [team2Name, setTeam2Name] = useState("");
  // Batch naming is deliberately opt-in per roster. A name entered for one
  // group must never replace the generated label for its opponents.
  const [applyTeam1ToBatch, setApplyTeam1ToBatch] = useState(false);
  const [applyTeam2ToBatch, setApplyTeam2ToBatch] = useState(false);
  const [namingQueue, setNamingQueue] = useState<MatchInfoResponse[]>([]);
  const [savingTeamNames, setSavingTeamNames] = useState(false);

  // Delete state
  const [deleting, setDeleting] = useState<string | null>(null);
  const [editingDemo, setEditingDemo] = useState<string | null>(null);

  // CS2 link status
  const [linkInfo, setLinkInfo] = useState<Cs2PathResponse | null>(null);

  const loadDemos = useCallback(async (force = false) => {
    if (!force && demoLibraryCache && Date.now() - demoLibraryFetchedAt < DEMO_LIBRARY_TTL_MS) {
      setDemos(demoLibraryCache);
      return demoLibraryCache;
    }
    setError(null);
    try {
      const list = await getMatchReplayDemos();
      demoLibraryCache = list;
      demoLibraryFetchedAt = Date.now();
      setDemos(list);
      return list;
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Failed to load demos");
      return [];
    }
  }, []);

  useEffect(() => { loadDemos(); }, [loadDemos]);
  useEffect(() => { getCs2Path().then(setLinkInfo).catch(() => {}); }, []);

  const handleUpload = useCallback(async (files: File[]) => {
    const demosToUpload = files.filter((file) => file.name.toLowerCase().endsWith(".dem"));
    if (demosToUpload.length === 0) {
      setUploadError("Select one or more .dem files");
      return;
    }
    setUploading(true);
    setUploadPct(0);
    setUploadFile(
      demosToUpload.length === 1
        ? demosToUpload[0].name
        : `${demosToUpload.length} demos`,
    );
    setUploadError(null);
    try {
      const result = await uploadDemos(demosToUpload, (pct) => setUploadPct(pct));
      setUploadPct(100);
      const infos = await Promise.all(
        result.uploaded.map((demo) => getMatchInfo(demo.demo_file)),
      );
      setNamingQueue(infos);
      const first = infos[0];
      if (first) {
        setTeam1Name(first.team1?.name ?? "");
        setTeam2Name(first.team2?.name ?? "");
      }
      setApplyTeam1ToBatch(false);
      setApplyTeam2ToBatch(false);
      if (result.failed.length > 0) {
        setUploadError(result.failed.map((f) => `${f.file}: ${f.error}`).join(" · "));
      }
      loadDemos(true); // refresh the small server index once after the batch
    } catch (e: any) {
      setUploadError(
        e?.response?.data?.detail ?? `Upload failed: ${e?.message ?? "unknown error"}`
      );
    } finally {
      setUploading(false);
    }
  }, [loadDemos]);

  const saveTeamNames = useCallback(async () => {
    const currentUpload = namingQueue[0];
    if (!currentUpload) return;
    setSavingTeamNames(true);
    setUploadError(null);
    try {
      const updated = await updateLocalDemoTeamNames(
        currentUpload.demo_file,
        team1Name,
        team2Name,
      );
      setNamingQueue((queue) => queue.slice(1));
      const next = namingQueue[1];
      setTeam1Name(next?.team1?.name ?? "");
      setTeam2Name(next?.team2?.name ?? "");
      setApplyTeam1ToBatch(false);
      setApplyTeam2ToBatch(false);
      loadDemos(true);
    } catch (e: any) {
      setUploadError(e?.response?.data?.detail ?? "Could not save team names");
    } finally {
      setSavingTeamNames(false);
    }
  }, [loadDemos, namingQueue, team1Name, team2Name]);

  const applyTeamNamesToBatch = useCallback(async () => {
    if (
      namingQueue.length < 2
      || (!applyTeam1ToBatch && !applyTeam2ToBatch)
    ) return;
    setSavingTeamNames(true);
    setUploadError(null);
    try {
      const result = await updateLocalDemoTeamNamesBatch(
        namingQueue.map((demo) => demo.demo_file),
        applyTeam1ToBatch ? team1Name : undefined,
        applyTeam2ToBatch ? team2Name : undefined,
      );
      const updated = new Set(result.updated);
      const remaining = namingQueue.filter((demo) => !updated.has(demo.demo_file));
      setNamingQueue(remaining);
      setTeam1Name(remaining[0]?.team1?.name ?? "");
      setTeam2Name(remaining[0]?.team2?.name ?? "");
      setApplyTeam1ToBatch(false);
      setApplyTeam2ToBatch(false);
      if (result.skipped.length) {
        setUploadError(result.skipped.map((item) => `${item.demo_file}: ${item.reason}`).join(" · "));
      }
      loadDemos(true);
    } catch (e: any) {
      setUploadError(e?.response?.data?.detail ?? "Could not apply names to this batch");
    } finally {
      setSavingTeamNames(false);
    }
  }, [
    applyTeam1ToBatch,
    applyTeam2ToBatch,
    loadDemos,
    namingQueue,
    team1Name,
    team2Name,
  ]);

  const handleDelete = useCallback(async (demoFile: string) => {
    setDeleting(demoFile);
    try {
      await deleteDemo(demoFile);
      loadDemos(true);
    } catch (e: any) {
      setError(e?.response?.data?.detail ?? "Delete failed");
    } finally {
      setDeleting(null);
    }
  }, [loadDemos]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const demFiles = files.filter((f) => f.name.toLowerCase().endsWith(".dem"));
    if (demFiles.length > 0) handleUpload(demFiles);
    else setUploadError("No .dem file found in drop");
  }, [handleUpload]);

  const grouped = useMemo(() => {
    const m = new Map<string, MatchDemoEntry[]>();
    for (const d of visibleDemos) {
      const keys = groupBy === "map" ? [d.map_name || "unknown"] : teamFilter ? [teamFilter] :
        Array.from(new Set([d.team1_name, d.team2_name].filter((n): n is string => !!n)));
      for (const key of keys.length ? keys : ["Unassigned teams"]) {
        const arr = m.get(key) ?? [];
        arr.push(d);
        m.set(key, arr);
      }
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [visibleDemos, groupBy, teamFilter]);

  return (
    <div className="relative h-screen flex flex-col overflow-hidden bg-[#0b1118]">
      <AppBackdrop tone="green" />
      <AppHeader />

      <div className="relative flex-1 min-h-0 overflow-y-auto px-4 md:px-6 pt-8 pb-12 space-y-6" style={{ scrollbarWidth: "thin" }}>

      <div ref={hero.ref} className={`reveal ${hero.shown ? "in" : ""} max-w-7xl mx-auto w-full`}>
        <span className="section-eyebrow" style={{ color: "#86efac" }}>REWATCH</span>
        <h1 className="page-title mt-3">
          Pick a demo to <span className="accent">rewatch</span>
        </h1>
        <p className="mt-3 text-sm text-scout-muted leading-relaxed max-w-2xl">
          Browse your library, upload a new .dem file, or link the folder to CS2
          so Replay buttons jump straight in.
        </p>
      </div>

      <div className="max-w-7xl mx-auto w-full space-y-4">

      {/* ── CS2 link status banner ── */}
      {linkInfo && (
        <div
          className={`hud-panel px-4 py-2 flex items-center gap-2 text-[11px] border-l-2 ${
            linkInfo.link_active
              ? "border-scout-green text-scout-green"
              : "border-scout-muted text-scout-muted"
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              linkInfo.link_active ? "bg-scout-green" : "bg-scout-red"
            }`}
          />
          {linkInfo.link_active ? (
            <span>
              Demos linked to CS2 at{" "}
              <span className="font-mono text-gray-300">
                game/csgo/{linkInfo.link_name}/
              </span>{" "}
              — Replay buttons use the correct path automatically.
            </span>
          ) : (
            <span>
              Demos not linked to CS2. Go to{" "}
              <span className="text-scout-accent">Settings</span> to enable
              one-click replay.
            </span>
          )}
        </div>
      )}

      {/* ── Upload zone ── */}
      {namingQueue[0]?.team1 && namingQueue[0].team2 ? (
        <div className="hud-panel p-4 space-y-3">
          <div>
            <p className="text-[11px] text-scout-accent font-semibold uppercase tracking-[0.12em]">Name the roster groups</p>
            <p className="mt-1 text-[10px] text-scout-muted/70">
              {namingQueue.length} demo{namingQueue.length === 1 ? "" : "s"} remaining. Names are tied to the displayed players, not T/CT sides, so they can be grouped in Anti-Strat.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[
              { team: namingQueue[0].team1, value: team1Name, setValue: setTeam1Name, applyToBatch: applyTeam1ToBatch, setApplyToBatch: setApplyTeam1ToBatch, label: "Roster A" },
              { team: namingQueue[0].team2, value: team2Name, setValue: setTeam2Name, applyToBatch: applyTeam2ToBatch, setApplyToBatch: setApplyTeam2ToBatch, label: "Roster B" },
            ].map(({ team, value, setValue, applyToBatch, setApplyToBatch, label }) => (
              <label key={label} className="block">
                <span className="block text-[10px] text-scout-muted uppercase tracking-[0.12em] font-semibold mb-1.5">{label}</span>
                <p className="h-8 text-[10px] text-gray-300 leading-4 overflow-hidden">{team.players.join(" · ")}</p>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  maxLength={80}
                  className="mt-2 w-full bg-scout-bg/70 border border-scout-border rounded px-3 py-2 text-xs text-white outline-none focus:border-scout-accent"
                />
                {namingQueue.length > 1 && (
                  <span className="mt-2 flex items-start gap-2 text-[10px] leading-4 text-scout-muted/80 normal-case tracking-normal font-normal">
                    <input
                      type="checkbox"
                      checked={applyToBatch}
                      onChange={(e) => setApplyToBatch(e.target.checked)}
                      className="mt-0.5 accent-scout-accent"
                    />
                    Apply this name to matching players across the batch
                  </span>
                )}
              </label>
            ))}
          </div>
          {namingQueue.length > 1 && (
            <p className="text-[10px] leading-4 text-scout-muted/70">
              Only checked rosters are renamed. Unchecked opponent rosters keep their own generated <span className="text-scout-muted">player&apos;s team</span> label.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={saveTeamNames}
              disabled={savingTeamNames || !team1Name.trim() || !team2Name.trim()}
              className="hud-btn text-[10px]"
            >
              {savingTeamNames ? "Saving…" : "Save this demo"}
            </button>
            {namingQueue.length > 1 && (
              <button
                onClick={applyTeamNamesToBatch}
                disabled={
                  savingTeamNames
                  || (!applyTeam1ToBatch && !applyTeam2ToBatch)
                  || (applyTeam1ToBatch && !team1Name.trim())
                  || (applyTeam2ToBatch && !team2Name.trim())
                }
                className="hud-btn-primary text-[10px]"
              >
                Apply selected roster{applyTeam1ToBatch && applyTeam2ToBatch ? "s" : ""} to {namingQueue.length} demos
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-[10px] text-scout-muted/70 px-1">
          Upload demos to expand your library. You can name their teams after upload.
        </p>
      )}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`hud-panel p-6 flex flex-col items-center justify-center gap-2 cursor-pointer transition-all border-2 border-dashed ${
          dragOver
            ? "border-scout-accent bg-scout-accent/10 shadow-[0_0_24px_rgba(94, 224, 194,0.2)]"
            : "border-scout-border/50 hover:border-scout-accent/50"
        } ${uploading ? "pointer-events-none opacity-70" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".dem"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleUpload(files);
            e.target.value = "";
          }}
        />

        {uploading ? (
          <>
            <p className="text-[12px] text-scout-accent font-mono">
              {uploadPct === 100 ? "Indexing" : "Uploading"} {uploadFile}…
            </p>
            <div className="w-full max-w-md h-2 rounded-full bg-scout-border/50 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-scout-accent to-scout-green transition-all duration-300"
                style={{ width: `${uploadPct}%` }}
              />
            </div>
            <p className="text-[10px] text-scout-muted font-mono">
              {uploadPct === 100 ? "Building roster and timeline…" : `${uploadPct}%`}
            </p>
          </>
        ) : (
          <>
            <div className="text-[24px] text-scout-accent/60">+</div>
            <p className="text-[12px] text-scout-muted">
              <span className="text-scout-accent">Click to browse</span> or drag
              & drop one or more .dem files here
            </p>
            <p className="text-[10px] text-scout-muted/60">
              Up to 20 CS2 demo files · max 2 GB each
            </p>
          </>
        )}
      </div>

      {uploadError && (
        <p className="text-[12px] text-scout-red border-l-2 border-scout-red/50 pl-2">
          {uploadError}
        </p>
      )}

      {error && (
        <p className="text-[12px] text-scout-red border-l-2 border-scout-red/50 pl-2">
          {error}
        </p>
      )}

      {!demos && !error && (
        <p className="text-[12px] text-scout-muted">Loading demos…</p>
      )}

      {demos && demos.length === 0 && !error && (
        <p className="text-[12px] text-scout-muted">
          No demos yet. Upload a .dem file above or run an HLTV ingest.
        </p>
      )}

      <div className="hud-panel p-4 flex flex-wrap gap-3 items-end">
        <label className="flex flex-col gap-1 text-xs text-scout-muted flex-1 min-w-[180px]">Search demos
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Team, map or filename…"
            className="bg-scout-bg border border-scout-border rounded-lg px-3 py-2 text-white" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-scout-muted">Team
          <SearchableSelect ariaLabel="Filter replay team" value={teamFilter} allValue="" onChange={setTeamFilter}
            options={[{value:"",label:"All teams"},...teams.map(t=>({value:t,label:t}))]} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-scout-muted">Map
          <SearchableSelect ariaLabel="Filter replay map" value={mapFilter} allValue="" onChange={setMapFilter} noun="Maps" placeholder="Search maps…"
            options={[{value:"",label:"All maps"},...maps.map(m=>({value:m,label:m}))]} />
        </label>
        <fieldset className="flex gap-1"><legend className="text-xs text-scout-muted mb-1">Group by</legend>
          {(["team", "map"] as const).map(g => <button key={g} aria-pressed={groupBy === g} onClick={() => setGroupBy(g)}
            className={`hud-tab ${groupBy === g ? "hud-tab-active" : "hud-tab-idle"}`}>{g === "team" ? "Team → Map" : "Map"}</button>)}
        </fieldset>
      </div>
      <div className="flex justify-between text-xs text-scout-muted">
        <span>{visibleDemos.length} of {demos?.length ?? 0} demos</span>
        {(teamFilter || mapFilter || search) && <button className="text-scout-accent" onClick={() => { setTeamFilter(""); setMapFilter(""); setSearch(""); }}>Reset filters</button>}
      </div>
      {groupBy === "team" && !teamFilter && <p className="text-xs text-scout-muted">Matches appear under both participating teams. Select a team to focus its library.</p>}
      {demos && !visibleDemos.length && !!demos.length && <p className="hud-panel p-6 text-sm text-scout-muted">No demos match these filters.</p>}
      {grouped.map(([group, list]) => {
        const subgroups = groupBy === "team" ? Array.from(new Set(list.map(d => d.map_name))).sort() : [group];
        return <section key={group} className="hud-panel overflow-hidden">
          <header className="px-4 py-3 flex items-center gap-3 border-b border-white/5">
            {groupBy === "map" && <img src={mapIconPath(group)} alt="" className="w-7 h-7 object-contain" onError={e => { e.currentTarget.style.visibility = "hidden"; }} />}
            <h3 className="font-semibold text-white text-sm flex-1">{group}</h3>
            <span className="text-xs text-scout-muted">{list.length} demos</span>
          </header>
          {subgroups.map(map => <div key={map}>
            {groupBy === "team" && <div className="px-4 py-2 flex items-center gap-2 text-xs text-scout-accent bg-white/[0.025]">
              <img src={mapIconPath(map)} alt="" className="w-5 h-5 object-contain" onError={e => { e.currentTarget.style.visibility = "hidden"; }} />{map}
            </div>}
            {list.filter(d => (d.map_name || "unknown") === map).map(d => <div key={d.demo_file} className="flex items-center gap-3 px-4 py-3 border-b border-white/5 last:border-0 hover:bg-white/[0.035]">
              <button onClick={() => navigate(`/replay/${encodeURIComponent(d.demo_file)}`)} className="flex-1 min-w-0 text-left group" title={`Open ${d.demo_file}`}>
                <p className="text-sm font-semibold text-white group-hover:text-scout-accent truncate">{d.team1_name && d.team2_name ? `${d.team1_name} vs ${d.team2_name}` : d.demo_file}</p>
                <p className="text-xs text-scout-muted truncate mt-1">{d.demo_file}</p>
              </button>
              <span className="hidden md:block text-xs text-scout-muted text-right whitespace-nowrap">{formatDate(d.mtime)}<br />{formatBytes(d.size_bytes)}</span>
              <button onClick={() => navigate(`/replay/${encodeURIComponent(d.demo_file)}`)} className="hud-btn-primary text-xs">Watch →</button>
              <button onClick={() => setEditingDemo(d.demo_file)} aria-label={`Edit teams for ${d.demo_file}`} className="hud-btn text-xs">Edit teams</button>
              <button onClick={() => handleDelete(d.demo_file)} disabled={deleting === d.demo_file} aria-label={`Delete ${d.demo_file}`} className="hud-btn text-scout-red text-xs">{deleting === d.demo_file ? "…" : "Delete"}</button>
            </div>)}
          </div>)}
        </section>;
      })}
      {editingDemo && <DemoTeamEditor demoFile={editingDemo} onClose={() => setEditingDemo(null)} onSaved={() => { setEditingDemo(null); loadDemos(true); }} />}
      </div>{/* /max-w-7xl content */}
      </div>{/* /scrollable */}
    </div>
  );
}
