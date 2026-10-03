import type { MatchTimeline } from "../api/client";
import { useMemo } from "react";
import { economyAt, money, sideColor } from "../utils/replayState";

export default function ReplayEconomy({timeline,tick,label}: {timeline:MatchTimeline;tick:number;label:string}) {
  const sides = useMemo(() => economyAt(timeline,tick), [timeline,tick]);
  return <div className="flex flex-wrap gap-3 text-[10px] px-2 py-1.5 border-b border-white/5">
    <span className="text-scout-muted">{label}</span>
    {([2,3] as const).map(side => <span key={side} style={{color:sideColor(side)}} title={sides[side].players.map(p => `${p.name}: cash ${money(p.cash)}, equipment ${money(p.equipment)}`).join("\n")}>
      {side === 2 ? "T" : "CT"} cash {money(sides[side].known ? sides[side].cash : null)} <span className="text-scout-muted">· equip {money(sides[side].equipment)}</span>
    </span>)}
  </div>;
}
