// Pure per-engine SQL for the "slow queries" tool (issue #180): the queries the
// SERVER itself recorded as slowest, read via query.run over catalogs — no core
// change, same pattern as the server monitor (#148). MySQL/MariaDB expose
// performance_schema.events_statements_summary_by_digest; PostgreSQL exposes the
// pg_stat_statements extension. SQLite/Informix/MongoDB have no such catalog and
// are honestly unsupported. When the catalog exists but is disabled/not installed
// the listing SQL simply errors and the panel shows that honestly — we never fake
// a result. All pure and unit-tested.

import { engineFamily as family } from "./engineFamily";

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
}

// The column each order sorts by, per engine family.
const ORDER_COLUMN: Record<"mysql" | "postgres", Record<SlowOrder, string>> = {
  mysql: { avg: "AVG_TIMER_WAIT", total: "SUM_TIMER_WAIT", count: "COUNT_STAR" },
  postgres: { avg: "mean_exec_time", total: "total_exec_time", count: "calls" },
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
      };
    case "postgres":
      return {
        supported: true,
        queryColumn: "query",
        resetSql: "SELECT pg_stat_statements_reset()",
        reason: null,
      };
    default:
      return { supported: false, queryColumn: null, resetSql: null, reason: unsupportedReason(engine) };
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
  return null;
}

/** A short, human label for why the tool is unavailable on an engine. */
export function unsupportedReason(engine: string): string {
  const f = family(engine);
  if (f === "sqlite")
    return "SQLite no mantiene un catálogo de consultas lentas del servidor.";
  if (f === "informix")
    return "Informix no expone estadísticas de consultas lentas vía SQL estándar.";
  if (f === "mongodb")
    return "El listado de consultas lentas aún no está disponible para MongoDB.";
  return `Las consultas lentas del servidor no están disponibles para el motor "${engine || "desconocido"}".`;
}
