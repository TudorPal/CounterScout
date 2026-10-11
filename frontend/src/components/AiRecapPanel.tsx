import { useEffect, useRef, useState } from "react";
import { getMatchReplayInsights } from "../api/client";
import type { MatchInfoResponse } from "../api/client";
import TeamAiPanel from "./TeamAiPanel";
import SearchableSelect from "./SearchableSelect";

export default function AiRecapPanel({ demoFile, mapName, matchInfo }: { demoFile: string;mapName:string;matchInfo:MatchInfoResponse|null }) {
  const teams=[matchInfo?.team1?.name,matchInfo?.team2?.name].filter((n):n is string=>!!n);
  const [selectedTeam,setSelectedTeam]=useState('');
  const team=teams.includes(selectedTeam)?selectedTeam:teams[0] ?? '';
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const generate = async () => {
    setError(null);
    setLoading(true);
    try {
      const result = await getMatchReplayInsights(demoFile);
      if (mounted.current) setSummary(result.summary);
    } catch (e: any) {
      if (mounted.current) setError(e?.response?.data?.detail ?? "Could not generate the recap. Please try again.");
    } finally {
      if (mounted.current) setLoading(false);
    }
  };

  return (
    <section aria-label="AI Recap" className="h-full overflow-y-auto p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <SearchableSelect ariaLabel="AI analysis team" value={team} onChange={setSelectedTeam} allValue="" options={teams.map(name=>({value:name,label:name}))} placeholder="Select a team…"/>
        <TeamAiPanel request={{team_name:team,map_name:mapName,demo_files:[demoFile]}}/>
        <details className="hud-panel p-4 md:p-6"><summary className="text-sm text-scout-muted cursor-pointer">Match-wide narrative recap (all players)</summary>
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-semibold text-white">AI Recap</h1>
            <p className="text-sm text-scout-muted mt-1">A match-wide narrative, separate from live replay.</p>
          </div>
          <button onClick={generate} disabled={loading} className="hud-btn-primary text-sm">
            {loading ? "Generating…" : summary ? "Regenerate recap" : "Generate recap"}
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-scout-red border-l-2 border-scout-red/50 pl-3">{error}</p>}
        {loading && <p role="status" className="text-sm text-scout-muted">Generating the match recap. You can keep browsing the other demo views.</p>}
        {summary && <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{summary}</div>}
        {!summary && !loading && <p className="text-sm text-scout-muted">Select Generate recap to request AI analysis. Opening this tab does not make an AI request.</p>}
        </details>
      </div>
    </section>
  );
}
