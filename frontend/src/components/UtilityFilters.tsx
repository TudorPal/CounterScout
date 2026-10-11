/** Shared multi-select utility controls for Replay and all tactical views. */
export const UTILITY_TYPES = ['smokegrenade','flashbang','hegrenade','molotov','decoy'] as const;
const OPTIONS = [
  ['smokegrenade','Smoke','#cbd5e1'],
  ['flashbang','Flash','#fde047'],
  ['hegrenade','HE','#f87171'],
  ['molotov','Molotov','#fb923c'],
  ['decoy','Decoy','#a78bfa'],
] as const;

export default function UtilityFilters({selected,onChange}:{selected:ReadonlySet<string>;onChange:(next:Set<string>)=>void}) {
  return <fieldset aria-label="Utility types" className="flex items-center gap-1.5 flex-wrap">
    <legend className="sr-only">Utility types</legend>
    <span className="text-[11px] text-scout-muted uppercase tracking-[0.12em] mr-1">Utility</span>
    {OPTIONS.map(([type,label,color])=>{
      const active=selected.has(type);
      return <button key={type} type="button" aria-pressed={active} onClick={()=>{
        const next=new Set(selected);if(active)next.delete(type);else next.add(type);onChange(next);
      }} className="px-2 py-0.5 rounded text-[11px] font-mono uppercase tracking-wide border transition-all"
        style={{borderColor:active?color:'transparent',background:active?`${color}20`:'transparent',color:active?color:'#9aaabd',opacity:active?1:.6}}>{label}</button>;
    })}
    {selected.size<UTILITY_TYPES.length && <button type="button" className="text-[11px] text-scout-accent ml-1" onClick={()=>onChange(new Set(UTILITY_TYPES))}>All</button>}
  </fieldset>;
}
