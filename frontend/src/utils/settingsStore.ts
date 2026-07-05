// Persistence adapter for user preferences (issue #181). Pairs the pure helpers
// in settings.ts with the shared kvStore (localStorage or in-memory fallback),
// mirroring connectionStore/historyStore. One key holds the whole blob.

import { parseSettings, serializeSettings, type Settings } from "./settings";
import { resolveStore } from "./kvStore";

const STORAGE_KEY = "quaero.settings";

const store = resolveStore();

/** Load persisted settings, filled with defaults; never throws. */
export function loadSettings(): Settings {
  try {
    return parseSettings(store.getItem(STORAGE_KEY));
  } catch {
    return parseSettings(null);
  }
}

/** Persist settings. Best-effort; a full/blocked store never crashes the UI. */
export function saveSettings(s: Settings): void {
  try {
    store.setItem(STORAGE_KEY, serializeSettings(s));
  } catch {
    /* best-effort */
  }
}
