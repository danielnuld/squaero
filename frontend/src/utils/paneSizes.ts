// Sizes the user drags and expects to find again: the users panel's list column
// (issue #491) and the related-data dialog (issue #494). One kv entry holds them
// all, keyed by name, so remembering another pane is a string rather than another
// store. Sizes are pixels; a pane that has never been dragged has no entry and
// falls back to its CSS default.

import { resolveStore } from "./kvStore";

const STORAGE_KEY = "quaero.paneSizes";

/** Parses the stored map, dropping anything that is not a usable pixel size. */
export function parsePaneSizes(raw: string | null): Record<string, number> {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  const out: Record<string, number> = {};
  for (const [name, size] of Object.entries(data as Record<string, unknown>)) {
    if (typeof size === "number" && Number.isFinite(size) && size > 0) {
      out[name] = size;
    }
  }
  return out;
}

const store = resolveStore();

/** The remembered size for `name`, or `fallback` when there is none. */
export function paneSize(name: string, fallback: number): number {
  try {
    return parsePaneSizes(store.getItem(STORAGE_KEY))[name] ?? fallback;
  } catch {
    return fallback;
  }
}

/** Remembers `px` as the size of `name`. Best-effort, like every other pref. */
export function savePaneSize(name: string, px: number): void {
  if (!Number.isFinite(px) || px <= 0) return;
  try {
    const all = parsePaneSizes(store.getItem(STORAGE_KEY));
    all[name] = Math.round(px);
    store.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* best-effort: a full/blocked store should not crash the UI */
  }
}
