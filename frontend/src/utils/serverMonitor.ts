// Pure per-engine SQL for the server monitor / process list (issue #148). The
// panel lists the server's active sessions/queries and, where the engine allows,
// kills one — all client-side via query.run, no core change. Each engine differs:
// MySQL/MariaDB expose SHOW PROCESSLIST + KILL <id>; PostgreSQL exposes
// pg_stat_activity + pg_terminate_backend(pid). SQLite (no server), Informix
// (kill is an admin CLI, not SQL) and MongoDB are honestly "not supported" here.
// All pure and unit-tested; the component just runs the SQL these return.

import { engineFamily as family } from "./engineFamily";

/** What the monitor can do for a given engine. */
export interface MonitorSupport {
  /** True when a process list can be queried at all. */
  supported: boolean;
  /** SQL that returns the active-session list (null when unsupported). */
  listSql: string | null;
  /** Result column holding the session/process id, for the kill action. */
  idColumn: string | null;
  /** True when a session can be killed via SQL on this engine. */
  canKill: boolean;
}

const PG_LIST =
  "SELECT pid, usename AS user, datname AS db, client_addr, state, " +
  "wait_event_type, query, backend_start FROM pg_stat_activity " +
  "ORDER BY backend_start";

/** The monitor capabilities for an engine. */
export function monitorFor(engine: string): MonitorSupport {
  switch (family(engine)) {
    case "mysql":
      return { supported: true, listSql: "SHOW FULL PROCESSLIST", idColumn: "Id", canKill: true };
    case "postgres":
      return { supported: true, listSql: PG_LIST, idColumn: "pid", canKill: true };
    default:
      return { supported: false, listSql: null, idColumn: null, canKill: false };
  }
}

/**
 * Build the statement that kills the session with `id`, or null when the engine
 * cannot kill via SQL or the id is not a plain integer (guards the concatenation
 * against injection — process ids are always numeric).
 */
export function buildKillSql(engine: string, id: string): string | null {
  if (!/^\d+$/.test(id.trim())) return null;
  const n = id.trim();
  switch (family(engine)) {
    case "mysql":
      return `KILL ${n}`;
    case "postgres":
      return `SELECT pg_terminate_backend(${n})`;
    default:
      return null;
  }
}

/** A short, human label for why the monitor is unavailable on an engine. */
export function unsupportedReason(engine: string): string {
  const f = family(engine);
  if (f === "sqlite") return "SQLite es una base de datos embebida: no tiene procesos de servidor.";
  if (f === "informix") return "Informix administra sesiones por CLI (onmode), no por SQL.";
  if (f === "mongodb") return "El monitor de procesos aún no está disponible para MongoDB.";
  return `El monitor de procesos no está disponible para el motor "${engine || "desconocido"}".`;
}
