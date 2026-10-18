// Data-editing over IPC (M7): deriving a table's primary key from a describe
// result, turning grid changes into row.insert/update/delete requests, and
// bracketing a batch of edits in a transaction. The request/param assembly and
// the primary-key/where derivation are pure and unit-tested; the thin async
// wrappers pair them with the transport. Contract: docs/IPC.md (row.*, tx.*).

import { call } from "./transport";
import { engineFamily } from "./engineFamily";
import { IPC_ERR_UNSUPPORTED, isError, type JsonRpcResponse } from "./ipc";
import { QueryError, type ResultColumn, type ResultSet } from "./query";
import type { PlanItem } from "./editSession";

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

/** All column names from a schema.describe result (its `name` column), in order.
 *  Used to feed the editor's autocomplete as tables are opened. */
export function describeColumnNames(describe: ResultSet): string[] {
  const nameIdx = describe.columns.findIndex((c) => c.name === "name");
  if (nameIdx === -1) return [];
  return describe.rows
    .map((r) => r[nameIdx])
    .filter((v): v is string => v != null && v !== "");
}

/**
 * Declared type per column name from a schema.describe result (issue #347). The
 * filter panel needs it to quote a value the way its column expects: `= 235`
 * against an integer, `= '235'` against text. Columns the describe reports
 * without a type are left out rather than guessed at.
 */
export function describeColumnTypes(describe: ResultSet): Record<string, string> {
  const nameIdx = describe.columns.findIndex((c) => c.name === "name");
  const typeIdx = describe.columns.findIndex((c) => c.name === "type");
  if (nameIdx === -1 || typeIdx === -1) return {};
  const out: Record<string, string> = {};
  for (const row of describe.rows) {
    const name = row[nameIdx];
    const type = row[typeIdx];
    if (name != null && name !== "" && type != null && type !== "") out[name] = type;
  }
  return out;
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

/**
 * Whether a row.* call touched the rows it should have (#577): by primary key,
 * exactly one. MySQL and MariaDB count rows CHANGED, not matched, so an UPDATE
 * that writes the value already there (1.50 over 1.5) reports 0 and is fine. A
 * driver that does not report the count cannot be checked and is taken as is.
 */
export function rowCountOk(engine: string, kind: "update" | "delete" | "insert", rowsAffected?: number): boolean {
  if (rowsAffected === undefined || rowsAffected === null) return true;
  if (rowsAffected === 1) return true;
  const family = engineFamily(engine);
  return rowsAffected === 0 && kind === "update" && family === "mysql";
}

/**
 * Builds the params object for a row.* method, omitting undefined qualifiers.
 * row.* reads only `schema` (docs/IPC.md), so a target named by its database
 * alone — a MySQL `db.table`, an Informix `db:table`, an attached SQLite
 * database — sends it there, the same `schema ?? db` rule schema.describe
 * follows. Without it the edit hit the session's current database instead of
 * the one the rows were read from (issue #718).
 */
function baseParams(
  connId: string,
  target: EditTarget,
  preview: boolean,
): Record<string, unknown> {
  const params: Record<string, unknown> = { connId, table: target.table };
  if (target.db !== undefined) params.db = target.db;
  const schema = target.schema ?? target.db;
  if (schema !== undefined) params.schema = schema;
  if (preview) params.preview = true;
  return params;
}

/** row.insert params: the new row's {column: value} map, plus per-column neutral
    types (`setTypes`) so the driver can emit numeric columns unquoted. */
export function insertParams(
  connId: string,
  target: EditTarget,
  values: Record<string, string | null>,
  preview = false,
  setTypes?: Record<string, string>,
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...baseParams(connId, target, preview), values };
  if (setTypes) params.setTypes = setTypes;
  return params;
}

/** row.update params: assignments (`set`), the primary-key `where`, and the set
    columns' neutral types (`setTypes`) so numeric columns are emitted unquoted. */
export function updateParams(
  connId: string,
  target: EditTarget,
  set: Record<string, string | null>,
  where: Record<string, string | null>,
  preview = false,
  setTypes?: Record<string, string>,
): Record<string, unknown> {
  const params: Record<string, unknown> = { ...baseParams(connId, target, preview), set, where };
  if (setTypes) params.setTypes = setTypes;
  return params;
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
  setTypes?: Record<string, string>,
): Promise<RowResult> {
  return rowCall("row.insert", insertParams(connId, target, values, preview, setTypes));
}

/** Update a row identified by its primary key. */
export function rowUpdate(
  connId: string,
  target: EditTarget,
  set: Record<string, string | null>,
  where: Record<string, string | null>,
  preview = false,
  setTypes?: Record<string, string>,
): Promise<RowResult> {
  return rowCall("row.update", updateParams(connId, target, set, where, preview, setTypes));
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

/**
 * Apply (or preview) one PlanItem via the matching row.* wrapper. Shared by the
 * edit session, data-diff sync and any other batch of row operations.
 */
export function runPlanItem(
  connId: string,
  target: EditTarget,
  item: PlanItem,
  preview = false,
): Promise<RowResult> {
  if (item.kind === "update") {
    return rowUpdate(connId, target, item.set, item.where, preview, item.setTypes);
  }
  if (item.kind === "delete") {
    return rowDelete(connId, target, item.where, preview);
  }
  return rowInsert(connId, target, item.values, preview, item.setTypes);
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

// An edit session wraps its changes in a transaction, but not every engine has
// one: a MongoDB server that is not a replica set or a sharded cluster has no
// multi-document transactions (the driver refuses tx.begin on it, naming why), and
// tx.begin answers "unsupported". Such a connection edits without one: each change is
// applied the moment it runs, and there is nothing to commit or roll back. The
// set remembers which connections answered that way.
const withoutTransactions = new Set<string>();

/** Whether the connection's engine has transactions (assumed until tx.begin says no). */
export function hasTransactions(connId: string): boolean {
  return !withoutTransactions.has(connId);
}

/**
 * tx.begin for an edit session. Resolves true when a transaction is open, false
 * when the engine has none (the session then applies changes directly).
 */
export async function txBeginIfSupported(connId: string): Promise<boolean> {
  const res = await call("tx.begin", { connId });
  if (isError(res) && res.error.code === IPC_ERR_UNSUPPORTED) {
    withoutTransactions.add(connId);
    return false;
  }
  withoutTransactions.delete(connId);
  return true;
}

/** tx.commit, or nothing when the session has no transaction. */
export async function txCommitIfOpen(connId: string): Promise<void> {
  if (hasTransactions(connId)) await txCommit(connId);
}

/** tx.rollback, or nothing when the session has no transaction. */
export async function txRollbackIfOpen(connId: string): Promise<void> {
  if (hasTransactions(connId)) await txRollback(connId);
}
