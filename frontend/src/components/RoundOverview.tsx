import { useEffect, useMemo, useRef } from "react";
import type { MatchIdentity } from "../utils/replayState";
import type { MatchTimeline } from "../api/client";
import { economyAt, money, roundAnchor, roundResult, sideColor, teamSide } from "../utils/replayState";

export default function RoundOverview({timeline, identity, selected, onSelect, markers}: {
  timeline: MatchTimeline; identity: MatchIdentity; selected: number; onSelect: (round: number) => void;
  markers?: Record<number, string[]>;
}) {
  const facts = useMemo(() => timeline.rounds.map(r => ({round:r, ...roundResult(timeline, r),
    side:teamSide(timeline, identity, 2, roundAnchor(r)), economy:economyAt(timeline, roundAnchor(r))})), [timeline, identity]);
  const half = facts.find(f => f.side !== facts[0]?.side)?.round.num ?? 13;
  const regulation = (half - 1) * 2;
  const groups = new Map<string, typeof facts>();
  for (const f of facts) {
    const n = f.round.num;
    const phase = n < half ? "First half" : n <= regulation ? "Second half" : `OT ${Math.floor((n - regulation - 1) / 6) + 1} · ${(n - regulation - 1) % 6 < 3 ? "A" : "B"}`;
    const group = groups.get(phase) ?? []; group.push(f); groups.set(phase, group);
  }
  const strip = useRef<HTMLDivElement>(null);
  useEffect(() => { strip.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({block:"nearest",inline:"nearest"}); }, [selected]);
  return <nav aria-label="Round selection" className="hud-panel px-3 py-2 shrink-0 mx-2 mt-1" style={{containerType:"inline-size"}}>
    <div ref={strip} tabIndex={0} aria-label="Round results; scroll for overtime" className="flex overflow-x-auto pb-1" style={{scrollbarWidth:"thin"}}>
      {Array.from(groups).map(([phase,list],index) => <section key={phase} className={`shrink-0 ${index ? "border-l border-scout-border ml-3 pl-3" : ""}`}>
        <p className="text-[9px] uppercase tracking-wider text-scout-muted mb-1">{phase}</p>
        <div className="flex gap-0.5">
          {list.map(f => <button key={f.round.num} aria-label={`Round ${f.round.num}`} aria-pressed={selected === f.round.num} onClick={() => onSelect(f.round.num)}
            title={`R${f.round.num} · ${f.round.winner ?? "tied"} · survivors T ${f.tAlive}, CT ${f.ctAlive}\nBuy-phase cash T ${money(f.economy[2].known ? f.economy[2].cash : null)}, CT ${money(f.economy[3].known ? f.economy[3].cash : null)}\n${markers?.[f.round.num]?.join(" · ") ?? ""}`}
            style={{width:`clamp(44px, calc((100cqw - 88px) / ${Math.min(24,Math.max(1,facts.length))}), 64px)`}}
            className={`h-[76px] shrink-0 rounded-md border flex flex-col items-center justify-center gap-1 ${selected === f.round.num ? "border-scout-accent bg-scout-accent/15 text-white" : "border-transparent text-scout-muted hover:bg-white/5"}`}>
            <span className="text-sm font-mono font-bold">{f.round.num}{!!markers?.[f.round.num]?.length && <span className="text-yellow-400 text-[8px]"> •</span>}</span>
            {[2,3].map(side => <div key={side} className="flex gap-[2px]" aria-label={`${side === 2 ? "T" : "CT"} survivors ${side === 2 ? f.tAlive : f.ctAlive}`}>
              {Array.from({length:5},(_,i) => <span key={i} className="w-[5px] h-2.5 rounded-sm" style={{background:i < (side === 2 ? f.tAlive : f.ctAlive) ? sideColor(side) : "#374151"}} />)}
            </div>)}
            <span className="w-6 h-0.5 rounded" style={{background:f.round.winner ? sideColor(f.round.winner === "T" ? 2 : 3) : "#555"}} />
            <img src={f.defused ? "/icons/defuser.svg" : f.exploded ? "/icons/c4.svg" : "/icons/killfeed/icon_suicide.svg"} alt={f.defused ? "Defused" : f.exploded ? "Exploded" : "Elimination"} className="w-3 h-3" style={{filter:f.exploded ? "invert(32%) sepia(100%) saturate(6000%)" : "brightness(0) invert(.8)"}} />
          </button>)}
        </div>
      </section>)}
    </div>
  </nav>;
}
