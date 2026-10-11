import type {MatchDemoEntry} from '../api/client';
export const demoAddedDate = (demo: MatchDemoEntry) => demo.uploaded_at ?? demo.mtime;
export const compareDemoDates = (order: 'newest' | 'oldest') => (a: MatchDemoEntry, b: MatchDemoEntry) =>
  (demoAddedDate(a)-demoAddedDate(b))*(order==='newest'?-1:1) || a.demo_file.localeCompare(b.demo_file);
