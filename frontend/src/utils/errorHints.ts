// What the error panel can add to an engine's message (issue #691,
// EditorError): the engine's own code, when its message carries one, and a
// «¿Querías …?» for an unknown table or column with a close match in what the
// editor knows of the schema. Pure; nothing here is invented — no code when the
// message names none, no suggestion without a near-unique close name.

import { analyzeSql } from "./sqlScope";
import type { EditorSchema } from "./sqlEditor";

/**
 * True when the engine refused because something else holds a lock (audit
 * A-07): SQLite's "database is locked"/"busy", MySQL's lock wait timeout and
 * deadlock, PostgreSQL's "could not obtain lock"/lock timeout, SQL Server's
 * 1222, Informix's -244/-154 ISAM 107/113. Often a transaction left open in
 * another tab — which the panel then asks about.
 */
export function isLockError(message: string | null | undefined): boolean {
  return /database (?:table )?is locked|SQLITE_BUSY|database is busy|lock wait timeout|deadlock|could not obtain lock|lock timeout|lock request time out|ISAM -?1(?:07|13)\b/i.test(
    message ?? "",
  );
}

/**
 * The engine's error code as its message states it, or null. The core sends
 * the driver's text only (no code field, docs/IPC.md), so this reads what the
 * drivers put there: Informix's SQLCA ("SQLCODE -206, ISAM -111, SQLSTATE
 * 42000"), an ODBC diagnostic ("[42S02] …"), or MySQL's "1054 (42S22)".
 */
export function engineErrorCode(message: string | null | undefined): string | null {
  const m = message ?? "";
  const sqlca = /SQLCODE (-?\d+)(?:, ISAM (-?\d+))?, SQLSTATE (\w{5})/.exec(m);
  if (sqlca) {
    return [`SQLCODE ${sqlca[1]}`, sqlca[2] ? `ISAM ${sqlca[2]}` : null, `SQLSTATE ${sqlca[3]}`]
      .filter(Boolean)
      .join(" · ");
  }
  const mysql = /\b(\d{4}) \(([0-9A-Z]{5})\)/.exec(m);
  if (mysql) return `${mysql[1]} · SQLSTATE ${mysql[2]}`;
  const odbc = /\[([0-9A-Z]{5})\]/.exec(m);
  if (odbc) return `SQLSTATE ${odbc[1]}`;
  const state = /\bSQLSTATE[ =:]+([0-9A-Z]{5})\b/i.exec(m);
  return state ? `SQLSTATE ${state[1]}` : null;
}

export interface UnknownIdentifier {
  kind: "table" | "column";
  name: string;
}

// The wording of "no such table/column" across the engines Squaero drives.
const UNKNOWN: { kind: UnknownIdentifier["kind"]; re: RegExp }[] = [
  { kind: "column", re: /no such column: ([\w.$]+)/i }, // SQLite
  { kind: "table", re: /no such table: ([\w.$]+)/i },
  { kind: "column", re: /column "([^"]+)" (?:of relation "[^"]+" )?does not exist/i }, // PostgreSQL
  { kind: "table", re: /relation "([^"]+)" does not exist/i },
  { kind: "column", re: /Unknown column '([^']+)'/i }, // MySQL / MariaDB
  { kind: "table", re: /Table '([^']+)' doesn't exist/i },
  { kind: "column", re: /Invalid column name '([^']+)'/i }, // SQL Server
  { kind: "table", re: /Invalid object name '([^']+)'/i },
];

/** The table or column an error says does not exist, or null. */
export function unknownIdentifier(message: string | null | undefined): UnknownIdentifier | null {
  for (const { kind, re } of UNKNOWN) {
    const m = re.exec(message ?? "");
    if (m) {
      // "t.col" / "db.table": the last part is the name that was not found.
      const name = m[1].split(".").pop()!;
      return name ? { kind, name } : null;
    }
  }
  return null;
}

/** Edit distance (insert, delete, substitute), case-insensitive. */
export function editDistance(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/**
 * The one candidate close to `name`, or null. Close: within a third of the
 * name's length (at least 1, at most 3 edits), or the name inside it or it
 * inside the name ("telefono" ↔ "telefono_movil"). A tie between two equally
 * close names is no suggestion — guessing would be worse than saying nothing.
 */
export function closestName(name: string, candidates: readonly string[]): string | null {
  const lower = name.toLowerCase();
  const max = Math.min(3, Math.max(1, Math.floor(name.length / 3)));
  let best: string | null = null;
  let bestD = Infinity;
  let tie = false;
  for (const c of new Set(candidates)) {
    const cl = c.toLowerCase();
    if (cl === lower) return null; // it does exist: the schema is stale, not the name
    const d = editDistance(name, c);
    const contains = lower.length >= 4 && cl.length >= 4 && (cl.includes(lower) || lower.includes(cl));
    if (d > max && !contains) continue;
    const score = d > max ? max + 0.5 : d;
    if (score < bestD) {
      best = c;
      bestD = score;
      tie = false;
    } else if (score === bestD) {
      tie = true;
    }
  }
  return tie ? null : best;
}

export interface DidYouMean extends UnknownIdentifier {
  suggestion: string;
  /** For a column: the tables whose columns were searched. */
  tables?: string[];
}

/**
 * «¿Querías …?» for a failed statement: the unknown name the error reports and
 * its close match — among the columns of the tables the statement reads (the
 * editor diagnostics' own scope analysis), or among the known tables. Null when
 * the error is of another kind or nothing is close enough.
 */
export function didYouMean(
  message: string | null | undefined,
  sql: string,
  schema: EditorSchema,
  engine?: string,
): DidYouMean | null {
  const unknown = unknownIdentifier(message);
  if (!unknown) return null;
  if (unknown.kind === "table") {
    const suggestion = closestName(unknown.name, schema.tables);
    return suggestion ? { ...unknown, suggestion } : null;
  }
  const tables: string[] = [];
  const columns: string[] = [];
  for (const st of analyzeSql(sql, { schema, engine }).statements) {
    for (const scope of st.scopes) {
      for (const r of scope.relations) {
        if (r.kind !== "table" || !r.columns) continue;
        if (r.target && !tables.includes(r.target)) tables.push(r.target);
        columns.push(...r.columns);
      }
    }
  }
  const suggestion = closestName(unknown.name, columns);
  return suggestion ? { ...unknown, suggestion, tables } : null;
}
