/** Copy legacy settings/caches before components hydrate. Keep the originals
 * for rollback, never overwrite current settings, and tolerate storage denial. */
export function migrateBrandStorage(storage: Storage): void {
  try {
    const keys = Array.from({length: storage.length}, (_, i) => storage.key(i)).filter((key): key is string => key !== null);
    for (const key of keys) {
      const next = key.startsWith("cs2meta:") ? key.replace(/^cs2meta:/, "counterscout:") :
        key === "cs2-faceit-team-url" ? "counterscout-faceit-team-url" :
        key.startsWith("cs2-notes-") ? key.replace(/^cs2-notes-/, "counterscout-notes-") : null;
      if (next && storage.getItem(next) === null) {
        const value = storage.getItem(key);
        if (value !== null) storage.setItem(next, value);
      }
    }
  } catch { /* Quota / private-mode restrictions must not block app startup. */ }
}
