// Persistence adapter for favorites / snippets (issue #129). Mirrors
// connectionStore / historyStore: pairs the pure helpers in snippets.ts with the
// shared kvStore (localStorage or in-memory fallback).

import { serializeSnippets, parseSnippets, type Snippet } from "./snippets";
import { resolveStore } from "./kvStore";

const STORAGE_KEY = "quaero.snippets";

const store = resolveStore();

/** Loads saved snippets. Returns [] when none/corrupt. */
export function loadSnippets(): Snippet[] {
  try {
    return parseSnippets(store.getItem(STORAGE_KEY));
  } catch {
    return [];
  }
}

/** Persists snippets. Silent on storage failure. */
export function saveSnippets(list: Snippet[]): void {
  try {
    store.setItem(STORAGE_KEY, serializeSnippets(list));
  } catch {
    /* best-effort: a full/blocked store should not crash the UI */
  }
}
