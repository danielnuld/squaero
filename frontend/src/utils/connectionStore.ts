// Persistence adapter for saved connections. Definitions live client-side
// (the core has no conn.save); this pairs the pure serialize/parse helpers with
// localStorage, falling back to an in-memory store when the webview has no
// persistent storage so the app still works for the session. Passwords ARE
// persisted (plaintext) by maintainer decision, so reconnecting does not require
// re-typing them (see serializeConnections). localStorage only persists across
// restarts when the UI is served from a stable origin (see app/src/main.cc).

import {
  serializeConnections,
  parseConnections,
  type Connection,
} from "./connections";

const STORAGE_KEY = "quaero.connections";

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// In-memory fallback used when localStorage is unavailable or throws.
const memoryStore = (): KeyValueStore => {
  let value: string | null = null;
  return {
    getItem: () => value,
    setItem: (_k, v) => {
      value = v;
    },
  };
};

function resolveStore(): KeyValueStore {
  try {
    const ls = globalThis.localStorage;
    if (ls) {
      // Probe: some webviews expose localStorage but throw on access.
      const probe = "__quaero_probe__";
      ls.setItem(probe, "1");
      ls.removeItem(probe);
      return ls;
    }
  } catch {
    /* fall through to memory */
  }
  return memoryStore();
}

const store = resolveStore();

/** Loads saved connections (without secrets). Returns [] when none/corrupt. */
export function loadConnections(): Connection[] {
  try {
    return parseConnections(store.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Persists connections, stripping secrets. Silent on storage failure. */
export function saveConnections(list: Connection[]): void {
  try {
    store.setItem(STORAGE_KEY, serializeConnections(list));
  } catch {
    /* best-effort: a full/blocked store should not crash the UI */
  }
}
