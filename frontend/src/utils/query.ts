// Query execution against the core over IPC, plus the pure normalization of a
// `query.run` response into the neutral result-set model the grid consumes.
// The normalizer is pure and unit-tested; the thin `runQuery` wrapper just
// pairs it with the transport. Contract: docs/IPC.md (`query.run`).

import { call } from "./transport";
import { isError, type JsonRpcResponse } from "./ipc";

export interface ResultColumn {
  name: string;
  /** Neutral type name (int, float, bool, text, blob, date, time, timestamp, json, null). */
  type: string;
}

export interface ResultSet {
  columns: ResultColumn[];
  /** Each cell is the value's textual form, or null for a SQL NULL. */
  rows: (string | null)[][];
  /** True when more rows existed than were returned. */
  truncated: boolean;
  /** Affected-row count for non-SELECT statements. */
  rowsAffected: number;
}

/** Error carrying the JSON-RPC domain code so the UI can react to it. */
export class QueryError extends Error {
  code: number;
  data?: unknown;
  constructor(message: string, code: number, data?: unknown) {
    super(message);
    this.name = "QueryError";
    this.code = code;
    this.data = data;
  }
}

/**
 * Normalizes a JSON-RPC response into a ResultSet. Throws QueryError for an
 * error response. Missing/!malformed fields degrade to safe empties so a
 * non-SELECT statement (columns: []) renders cleanly.
 */
export function parseQueryResult(res: JsonRpcResponse): ResultSet {
  if (isError(res)) {
    throw new QueryError(res.error.message, res.error.code, res.error.data);
  }
  const r = (res.result ?? {}) as Partial<ResultSet>;
  return {
    columns: Array.isArray(r.columns) ? r.columns : [],
    rows: Array.isArray(r.rows) ? r.rows : [],
    truncated: Boolean(r.truncated),
    rowsAffected: typeof r.rowsAffected === "number" ? r.rowsAffected : 0,
  };
}

/**
 * Runs SQL on an open connection and resolves with the normalized result set.
 * `offset` (>= 0) skips that many leading rows for offset pagination (issue #134);
 * with `truncated` signalling a further page exists.
 */
export async function runQuery(
  connId: string,
  sql: string,
  limit?: number,
  offset?: number,
): Promise<ResultSet> {
  const params: Record<string, unknown> = { connId, sql };
  if (limit !== undefined) {
    params.limit = limit;
  }
  if (offset !== undefined && offset > 0) {
    params.offset = offset;
  }
  const res = await call("query.run", params);
  return parseQueryResult(res);
}

/**
 * Runs a script — several statements — in order over one connection, one
 * `query.run` per statement: engines take a single statement per call, so a
 * whole script sent as one string fails (MySQL rejects `PREPARE …; EXECUTE …;`
 * with a syntax error) or runs only its first statement. Resolves with the last
 * result set that returned columns (else the last statement's), carrying the
 * affected rows summed over the whole script. Rejects on the first statement
 * that fails, leaving the ones before it already applied.
 */
export async function runScript(
  connId: string,
  stmts: string[],
  limit?: number,
): Promise<ResultSet> {
  let last: ResultSet | undefined;
  let withRows: ResultSet | undefined;
  let rowsAffected = 0;
  for (const sql of stmts) {
    // eslint-disable-next-line no-await-in-loop -- statements run in order
    last = await runQuery(connId, sql, limit);
    rowsAffected += last.rowsAffected;
    if (last.columns.length > 0) withRows = last;
  }
  const shown = withRows ?? last;
  return {
    columns: shown?.columns ?? [],
    rows: shown?.rows ?? [],
    truncated: shown?.truncated ?? false,
    rowsAffected,
  };
}
