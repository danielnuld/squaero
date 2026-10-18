// Persistence adapter for the user's shortcut overrides (issue #684). Pairs the
// pure helpers in shortcuts.ts with the shared kvStore, like settingsStore does
// for the preferences. One key holds the whole map.

import { parseOverrides, serializeOverrides, type ShortcutOverrides } from "./shortcuts";
import { resolveStore } from "./kvStore";

const STORAGE_KEY = "quaero.shortcuts";

const store = resolveStore();

/** Load the persisted overrides; a missing or corrupt blob is no overrides. */
export function loadShortcutOverrides(): ShortcutOverrides {
  try {
    return parseOverrides(store.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

/** Persist the overrides. Best-effort; a full/blocked store never crashes the UI. */
export function saveShortcutOverrides(o: ShortcutOverrides): void {
  try {
    store.setItem(STORAGE_KEY, serializeOverrides(o));
  } catch {
    /* best-effort */
  }
}
