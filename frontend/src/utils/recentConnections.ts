// When each saved connection was last opened (issue #694), for the welcome
// screen's «Recientes». Kept apart from the connection definitions: it is usage,
// not configuration, so exporting connections never carries it. Pure helpers
// plus a best-effort load/save over the shared key/value store.

import type { KeyValueStore } from "./kvStore";

/** Connection id → epoch ms of its last successful open. */
export type UsageMap = Record<string, number>;

export const USAGE_KEY = "quaero.connections.used";
export const RECENT_MAX = 6;

/** Records that `id` was opened at `at`. Returns a new map. */
export function touchConnection(used: UsageMap, id: string, at: number): UsageMap {
  return { ...used, [id]: at };
}

/**
 * The connections to offer, most recently used first; never-used ones follow
 * in their saved order, so a fresh install still lists what it has. Ids in the
 * map that no longer exist are ignored. Capped at `max`.
 */
export function recentConnections<C extends { id: string }>(
  saved: readonly C[],
  used: UsageMap,
  max: number = RECENT_MAX,
): { conn: C; at: number | null }[] {
  return saved
    .map((conn, i) => ({ conn, at: used[conn.id] ?? null, i }))
    .sort((a, b) => (b.at ?? -1) - (a.at ?? -1) || a.i - b.i)
    .slice(0, Math.max(0, max))
    .map(({ conn, at }) => ({ conn, at }));
}

export function parseUsage(raw: string | null): UsageMap {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    const out: UsageMap = {};
    for (const [k, v] of Object.entries(data)) if (Number.isFinite(v)) out[k] = v as number;
    return out;
  } catch {
    return {};
  }
}

export function loadUsage(store: Pick<KeyValueStore, "getItem">): UsageMap {
  try {
    return parseUsage(store.getItem(USAGE_KEY));
  } catch {
    return {};
  }
}

/** Saves only the ids still saved, so a deleted connection leaves no trace. */
export function saveUsage(
  store: Pick<KeyValueStore, "setItem">,
  used: UsageMap,
  savedIds: readonly string[],
): void {
  const kept: UsageMap = {};
  for (const id of savedIds) if (used[id] !== undefined) kept[id] = used[id];
  try {
    store.setItem(USAGE_KEY, JSON.stringify(kept));
  } catch {
    /* best-effort */
  }
}
