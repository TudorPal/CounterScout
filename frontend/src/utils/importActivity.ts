export interface ImportActivity {
  id: string; label: string; state: 'working' | 'done' | 'error';
  progress?: number; demo?: string; error?: string;
  startedAt?: number; updatedAt?: number; etaSeconds?: number; toastDismissed?: boolean;
}
let activities: ImportActivity[] = [];
const listeners = new Set<() => void>();
export const importSnapshot = () => activities;
export const subscribeImports = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function updateImport(activity: ImportActivity) {
  const previous=activities.find(item=>item.id===activity.id);
  if(previous && ['label','state','progress','demo','error'].every(key=>previous[key as keyof ImportActivity]===activity[key as keyof ImportActivity]))return;
  activities = [{...activity,startedAt:previous?.startedAt??activity.startedAt??Date.now(),updatedAt:activity.updatedAt??Date.now(),
    toastDismissed:activity.toastDismissed??(previous?.state==='working'&&activity.state!=='working'?false:previous?.toastDismissed??false)}, ...activities.filter(item => item.id !== activity.id)].sort((a,b)=>(b.updatedAt??0)-(a.updatedAt??0)).slice(0, 30);
  listeners.forEach(listener => listener());
}
export function dismissImport(id: string) {
  activities = activities.map(item=>item.id===id?{...item,toastDismissed:true}:item);
  listeners.forEach(listener => listener());
}
export function startUpload(label: string) {
  const id = `upload:${crypto.randomUUID()}`;
  const started=Date.now();
  updateImport({id, label: `Uploading ${label}`, state: 'working', progress: 0});
  return {
    progress(pct: number) { const elapsed=(Date.now()-started)/1000;updateImport({id, label: pct >= 100 ? `Analysing ${label}` : `Uploading ${label}`, state: 'working', ...(pct < 100 ? {progress: pct,...(elapsed>=3&&pct>0?{etaSeconds:Math.ceil(elapsed*(100-pct)/pct)}:{})} : {})}); },
    done(demo?: string, error?: string) { updateImport({id, label: error ? 'Some demos could not be imported' : `${label} ready`, state: error ? 'error' : 'done', demo, error}); },
    failed(error: unknown) { updateImport({id, label: `Import failed: ${label}`, state: 'error', error: error instanceof Error ? error.message : 'Please retry from Import.'}); },
  };
}
