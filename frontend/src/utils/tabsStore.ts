// Persistence adapter for the open workspace (issue #401). Mirrors
// connectionStore / historyStore / snippetStore: pairs the pure helpers in
// tabs.ts with the shared kvStore (localStorage or in-memory fallback).
//
// Saving is debounced by the caller, not on close: "the PC was switched off" is
// the case this exists for, and that gives no chance to run anything on the way
// out.

import { serializeWorkspace, parseWorkspace, type TabState } from "./tabs";
import { resolveStore } from "./kvStore";

const STORAGE_KEY = "quaero.workspace";

const store = resolveStore();

/** Loads the stored workspace, or null when there is none/it is unusable. */
export function loadWorkspace(): TabState | null {
  try {
    return parseWorkspace(store.getItem(STORAGE_KEY));
  } catch {
    return null;
  }
}

/** Persists the workspace. Silent on storage failure. */
export function saveWorkspace(state: TabState): void {
  try {
    store.setItem(STORAGE_KEY, serializeWorkspace(state));
  } catch {
    /* best-effort: a full/blocked store should not crash the UI */
  }
}
