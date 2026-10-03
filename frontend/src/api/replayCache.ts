import type { MatchTimeline } from "./client";

type Entry = { revision: string; timeline: MatchTimeline; saved_at: number; weight: number };
const memory = new Map<string, Entry>();
const pending = new Map<string, Promise<MatchTimeline>>();
const generations = new Map<string, number>();
const MAX_SAMPLES = 450_000;
let dbPromise: Promise<IDBDatabase | null> | undefined;

function database(): Promise<IDBDatabase | null> {
  if (!dbPromise) dbPromise = new Promise(resolve => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let req: IDBOpenDBRequest;
    // Stable on-disk ID: renaming it would discard existing replay caches.
    try { req = indexedDB.open("cs2-replays", 1); }
    catch { return resolve(null); }
    req.onupgradeneeded = () => req.result.createObjectStore("timelines").createIndex("saved_at", "saved_at");
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); dbPromise = undefined; };
      resolve(req.result);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

async function persisted(key: string): Promise<Entry | undefined> {
  const db = await database();
  if (!db) return undefined;
  return new Promise(resolve => {
    try {
      const tx = db.transaction("timelines"), req = tx.objectStore("timelines").get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch { resolve(undefined); }
  });
}

async function persist(key: string, entry?: Entry) {
  const db = await database();
  if (!db) return;
  // Cache failures (quota, private browsing) must never prevent replay.
  try {
    const tx = db.transaction("timelines", "readwrite"), store = tx.objectStore("timelines");
    if (entry) {
      store.put(entry, key);
      let kept = 0;
      store.index("saved_at").openCursor(null, "prev").onsuccess = event => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result;
        if (!cursor) return;
        if (++kept > 2) cursor.delete();
        cursor.continue();
      };
    } else store.delete(key);
    await new Promise<void>(resolve => { tx.oncomplete = () => resolve(); tx.onerror = () => resolve(); tx.onabort = () => resolve(); });
  } catch { /* optional disk cache */ }
}

function remember(key: string, entry: Entry) {
  memory.delete(key); memory.set(key, entry);
  let samples = Array.from(memory.values()).reduce((sum, item) => sum + item.weight, 0);
  for (const [oldKey, oldEntry] of memory) {
    if (memory.size <= 2 && (samples <= MAX_SAMPLES || memory.size === 1)) break;
    memory.delete(oldKey); samples -= oldEntry.weight;
  }
}

export async function invalidateReplay(key: string) {
  generations.set(key, (generations.get(key) ?? 0) + 1);
  memory.delete(key);
  await persist(key);
}

/** One small revision request precedes this; revisits reuse the actual object. */
export function cachedReplay(key: string, revision: string,
  load: () => Promise<{timeline: MatchTimeline; revision: string}>): Promise<MatchTimeline> {
  const hit = memory.get(key);
  if (hit?.revision === revision) { remember(key, hit); return Promise.resolve(hit.timeline); }
  const generation = generations.get(key) ?? 0, pendingKey = `${key}:${revision}:${generation}`;
  const existing = pending.get(pendingKey);
  if (existing) return existing;
  const promise = (async () => {
    let entry = await persisted(key);
    if (entry?.revision !== revision) {
      const result = await load();
      entry = { ...result, saved_at: Date.now(), weight: Object.values(result.timeline.positions).reduce((n, samples) => n + samples.length, 0) };
      if ((generations.get(key) ?? 0) === generation) void persist(key, entry);
    }
    if ((generations.get(key) ?? 0) === generation) remember(key, entry);
    return entry.timeline;
  })().finally(() => pending.delete(pendingKey));
  pending.set(pendingKey, promise);
  return promise;
}
