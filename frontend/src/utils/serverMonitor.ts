// Pure per-engine SQL for the server monitor / process list (issue #148). The
// panel lists the server's active sessions/queries and, where the engine allows,
// kills one — all client-side via query.run, no core change. Each engine differs:
// MySQL/MariaDB expose SHOW PROCESSLIST + KILL <id>; PostgreSQL exposes
// pg_stat_activity + pg_terminate_backend(pid); MongoDB exposes db.currentOp() +
// db.killOp(opid) (the driver runs both, #719). SQLite (no server) and Informix
// (kill is an admin CLI, not SQL) are honestly "not supported" here. Without the
// privileges the server answers "not authorized" and the panel shows that as is.
// All pure and unit-tested; the component just runs the SQL these return.

import { engineFamily as family } from "./engineFamily";
import { mongoKillSql } from "./mongoStatements";
import { t } from "./i18n";
import type { ResultSet } from "./query";
import { buildViewIndices } from "./gridView";

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
    case "mongodb":
      // The running (non-idle) operations of every user; `{$ownOps: true}` would
      // limit them to the caller's, which needs no special privilege.
      return { supported: true, listSql: "db.currentOp()", idColumn: "opid", canKill: true };
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
  if (family(engine) === "mongodb") return mongoKillSql(id);
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
  if (f === "sqlite") return t("monitor.unsupported.sqlite");
  if (f === "informix") return t("monitor.unsupported.informix");
  return t("monitor.unsupported.other", { engine: engine || t("engine.unknown") });
}

/** Longest value a session fact shows; a long query is cut, the SQL box below
    the dialog is not where it is read. */
const FACT_MAX = 160;

/**
 * What the kill confirmation says about the session (audit P1): every column of
 * its row that has a value — user, host, database, state, time, the running
 * query — as the engine named them, long values cut. Pure.
 */
export function sessionFacts(
  columns: readonly { name: string }[],
  row: readonly (string | null)[],
): { name: string; value: string }[] {
  return columns.flatMap((c, i) => {
    const v = row[i];
    if (v === null || v === undefined || v.trim() === "") return [];
    const one = v.replace(/\s+/g, " ").trim();
    return [{ name: c.name, value: one.length > FACT_MAX ? `${one.slice(0, FACT_MAX)}…` : one }];
  });
}

/* ---------- The monitor's view of the session list (P6): what each row is,
   which ones the toolbar hides, the KPI cards and the auto refresh. ---------- */


/** What a session is doing, as far as the engine's own list says. */
export type SessionState = "active" | "idle" | "idleInTx" | "waiting";

const col = (columns: readonly { name: string }[], ...names: string[]) =>
  columns.findIndex((c) => names.some((n) => c.name.toLowerCase() === n.toLowerCase()));

/**
 * Classify one row of the session list. PostgreSQL says it in `state` and
 * `wait_event_type`; MySQL in `Command` (Sleep) and `State` (… lock …); MongoDB's
 * currentOp in `active` and `waitingForLock`. Null when the row does not say.
 */
export function sessionState(
  engine: string,
  columns: readonly { name: string }[],
  row: readonly (string | null)[],
): SessionState | null {
  const at = (...names: string[]) => {
    const i = col(columns, ...names);
    return i < 0 ? null : (row[i] ?? null);
  };
  switch (family(engine)) {
    case "postgres": {
      const state = at("state");
      if (state === null) return null;
      if (at("wait_event_type") === "Lock") return "waiting";
      if (state === "idle") return "idle";
      if (state.startsWith("idle in transaction")) return "idleInTx";
      return "active";
    }
    case "mysql": {
      const command = at("Command");
      if (command === null) return null;
      if (/lock/i.test(at("State") ?? "")) return "waiting";
      return command === "Sleep" ? "idle" : "active";
    }
    case "mongodb": {
      if (at("waitingForLock") === "true") return "waiting";
      const active = at("active");
      if (active === null) return null;
      return active === "false" ? "idle" : "active";
    }
    default:
      return null;
  }
}

/** The text of the statement a session runs (or last ran), when the list has it. */
export function sessionQuery(
  columns: readonly { name: string }[],
  row: readonly (string | null)[],
): string | null {
  // Exact names: MySQL's `Command` is the kind of statement, not its text.
  const name = ["query", "Info", "command"].find((n) => columns.some((c) => c.name === n));
  const v = name === undefined ? null : row[columns.findIndex((c) => c.name === name)];
  return v && v.trim() !== "" ? v : null;
}

/** The numbers on the monitor's cards, counted from the list itself. */
export interface MonitorKpis {
  total: number;
  active: number;
  idle: number;
  waiting: number;
}

/** Count the sessions per state. Rows whose state is unknown count as total only. */
export function monitorKpis(engine: string, result: ResultSet | null): MonitorKpis {
  const k: MonitorKpis = { total: 0, active: 0, idle: 0, waiting: 0 };
  for (const row of result?.rows ?? []) {
    k.total++;
    const s = sessionState(engine, result!.columns, row);
    if (s === "active") k.active++;
    else if (s === "idle" || s === "idleInTx") k.idle++;
    else if (s === "waiting") k.waiting++;
  }
  return k;
}

/** The toolbar's view options. */
export interface SessionView {
  /** Case-insensitive text matched against every cell (user, base, query…). */
  text: string;
  /** Hide sessions that sit idle. An idle session INSIDE a transaction stays:
      it holds locks, which is exactly what the monitor is for. */
  hideIdle: boolean;
  /** The column the list is sorted by, owned here so a refresh keeps it. */
  sort: { column: string; dir: "ASC" | "DESC" } | null;
}

/** The rows the grid shows: filtered, then sorted. Pure. */
export function viewSessions(engine: string, result: ResultSet | null, view: SessionView): ResultSet | null {
  if (!result) return null;
  const q = view.text.trim().toLowerCase();
  let rows = result.rows.filter((row) => {
    if (view.hideIdle && sessionState(engine, result.columns, row) === "idle") return false;
    return q === "" || row.some((v) => v !== null && v.toLowerCase().includes(q));
  });
  const ci = view.sort ? col(result.columns, view.sort.column) : -1;
  if (ci >= 0) {
    const order = buildViewIndices(rows, result.columns, { col: ci, dir: view.sort!.dir === "ASC" ? "asc" : "desc" }, {});
    rows = order.map((i) => rows[i]);
  }
  return { ...result, rows };
}

/** Next sort when a header is clicked: ascending, descending, then none. */
export function nextSessionSort(
  current: SessionView["sort"],
  column: string,
): SessionView["sort"] {
  if (!current || current.column !== column) return { column, dir: "ASC" };
  return current.dir === "ASC" ? { column, dir: "DESC" } : null;
}

/** How often the monitor re-reads the list while «Cada 5 s» is on. */
export const AUTO_REFRESH_MS = 5000;

/**
 * Whether an auto-refresh tick should read the list now: only when it is on,
 * nothing is loading, no dialog is asking about a session (its facts would
 * shift behind it) and the window is visible (a hidden window does not need
 * the server's attention).
 */
export function shouldAutoRefresh(s: { auto: boolean; loading: boolean; asking: boolean; hidden: boolean }): boolean {
  return s.auto && !s.loading && !s.asking && !s.hidden;
}

/**
 * The statement that cancels the query a session runs, keeping the session:
 * pg_cancel_backend / KILL QUERY. Null when the engine has no such thing (on
 * MongoDB killOp already is the operation) or the id is not numeric.
 */
export function buildCancelSql(engine: string, id: string): string | null {
  const n = id.trim();
  if (!/^\d+$/.test(n)) return null;
  switch (family(engine)) {
    case "mysql":
      return `KILL QUERY ${n}`;
    case "postgres":
      return `SELECT pg_cancel_backend(${n})`;
    default:
      return null;
  }
}
