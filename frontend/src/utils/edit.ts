// Data-editing over IPC (M7): deriving a table's primary key from a describe
// result, turning grid changes into row.insert/update/delete requests, and
// bracketing a batch of edits in a transaction. The request/param assembly and
// the primary-key/where derivation are pure and unit-tested; the thin async
// wrappers pair them with the transport. Contract: docs/IPC.md (row.*, tx.*).

import { call } from "./transport";
import { isError, type JsonRpcResponse } from "./ipc";
import { QueryError, type ResultColumn, type ResultSet } from "./query";

/** Identifies the table a result set was read from, for building DML. */
export interface EditTarget {
  table: string;
  db?: string;
  schema?: string;
}

/** Outcome of a row.* call: the generated SQL and, when applied, the row count. */
export interface RowResult {
  sql: string;
  rowsAffected?: number;
}

/**
 * Primary-key column names from a schema.describe result. That result has a
 * `name` column and a `pk` column whose cell is truthy ("1") for key columns;
 * anything not null/empty/"0" counts as part of the key. Returns [] when the
 * describe result lacks the columns (e.g. an engine that cannot report a PK).
 */
export function describePkColumns(describe: ResultSet): string[] {
  const nameIdx = describe.columns.findIndex((c) => c.name === "name");
  const pkIdx = describe.columns.findIndex((c) => c.name === "pk");
  if (nameIdx === -1 || pkIdx === -1) {
    return [];
  }
  const pk: string[] = [];
  for (const row of describe.rows) {
    const cell = row[pkIdx];
    const name = row[nameIdx];
    if (name != null && cell != null && cell !== "" && cell !== "0") {
      pk.push(name);
    }
  }
  return pk;
}

/**
 * Whether a table can be edited: it must have a primary key, so a single row can
 * be identified unambiguously. Tables without one are read-only (a deliberate
 * choice — never emit an UPDATE/DELETE that could match several rows).
 */
export function isEditable(describe: ResultSet): boolean {
  return describePkColumns(describe).length > 0;
}

/**
 * The WHERE map that identifies one result row by its primary key: {pkCol:
 * value} taken from the row's cells. Returns null when a PK column is missing
 * from the result's columns (the SELECT did not project it), so the caller can
 * refuse to edit rather than build an ambiguous statement.
 */
export function whereForRow(
  columns: ResultColumn[],
  row: (string | null)[],
  pk: string[],
): Record<string, string | null> | null {
  if (pk.length === 0) {
    return null;
  }
  const where: Record<string, string | null> = {};
  for (const col of pk) {
    const idx = columns.findIndex((c) => c.name === col);
    if (idx === -1) {
      return null;
    }
    where[col] = row[idx] ?? null;
  }
  return where;
}

/** Builds the params object for a row.* method, omitting undefined qualifiers. */
function baseParams(
  connId: string,
  target: EditTarget,
  preview: boolean,
): Record<string, unknown> {
  const params: Record<string, unknown> = { connId, table: target.table };
  if (target.db !== undefined) params.db = target.db;
  if (target.schema !== undefined) params.schema = target.schema;
  if (preview) params.preview = true;
  return params;
}

/** row.insert params: the new row's {column: value} map. */
export function insertParams(
  connId: string,
  target: EditTarget,
  values: Record<string, string | null>,
  preview = false,
): Record<string, unknown> {
  return { ...baseParams(connId, target, preview), values };
}

/** row.update params: assignments (`set`) and the primary-key `where`. */
export function updateParams(
  connId: string,
  target: EditTarget,
  set: Record<string, string | null>,
  where: Record<string, string | null>,
  preview = false,
): Record<string, unknown> {
  return { ...baseParams(connId, target, preview), set, where };
}

/** row.delete params: the primary-key `where`. */
export function deleteParams(
  connId: string,
  target: EditTarget,
  where: Record<string, string | null>,
  preview = false,
): Record<string, unknown> {
  return { ...baseParams(connId, target, preview), where };
}

/** Normalizes a row.* response into a RowResult, or throws QueryError. */
export function parseRowResult(res: JsonRpcResponse): RowResult {
  if (isError(res)) {
    throw new QueryError(res.error.message, res.error.code, res.error.data);
  }
  const r = (res.result ?? {}) as { sql?: unknown; rowsAffected?: unknown };
  const out: RowResult = { sql: typeof r.sql === "string" ? r.sql : "" };
  if (typeof r.rowsAffected === "number") {
    out.rowsAffected = r.rowsAffected;
  }
  return out;
}

// --- async wrappers -------------------------------------------------------

async function rowCall(
  method: "row.insert" | "row.update" | "row.delete",
  params: Record<string, unknown>,
): Promise<RowResult> {
  return parseRowResult(await call(method, params));
}

/** Insert a row (preview:true generates the SQL without executing it). */
export function rowInsert(
  connId: string,
  target: EditTarget,
  values: Record<string, string | null>,
  preview = false,
): Promise<RowResult> {
  return rowCall("row.insert", insertParams(connId, target, values, preview));
}

/** Update a row identified by its primary key. */
export function rowUpdate(
  connId: string,
  target: EditTarget,
  set: Record<string, string | null>,
  where: Record<string, string | null>,
  preview = false,
): Promise<RowResult> {
  return rowCall("row.update", updateParams(connId, target, set, where, preview));
}

/** Delete a row identified by its primary key. */
export function rowDelete(
  connId: string,
  target: EditTarget,
  where: Record<string, string | null>,
  preview = false,
): Promise<RowResult> {
  return rowCall("row.delete", deleteParams(connId, target, where, preview));
}

/** Begin a transaction on the connection (for a safe multi-edit session). */
export async function txBegin(connId: string): Promise<void> {
  await call("tx.begin", { connId });
}

/** Commit the open transaction. */
export async function txCommit(connId: string): Promise<void> {
  await call("tx.commit", { connId });
}

/** Roll back the open transaction, abandoning the pending edits. */
export async function txRollback(connId: string): Promise<void> {
  await call("tx.rollback", { connId });
}
