// Shared key/value storage adapter. The webview persists client-side state
// (saved connections, query history, prefs) in localStorage, but some webviews
// expose it yet throw on access, so callers get a probed real store or an
// in-memory fallback that keeps the app working for the session. localStorage
// only persists across restarts when the UI is served from a stable origin
// (see app/src/main.cc).

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

// In-memory fallback used when localStorage is unavailable or throws. Keyed so a
// single shared instance serves every caller independently.
function memoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
  };
}

let cached: KeyValueStore | null = null;

/** Returns the persistent localStorage when usable, else an in-memory store. */
export function resolveStore(): KeyValueStore {
  if (cached) return cached;
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      // Probe: some webviews expose localStorage but throw on access.
      const probe = "__quaero_probe__";
      ls.setItem(probe, "1");
      ls.removeItem(probe);
      cached = ls;
      return cached;
    }
  } catch {
    /* fall through to memory */
  }
  cached = memoryStore();
  return cached;
}
