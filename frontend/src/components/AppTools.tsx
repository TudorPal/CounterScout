import {useState} from 'react';
import ImportActivityMenu from './ImportActivity';
import SettingsPanel from './SettingsPanel';

/** Shared controls: header on main pages, left navigation during replay. */
export default function AppTools() {
  const [open,setOpen]=useState(false);
  return <div className="flex items-center gap-2 shrink-0" aria-label="Application tools">
    <ImportActivityMenu/>
    <button className="app-tool-button" aria-label="Settings" title="Settings" onClick={()=>setOpen(true)}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 2 3-1 1-3 3-1 2-3-2-2 1-3-3-2-3 1-2-2Z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
    {open && <SettingsPanel open onClose={()=>setOpen(false)}/>}
  </div>;
}
