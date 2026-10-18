// Persistence adapter for the editor tabs' local history (issue #674). Mirrors
// historyStore/tabsStore: the pure helpers in localHistory.ts over the shared
// kvStore (localStorage or in-memory fallback).

import { parseLocalHistory, serializeLocalHistory, type TabHistory } from "./localHistory";
import { resolveStore } from "./kvStore";

const STORAGE_KEY = "quaero.localHistory";

const store = resolveStore();

/** Loads the stored local history. [] when none/corrupt. */
export function loadLocalHistory(): TabHistory[] {
  try {
    return parseLocalHistory(store.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/**
 * Persists the local history. Returns false when the store refused it (full or
 * blocked): unlike the other stores this one exists so work is not lost, so a
 * failed write is reported to the user rather than swallowed.
 */
export function saveLocalHistory(list: TabHistory[]): boolean {
  try {
    store.setItem(STORAGE_KEY, serializeLocalHistory(list));
    return true;
  } catch {
    return false;
  }
}
