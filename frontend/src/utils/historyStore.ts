// Persistence adapter for the query history (issue #128). Mirrors
// connectionStore: pairs the pure helpers in history.ts with the shared kvStore
// (localStorage or in-memory fallback). The configurable size limit is persisted
// alongside the log.

import {
  serializeHistory,
  parseHistory,
  clampLimit,
  DEFAULT_HISTORY_LIMIT,
  type HistoryEntry,
} from "./history";
import { resolveStore } from "./kvStore";

const STORAGE_KEY = "quaero.history";
const LIMIT_KEY = "quaero.history.limit";

const store = resolveStore();

/** Loads stored history (newest first). Returns [] when none/corrupt. */
export function loadHistory(): HistoryEntry[] {
  try {
    return parseHistory(store.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Persists the history log. Silent on storage failure. */
export function saveHistory(list: HistoryEntry[]): void {
  try {
    store.setItem(STORAGE_KEY, serializeHistory(list));
  } catch {
    /* best-effort: a full/blocked store should not crash the UI */
  }
}

/** Loads the configured entry limit, clamped; default when unset/corrupt. */
export function loadHistoryLimit(): number {
  try {
    const raw = store.getItem(LIMIT_KEY);
    return raw === null ? DEFAULT_HISTORY_LIMIT : clampLimit(Number(raw));
  } catch {
    return DEFAULT_HISTORY_LIMIT;
  }
}

/** Persists the entry limit (clamped). */
export function saveHistoryLimit(n: number): void {
  try {
    store.setItem(LIMIT_KEY, String(clampLimit(n)));
  } catch {
    /* best-effort */
  }
}
