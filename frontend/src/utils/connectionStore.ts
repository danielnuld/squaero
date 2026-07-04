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
import { resolveStore } from "./kvStore";

const STORAGE_KEY = "quaero.connections";

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
