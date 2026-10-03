import {Fragment, useEffect, useId, useRef, useState} from "react";
import {createPortal} from "react-dom";
import type {SelectOption, SelectGroup} from "./Select";
import {popoverPosition} from "../utils/popoverPosition";

/** Editable, keyboard-accessible picker. Search previews can update a table
 * without committing the selection until an option is chosen. */
export default function SearchableSelect({value,options=[],groups,onChange,onSearch,ariaLabel,className="",allValue="all",placeholder="Search teams…",noun="Teams",clearable=true}: {
  value:string; options?:SelectOption[]; groups?:SelectGroup[]; onChange:(value:string)=>void;
  onSearch?:(query:string)=>void; ariaLabel:string; className?:string;
  allValue?:string; placeholder?:string; noun?:string;
  clearable?:boolean;
}) {
  const [open,setOpen]=useState(false), [query,setQuery]=useState(""), [cursor,setCursor]=useState(0);
  const [position,setPosition]=useState<{left:number;top:number;width:number;height:number}|null>(null);
  const root=useRef<HTMLDivElement>(null), popup=useRef<HTMLDivElement>(null), input=useRef<HTMLInputElement>(null);
  const choices = groups ? groups.flatMap(group=>group.options) : options;
  const sections = new Map(groups?.flatMap(group=>group.options.map(option=>[option.value,group.label] as const)));
  const id=useId(), selected=choices.find(option=>option.value===value);
  const filtered=choices.filter(option=>!option.disabled && option.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function close() {setOpen(false);setQuery("");onSearch?.("");}
  function choose(next:string) {onChange(next);close();}
  useEffect(()=>{
    if(!open) return;
    const locate=()=>{
      setPosition(popoverPosition(root.current!.getBoundingClientRect(),{width:window.innerWidth,height:window.innerHeight},320,250));
    };
    const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node) && !popup.current?.contains(event.target as Node)) close();};
    locate();document.addEventListener("pointerdown",outside);window.addEventListener("resize",locate);window.addEventListener("scroll",locate,true);
    return()=>{document.removeEventListener("pointerdown",outside);window.removeEventListener("resize",locate);window.removeEventListener("scroll",locate,true);};
  },[open]);
  useEffect(()=>{popup.current?.querySelector(`[data-index="${cursor}"]`)?.scrollIntoView({block:"nearest"});},[cursor]);
  return <div ref={root} className={`relative w-64 max-w-full ${className}`} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node) && !popup.current?.contains(event.relatedTarget as Node)) close();}}>
    <div className={`flex h-10 items-center rounded-lg border bg-scout-panel ${open?"border-scout-accent/60 ring-2 ring-scout-accent/10":"border-scout-border"}`}>
      {selected?.icon && !open ? <img src={selected.icon} alt="" className="w-4 h-4 ml-3 shrink-0"/> : <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="w-4 h-4 ml-3 shrink-0 text-scout-muted"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>}
      <input ref={input} role="combobox" aria-label={ariaLabel} aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={open && filtered[cursor]?`${id}-${cursor}`:undefined} autoComplete="off"
        className="bg-transparent text-xs text-white !outline-none flex-1 w-0 min-w-0 h-full px-2 placeholder:text-scout-muted"
        value={open?query:selected?.label || ""} placeholder={placeholder}
        onFocus={()=>{if(!open){setOpen(true);setQuery("");setCursor(0);}}}
        onClick={()=>{if(!open){setOpen(true);setQuery("");setCursor(0);}}}
        onChange={event=>{setQuery(event.target.value);setCursor(0);onSearch?.(event.target.value);setOpen(true);}}
        onKeyDown={event=>{
          if(event.key==="ArrowDown" || event.key==="ArrowUp") {event.preventDefault();setOpen(true);setCursor(current=>Math.max(0,Math.min(filtered.length-1,current+(event.key==="ArrowDown"?1:-1))));}
          if(event.key==="Enter" && open && filtered[cursor]) {event.preventDefault();choose(filtered[cursor].value);}
          if(event.key==="Escape") {event.preventDefault();close();}
          if(event.key==="Tab") close();
          if(event.key==="Home" && open) {event.preventDefault();setCursor(0);}
          if(event.key==="End" && open) {event.preventDefault();setCursor(Math.max(0,filtered.length-1));}
        }}/>
      {((clearable && value!==allValue) || query) && <button type="button" aria-label={`Clear ${ariaLabel}`} className="text-scout-muted hover:text-white h-full w-8 shrink-0 flex items-center justify-center" onMouseDown={event=>event.preventDefault()} onClick={()=>{choose(clearable?allValue:value);input.current?.focus();}}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="w-4 h-4"><path d="m6 6 12 12M18 6 6 18"/></svg></button>}
      <button type="button" aria-label={`Toggle ${ariaLabel}`} className="text-scout-muted hover:text-white h-full w-9 shrink-0 flex items-center justify-center" onMouseDown={event=>event.preventDefault()} onClick={()=>{if(open)close();else {input.current?.focus();setOpen(true);setQuery("");setCursor(0);}}}><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className={`w-4 h-4 transition-transform ${open?"rotate-180":""}`}><path d="m6 9 6 6 6-6"/></svg></button>
    </div>
    {open && position && createPortal(<div ref={popup} className="fixed z-[100] rounded-xl border border-white/10 bg-[#131e28] shadow-2xl overflow-hidden"
      style={{left:position.left,top:position.top,width:position.width}}>
      <div className="px-3 py-2 text-[10px] tracking-widest uppercase text-scout-muted border-b border-white/5">{noun} · {filtered.length} found</div>
      <div id={`${id}-list`} role="listbox" aria-label={ariaLabel} className="overflow-y-auto p-1.5" style={{maxHeight:Math.max(0,position.height-36)}}>
        {filtered.map((option,index)=><Fragment key={option.value}>
          {groups && sections.get(option.value)!==sections.get(filtered[index-1]?.value) && <p className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-scout-muted">{sections.get(option.value)}</p>}
          <div id={`${id}-${index}`} data-index={index} role="option" aria-selected={option.value===value}
          className={`flex justify-between items-center gap-3 rounded-lg px-3 py-2.5 text-xs cursor-pointer ${index===cursor?"bg-scout-accent/15 text-scout-accent":"text-white/85 hover:bg-white/5"}`}
          onMouseDown={event=>event.preventDefault()} onMouseMove={()=>setCursor(index)} onClick={()=>choose(option.value)}>
          <span className="flex items-center gap-2 min-w-0">{option.dot && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background:option.dot}}/>}{option.icon && <img src={option.icon} alt="" className="w-4 h-4 shrink-0"/>}<span className="truncate">{option.label}</span></span><span className="text-[10px] text-scout-muted shrink-0">{option.hint}{option.value===value?<span className="ml-2 text-scout-accent">✓</span>:null}</span>
        </div></Fragment>)}
        {!filtered.length && <p className="px-3 py-5 text-xs text-scout-muted">No matches for “{query}”.</p>}
      </div>
    </div>,document.body)}
  </div>;
}
