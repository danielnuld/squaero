// Persistence for SQL notebooks (issue #262). Mirrors snippetStore /
// connectionStore: pairs the pure helpers in notebook.ts with the shared kvStore
// (localStorage, or an in-memory fallback under an opaque origin / tests).

import { serializeNotebooks, parseNotebooks, type Notebook } from "./notebook";
import { resolveStore } from "./kvStore";

const STORAGE_KEY = "quaero.notebooks";

const store = resolveStore();

/** Loads saved notebooks. Returns [] when none/corrupt. */
export function loadNotebooks(): Notebook[] {
  try {
    return parseNotebooks(store.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Persists notebooks. Silent on storage failure. */
export function saveNotebooks(list: Notebook[]): void {
  try {
    store.setItem(STORAGE_KEY, serializeNotebooks(list));
  } catch {
    /* best-effort: a full/blocked store should not crash the UI */
  }
}
