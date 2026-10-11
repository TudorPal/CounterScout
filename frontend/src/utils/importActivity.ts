export interface ImportActivity {
  id: string; label: string; state: 'working' | 'done' | 'error';
  progress?: number; demo?: string; error?: string;
}
let activities: ImportActivity[] = [];
const listeners = new Set<() => void>();
export const importSnapshot = () => activities;
export const subscribeImports = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function updateImport(activity: ImportActivity) {
  activities = [activity, ...activities.filter(item => item.id !== activity.id)].slice(0, 30);
  listeners.forEach(listener => listener());
}
export function dismissImport(id: string) {
  activities = activities.filter(item => item.id !== id);
  listeners.forEach(listener => listener());
}
export function startUpload(label: string) {
  const id = `upload:${crypto.randomUUID()}`;
  updateImport({id, label: `Uploading ${label}`, state: 'working', progress: 0});
  return {
    progress(pct: number) { updateImport({id, label: pct >= 100 ? `Analysing ${label}` : `Uploading ${label}`, state: 'working', ...(pct < 100 ? {progress: pct} : {})}); },
    done(demo?: string, error?: string) { updateImport({id, label: error ? 'Some demos could not be imported' : `${label} ready`, state: error ? 'error' : 'done', demo, error}); },
    failed(error: unknown) { updateImport({id, label: `Import failed: ${label}`, state: 'error', error: error instanceof Error ? error.message : 'Please retry from Import.'}); },
  };
}
