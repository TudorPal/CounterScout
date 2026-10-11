import { useEffect, useRef, useState } from "react";
import { getMatchReplayInsights } from "../api/client";
import type { MatchInfoResponse } from "../api/client";
import TeamAiPanel from "./TeamAiPanel";
import SearchableSelect from "./SearchableSelect";

const snapshotHeadings=['RESULT','KEY ROUNDS','STANDOUT PLAYERS','BOMB / UTILITY','CHECK NEXT'];
function MatchSnapshot({summary}:{summary:string}) {
  const sections:Array<{title:string;bullets:string[]}>=[];
  for(const raw of summary.split('\n')) {
    const line=raw.trim();
    if(snapshotHeadings.includes(line))sections.push({title:line,bullets:[]});
    else if(line && sections.length)sections[sections.length-1].bullets.push(line.replace(/^[-*]\s+/,''));
  }
  return <div className="grid gap-4 md:grid-cols-2 mt-4">{sections.map(s=><section key={s.title} className="rounded-lg border border-white/10 p-3"><h2 className="text-xs font-semibold tracking-wider text-scout-accent mb-2">{s.title}</h2><ul className="text-sm text-gray-200 list-disc pl-4 space-y-2">{s.bullets.map((text,i)=><li key={i}>{text}</li>)}</ul></section>)}</div>;
}

export default function AiRecapPanel({ demoFile, mapName, matchInfo }: { demoFile: string;mapName:string;matchInfo:MatchInfoResponse|null }) {
  const teams=[matchInfo?.team1?.name,matchInfo?.team2?.name].filter((n):n is string=>!!n);
  const [selectedTeam,setSelectedTeam]=useState('');
  const team=teams.includes(selectedTeam)?selectedTeam:teams[0] ?? '';
  const [summary, setSummary] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [allowSnapshot,setAllowSnapshot]=useState(false);
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
        <details className="hud-panel p-4 md:p-6"><summary className="text-sm text-scout-muted cursor-pointer">Match snapshot (all players)</summary>
        <div className="flex items-center justify-between gap-4 flex-wrap mt-4">
          <div>
            <h1 className="text-xl font-semibold text-white">Match snapshot</h1>
            <p className="text-sm text-scout-muted mt-1">Result, key rounds and standout players—quick bullet points, not an essay.</p>
          </div>
          <button onClick={generate} disabled={loading||!allowSnapshot} className="hud-btn-primary text-sm">
            {loading ? "Generating…" : summary ? "Load snapshot" : "Generate snapshot"}
          </button>
        </div>
        <label className="flex items-start gap-2 text-xs text-scout-muted mt-3"><input aria-label="Allow match snapshot evidence upload" type="checkbox" checked={allowSnapshot} onChange={e=>setAllowSnapshot(e.target.checked)} className="accent-scout-accent mt-0.5"/>Allow sending compact match facts and names from both teams to the configured AI provider. Raw demo files are not sent.</label>
        {error && <p role="alert" className="text-sm text-scout-red border-l-2 border-scout-red/50 pl-3">{error}</p>}
        {loading && <p role="status" className="text-sm text-scout-muted">Generating the match recap. You can keep browsing the other demo views.</p>}
        {summary && <MatchSnapshot summary={summary}/>}
        {!summary && !loading && <p className="text-sm text-scout-muted mt-3">Select Generate snapshot to request AI analysis. Opening this tab does not make an AI request.</p>}
        </details>
      </div>
    </section>
  );
}
