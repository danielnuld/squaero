// Local history of the editor tabs (issue #674): "never lose editor work".
//
// Every query tab gets automatic versions of its text — when it runs, every few
// minutes while it changes, when it is closed, and when an older version is
// restored over it — so text that was overwritten, deleted or closed can be
// found again. This is NOT the query history (history.ts): that one logs the
// statements that RAN; this one keeps what the editor HELD, run or not.
//
// Versions are keyed by tab id, which is stable across restarts (TabState.seq
// never hands an id out twice), so a tab's history survives the restart and a
// closed tab's history stays until retention drops it. Pure logic; persistence
// lives in localHistoryStore.ts and the panel in components/LocalHistoryPanel.tsx.

/** Why a version was taken. */
export type VersionReason = "run" | "auto" | "close" | "restore";

export interface TabVersion {
  /** Epoch ms. */
  ts: number;
  reason: VersionReason;
  sql: string;
}

/** One tab's versions, newest first. */
export interface TabHistory {
  tabId: number;
  /** The tab's title when its last version was taken. */
  title: string;
  versions: TabVersion[];
}

/** How much is kept (from settings): versions per tab, and days (0 = no age
    limit). `maxVersions` 0 turns the history off. */
export interface Retention {
  maxVersions: number;
  maxDays: number;
}

/** A single version larger than this (chars) is not kept — and the caller is
    told so; it is never cut down to fit. */
export const MAX_VERSION_CHARS = 100_000;
/** Ceiling on everything stored (chars): the store is the webview's
    localStorage, shared with the workspace and the query history. Past it the
    oldest versions, whatever their tab, go first. */
export const MAX_TOTAL_CHARS = 1_000_000;

/** How often the open tabs are snapshotted while they change. */
export const AUTO_SNAPSHOT_MS = 2 * 60_000;

const DAY_MS = 86_400_000;

export type RecordOutcome = "recorded" | "unchanged" | "blank" | "tooBig" | "disabled";

/**
 * Add a version of `tab`'s text, then apply retention. Nothing is added when
 * the history is off, the text is blank, it is identical to the tab's latest
 * version, or it is over MAX_VERSION_CHARS — `outcome` says which, so a version
 * too big to keep can be reported instead of silently missing. Immutable.
 */
export function recordVersion(
  list: TabHistory[],
  tab: { id: number; title: string; sql: string },
  reason: VersionReason,
  now: number,
  retention: Retention,
): { list: TabHistory[]; outcome: RecordOutcome } {
  if (retention.maxVersions <= 0) return { list, outcome: "disabled" };
  if (tab.sql.trim() === "") return { list, outcome: "blank" };
  if (tab.sql.length > MAX_VERSION_CHARS) return { list, outcome: "tooBig" };
  const own = list.find((h) => h.tabId === tab.id);
  if (own?.versions[0]?.sql === tab.sql) return { list, outcome: "unchanged" };

  const version: TabVersion = { ts: now, reason, sql: tab.sql };
  const entry: TabHistory = {
    tabId: tab.id,
    title: tab.title,
    versions: [version, ...(own?.versions ?? [])],
  };
  // The tab just touched goes first: the panel lists documents most recent first.
  const next = [entry, ...list.filter((h) => h !== own)];
  return { list: pruneHistory(next, retention, now), outcome: "recorded" };
}

/**
 * Apply retention: drop versions older than `maxDays` (when set), keep the
 * newest `maxVersions` of each tab, then drop the oldest versions anywhere until
 * the total fits `maxTotal`. A tab left with no versions is removed. Immutable.
 */
export function pruneHistory(
  list: TabHistory[],
  retention: Retention,
  now: number,
  maxTotal = MAX_TOTAL_CHARS,
): TabHistory[] {
  const keep = Math.max(0, Math.floor(retention.maxVersions));
  const cutoff = retention.maxDays > 0 ? now - retention.maxDays * DAY_MS : -Infinity;
  let out = list
    .map((h) => ({ ...h, versions: h.versions.filter((v) => v.ts >= cutoff).slice(0, keep) }))
    .filter((h) => h.versions.length > 0);

  let total = out.reduce((sum, h) => sum + h.versions.reduce((s, v) => s + v.sql.length, 0), 0);
  if (total <= maxTotal) return out;
  // Oldest first across every tab, dropped until what remains fits.
  const doomed = new Set<TabVersion>();
  const byAge = out.flatMap((h) => h.versions).sort((a, b) => a.ts - b.ts);
  for (const v of byAge) {
    if (total <= maxTotal) break;
    doomed.add(v);
    total -= v.sql.length;
  }
  out = out
    .map((h) => ({ ...h, versions: h.versions.filter((v) => !doomed.has(v)) }))
    .filter((h) => h.versions.length > 0);
  return out;
}

/** Serialize for storage. */
export function serializeLocalHistory(list: TabHistory[]): string {
  return JSON.stringify(list);
}

const REASONS: ReadonlySet<string> = new Set(["run", "auto", "close", "restore"]);

/** Parse stored history, dropping anything malformed. [] on garbage. */
export function parseLocalHistory(raw: string | null): TabHistory[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: TabHistory[] = [];
  for (const item of data) {
    const h = item as Partial<TabHistory>;
    if (
      typeof h?.tabId !== "number" ||
      !Number.isFinite(h.tabId) ||
      typeof h.title !== "string" ||
      !Array.isArray(h.versions) ||
      out.some((o) => o.tabId === h.tabId)
    ) {
      continue;
    }
    const versions = h.versions.filter(
      (v): v is TabVersion =>
        typeof v?.ts === "number" &&
        typeof v.sql === "string" &&
        typeof v.reason === "string" &&
        REASONS.has(v.reason),
    );
    if (versions.length > 0) {
      out.push({
        tabId: h.tabId,
        title: h.title,
        versions: versions.map((v) => ({ ts: v.ts, reason: v.reason, sql: v.sql })),
      });
    }
  }
  return out;
}
