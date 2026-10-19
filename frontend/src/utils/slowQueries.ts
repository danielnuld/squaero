// Pure per-engine SQL for the "slow queries" tool (issue #180): the queries the
// SERVER itself recorded as slowest, read via query.run over catalogs — no core
// change, same pattern as the server monitor (#148). MySQL/MariaDB expose
// performance_schema.events_statements_summary_by_digest; PostgreSQL exposes the
// pg_stat_statements extension. MongoDB has the database profiler: the
// operations it recorded in system.profile are grouped by collection, operation
// and query shape (#719); SQLite and Informix have no such catalog and are
// honestly unsupported. When the catalog exists but is disabled/not installed
// the listing SQL simply errors and the panel shows that honestly — we never fake
// a result. All pure and unit-tested.

import { engineFamily as family } from "./engineFamily";
import { mongoStatementFromProfile } from "./mongoStatements";
import { t } from "./i18n";

/** How to order the slowest-first listing. */
export type SlowOrder = "avg" | "total" | "count";

/** Default number of rows the listing returns. */
export const DEFAULT_SLOW_LIMIT = 50;

export interface SlowQuerySupport {
  supported: boolean;
  /** Result column holding the (normalized) statement text. */
  queryColumn: string | null;
  /** SQL that resets the server's accumulated stats, when available. */
  resetSql: string | null;
  /** Human reason when unsupported (null when supported). */
  reason: string | null;
  /** i18n key of a hint shown when the listing is empty (the catalog can be
      switched off and look "clean"), or null. */
  emptyHint: string | null;
  /** Turns a result row (lowercased column name -> cell) into the statement
      "Open" and EXPLAIN act on, when the query column is not that statement
      itself. Null when it is, or when no statement can be rebuilt. */
  statementOf: ((row: Record<string, string | null>) => string | null) | null;
}

// The column each order sorts by, per engine family.
const ORDER_COLUMN: Record<"mysql" | "postgres" | "mongodb", Record<SlowOrder, string>> = {
  mysql: { avg: "AVG_TIMER_WAIT", total: "SUM_TIMER_WAIT", count: "COUNT_STAR" },
  postgres: { avg: "mean_exec_time", total: "total_exec_time", count: "calls" },
  mongodb: { avg: "avg_ms", total: "total_ms", count: "ejecuciones" },
};

/** What the slow-queries tool can do for an engine. */
export function slowQuerySupport(engine: string): SlowQuerySupport {
  switch (family(engine)) {
    case "mysql":
      return {
        supported: true,
        queryColumn: "query",
        resetSql: "TRUNCATE performance_schema.events_statements_summary_by_digest",
        reason: null,
        emptyHint: null,
        statementOf: null,
      };
    case "postgres":
      return {
        supported: true,
        queryColumn: "query",
        resetSql: "SELECT pg_stat_statements_reset()",
        reason: null,
        emptyHint: null,
        statementOf: null,
      };
    case "mongodb":
      // The profiler cannot be cleared by one statement (system.profile only
      // drops once profiling is off), so there is no reset; it is switched on
      // with db.setProfilingLevel, which the empty-state hint says.
      return {
        supported: true,
        queryColumn: "query",
        resetSql: null,
        reason: null,
        emptyHint: "slow.emptyMongo",
        statementOf: (row) => (row.ns && row.query ? mongoStatementFromProfile(row.ns, row.query) : null),
      };
    default:
      return {
        supported: false,
        queryColumn: null,
        resetSql: null,
        reason: unsupportedReason(engine),
        emptyHint: null,
        statementOf: null,
      };
  }
}

/** Clamp the row limit into a sane range (positive, capped). */
function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SLOW_LIMIT;
  return Math.min(1000, Math.max(1, Math.floor(n)));
}

/**
 * Build the slowest-queries listing SQL for an engine, ordered as requested and
 * capped. Returns null for engines without a slow-query catalog. `order` is a
 * fixed enum (never user text) and `limit` is coerced to an int, so the built
 * SQL is injection-safe.
 */
export function buildSlowQuerySql(
  engine: string,
  order: SlowOrder,
  limit: number = DEFAULT_SLOW_LIMIT,
): string | null {
  const n = clampLimit(limit);
  const f = family(engine);
  if (f === "mysql") {
    const col = ORDER_COLUMN.mysql[order];
    // Timer waits are in picoseconds; /1e9 gives milliseconds.
    return (
      "SELECT DIGEST_TEXT AS query, COUNT_STAR AS ejecuciones, " +
      "ROUND(AVG_TIMER_WAIT/1e9, 2) AS avg_ms, " +
      "ROUND(SUM_TIMER_WAIT/1e9, 2) AS total_ms, " +
      "ROUND(MAX_TIMER_WAIT/1e9, 2) AS max_ms " +
      "FROM performance_schema.events_statements_summary_by_digest " +
      `WHERE DIGEST_TEXT IS NOT NULL ORDER BY ${col} DESC LIMIT ${n}`
    );
  }
  if (f === "postgres") {
    const col = ORDER_COLUMN.postgres[order];
    // pg_stat_statements reports times already in milliseconds. The *_exec_time
    // columns require PostgreSQL 13+ (renamed from mean_time/total_time); on
    // older servers this errors honestly rather than returning wrong data.
    return (
      "SELECT query, calls AS ejecuciones, " +
      "round(mean_exec_time::numeric, 2) AS avg_ms, " +
      "round(total_exec_time::numeric, 2) AS total_ms, " +
      "round(max_exec_time::numeric, 2) AS max_ms " +
      `FROM pg_stat_statements ORDER BY ${col} DESC LIMIT ${n}`
    );
  }
  if (f === "mongodb") {
    const col = ORDER_COLUMN.mongodb[order];
    // One row per collection, operation and query shape (queryHash, absent for
    // some operations, then they group by collection and operation). The sample
    // `query` is the slowest execution's command; times are milliseconds.
    const pipeline = [
      { $match: { ns: { $not: { $regex: "\\.system\\." } } } },
      { $sort: { millis: -1 } },
      {
        $group: {
          _id: { ns: "$ns", op: "$op", qh: "$queryHash" },
          query: { $first: "$command" },
          ejecuciones: { $sum: 1 },
          avg_ms: { $avg: "$millis" },
          total_ms: { $sum: "$millis" },
          max_ms: { $max: "$millis" },
        },
      },
      { $sort: { [col]: -1 } },
      { $limit: n },
      {
        $project: {
          _id: 0,
          ns: "$_id.ns",
          op: "$_id.op",
          query: 1,
          ejecuciones: 1,
          avg_ms: { $round: ["$avg_ms", 2] },
          total_ms: { $round: ["$total_ms", 2] },
          max_ms: 1,
        },
      },
    ];
    return `db.system.profile.aggregate(${JSON.stringify(pipeline)})`;
  }
  return null;
}

/** A short, human label for why the tool is unavailable on an engine. */
export function unsupportedReason(engine: string): string {
  const f = family(engine);
  if (f === "sqlite") return t("slow.unsupported.sqlite");
  if (f === "informix") return t("slow.unsupported.informix");
  return t("slow.unsupported.other", { engine: engine || t("engine.unknown") });
}

/** i18n key of the note that says where the numbers come from, or null. */
export function slowSourceKey(engine: string): string | null {
  const f = family(engine);
  return f === "mysql" || f === "postgres" || f === "mongodb" ? `slow.source.${f}` : null;
}

/** What the detail pane says about one listed statement. */
export interface SlowFacts {
  calls: string | null;
  avgMs: string | null;
  maxMs: string | null;
  totalMs: string | null;
  /** Its share (0–100, rounded) of the total time of the LISTED statements —
      not of everything the server recorded — or null when unknown. */
  share: number | null;
}

/**
 * The facts of row `r` of the listing, read from the columns every engine's
 * query names the same (ejecuciones, avg_ms, max_ms, total_ms). Pure.
 */
export function slowFacts(
  result: { columns: readonly { name: string }[]; rows: readonly (readonly (string | null)[])[] },
  r: number,
): SlowFacts | null {
  const row = result.rows[r];
  if (!row) return null;
  const idx = (n: string) => result.columns.findIndex((c) => c.name.toLowerCase() === n);
  const at = (n: string) => (idx(n) < 0 ? null : (row[idx(n)] ?? null));
  const ti = idx("total_ms");
  let share: number | null = null;
  if (ti >= 0) {
    const sum = result.rows.reduce((s, x) => s + (Number(x[ti]) || 0), 0);
    const mine = Number(row[ti]);
    if (sum > 0 && Number.isFinite(mine)) share = Math.round((mine / sum) * 100);
  }
  return { calls: at("ejecuciones"), avgMs: at("avg_ms"), maxMs: at("max_ms"), totalMs: at("total_ms"), share };
}
