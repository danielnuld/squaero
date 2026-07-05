// Query history model (issue #128): a client-side log of executed queries so the
// user can search and re-run them. Pure logic — recording, dedup, purge, search
// and (de)serialization; persistence lives in historyStore.ts and the panel in
// components/HistoryPanel.tsx. Entries are keyed by the *saved* connection id
// (stable across restarts) rather than the ephemeral core connId.

export interface HistoryEntry {
  /** The SQL that was executed (already trimmed). */
  sql: string;
  /** Epoch milliseconds of the run. */
  ts: number;
  /** Saved-connection id it ran against, or "" when none was resolved. */
  connId: string;
  /** Connection display name at run time, for the panel. */
  connName: string;
  /** Wall-clock duration of the run in ms (issue #179), when measured. */
  durationMs?: number;
}

/** Default cap on stored entries; the oldest are purged past this. */
export const DEFAULT_HISTORY_LIMIT = 200;
/** Bounds the user-configurable limit so a bad value can't disable or bloat it. */
export const MIN_HISTORY_LIMIT = 10;
export const MAX_HISTORY_LIMIT = 5000;

/** Clamp a (possibly user-entered) limit into the supported range. */
export function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_HISTORY_LIMIT;
  return Math.min(MAX_HISTORY_LIMIT, Math.max(MIN_HISTORY_LIMIT, Math.floor(n)));
}

/**
 * Prepend a run to the history (newest first), collapsing an immediate repeat
 * (same sql + same connection as the current newest entry) into a timestamp
 * refresh so re-running or refreshing doesn't flood the log, then purge to
 * `limit`. Returns a new array; the input is not mutated. A blank sql is ignored.
 */
export function addHistory(
  list: HistoryEntry[],
  entry: HistoryEntry,
  limit: number = DEFAULT_HISTORY_LIMIT,
): HistoryEntry[] {
  const sql = entry.sql.trim();
  if (!sql) return list;
  const normalized: HistoryEntry = { ...entry, sql };
  const cap = clampLimit(limit);
  const head = list[0];
  const rest =
    head && head.sql === normalized.sql && head.connId === normalized.connId
      ? list.slice(1)
      : list;
  return [normalized, ...rest].slice(0, cap);
}

/**
 * Case-insensitive substring search over the SQL text, newest-first order
 * preserved. An optional `connId` restricts results to one connection. A blank
 * query returns everything (optionally filtered by connection).
 */
export function searchHistory(
  list: HistoryEntry[],
  query: string,
  connId?: string,
): HistoryEntry[] {
  const q = query.trim().toLowerCase();
  return list.filter(
    (e) =>
      (connId === undefined || e.connId === connId) &&
      (q === "" || e.sql.toLowerCase().includes(q)),
  );
}

/** Serialize for storage. */
export function serializeHistory(list: HistoryEntry[]): string {
  return JSON.stringify(list);
}

/** Parse stored history, dropping malformed entries. Returns [] on garbage. */
export function parseHistory(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: HistoryEntry[] = [];
  for (const item of data) {
    const e = item as Partial<HistoryEntry>;
    if (
      typeof e?.sql === "string" &&
      typeof e?.ts === "number" &&
      typeof e?.connId === "string" &&
      typeof e?.connName === "string"
    ) {
      const entry: HistoryEntry = { sql: e.sql, ts: e.ts, connId: e.connId, connName: e.connName };
      if (typeof e.durationMs === "number" && Number.isFinite(e.durationMs)) {
        entry.durationMs = e.durationMs;
      }
      out.push(entry);
    }
  }
  return out;
}
