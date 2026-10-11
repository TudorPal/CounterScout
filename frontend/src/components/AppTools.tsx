import {useState} from 'react';
import ImportActivityMenu from './ImportActivity';
import SettingsPanel from './SettingsPanel';

/** Shared controls: header on main pages, left navigation during replay. */
export default function AppTools() {
  const [open,setOpen]=useState(false);
  return <div className="flex items-center gap-2 shrink-0" aria-label="Application tools">
    <ImportActivityMenu/>
    <button className="app-tool-button" aria-label="Settings" title="Settings" onClick={()=>setOpen(true)}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9.67 4.14a2 2 0 0 1 3.86 0l.15.53a2 2 0 0 0 2.45 1.42l.54-.13a2 2 0 0 1 1.93 3.34l-.4.4a2 2 0 0 0 0 2.82l.4.4a2 2 0 0 1-1.93 3.34l-.54-.13a2 2 0 0 0-2.45 1.42l-.15.53a2 2 0 0 1-3.86 0l-.15-.53a2 2 0 0 0-2.45-1.42l-.54.13a2 2 0 0 1-1.93-3.34l.4-.4a2 2 0 0 0 0-2.82l-.4-.4a2 2 0 0 1 1.93-3.34l.54.13a2 2 0 0 0 2.45-1.42Z" transform="translate(.4 1)"/><circle cx="12" cy="12" r="3"/></svg>
    </button>
    {open && <SettingsPanel open onClose={()=>setOpen(false)}/>}
  </div>;
}
