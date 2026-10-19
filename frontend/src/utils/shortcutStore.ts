// Persistence adapter for the user's shortcut overrides (issue #684). Pairs the
// pure helpers in shortcuts.ts with the shared kvStore, like settingsStore does
// for the preferences. One key holds the whole map.

import {
  SHORTCUTS_VERSION,
  migrateOverrides,
  parseOverrides,
  serializeOverrides,
  type ShortcutOverrides,
} from "./shortcuts";
import { resolveStore } from "./kvStore";

const STORAGE_KEY = "quaero.shortcuts";
/** The defaults the stored map was written against; absent = version 1. */
const VERSION_KEY = "quaero.shortcuts.version";

const store = resolveStore();

/**
 * Load the persisted overrides; a missing or corrupt blob is no overrides. A
 * map written against older defaults is migrated (R-17) and saved back once.
 */
export function loadShortcutOverrides(): ShortcutOverrides {
  try {
    const raw = store.getItem(STORAGE_KEY);
    const from = Number(store.getItem(VERSION_KEY) ?? 1);
    const parsed = parseOverrides(raw);
    if (raw === null || from >= SHORTCUTS_VERSION) return parsed;
    const migrated = migrateOverrides(parsed, from);
    saveShortcutOverrides(migrated);
    return migrated;
  } catch {
    return {};
  }
}

/** Persist the overrides. Best-effort; a full/blocked store never crashes the UI. */
export function saveShortcutOverrides(o: ShortcutOverrides): void {
  try {
    store.setItem(STORAGE_KEY, serializeOverrides(o));
    store.setItem(VERSION_KEY, String(SHORTCUTS_VERSION));
  } catch {
    /* best-effort */
  }
}
