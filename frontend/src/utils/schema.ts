// Schema introspection over IPC, plus the pure parsing of schema.tree result
// sets into typed tree rows. The IPC wrappers pair the transport with the
// shared result normalizer; the parsing helpers are pure and unit-tested.
// Contract: docs/IPC.md (schema.tree / schema.describe / schema.ddl).

import { call } from "./transport";
import { parseQueryResult, type ResultSet } from "./query";

/** Kind of an object-tree node, used for icons and expansion behavior. */
export type NodeKind = "database" | "schema" | "table" | "view";

/** A child returned by one schema.tree level. */
export interface TreeRow {
  name: string;
  kind: NodeKind;
}

/**
 * Interprets a schema.tree result set into typed rows. The core decides whether
 * a container's children are schemas or tables, so the level is auto-detected:
 * a `type` column ("table"/"view") means a table listing; otherwise the rows
 * are containers and take `fallback` ("database" or "schema") as their kind. A
 * `name` column is required; rows without one are skipped.
 */
export function parseTreeRows(
  result: ResultSet,
  fallback: "database" | "schema",
): TreeRow[] {
  const nameIdx = result.columns.findIndex((c) => c.name === "name");
  if (nameIdx === -1) {
    return [];
  }
  const typeIdx = result.columns.findIndex((c) => c.name === "type");
  const rows: TreeRow[] = [];
  for (const row of result.rows) {
    const name = row[nameIdx];
    if (name === null || name === undefined) {
      continue;
    }
    const kind: NodeKind =
      typeIdx !== -1 ? (row[typeIdx] === "view" ? "view" : "table") : fallback;
    rows.push({ name, kind });
  }
  return rows;
}

/** schema.tree: list one lazy level. db/schema select the container. */
export async function schemaTree(
  connId: string,
  db?: string,
  schema?: string,
): Promise<ResultSet> {
  const params: Record<string, unknown> = { connId };
  if (db !== undefined) params.db = db;
  if (schema !== undefined) params.schema = schema;
  return parseQueryResult(await call("schema.tree", params));
}

/** schema.describe: a table's column structure. `db`/`schema` name the
   container so non-default databases/schemas can be described. */
export async function schemaDescribe(
  connId: string,
  table: string,
  db?: string,
  schema?: string,
): Promise<ResultSet> {
  const params: Record<string, unknown> = { connId, table };
  if (db !== undefined) params.db = db;
  if (schema !== undefined) params.schema = schema;
  return parseQueryResult(await call("schema.describe", params));
}

/** schema.ddl: the CREATE statement of an object (one-column "sql" result). */
export async function schemaDdl(
  connId: string,
  object: string,
  db?: string,
  schema?: string,
): Promise<string> {
  const params: Record<string, unknown> = { connId, object };
  if (db !== undefined) params.db = db;
  if (schema !== undefined) params.schema = schema;
  const res = parseQueryResult(await call("schema.ddl", params));
  // One column ("sql"), one row; empty when the object is unknown.
  if (res.rows.length === 0) {
    return "";
  }
  return res.rows[0][0] ?? "";
}

/** Quotes a SQL identifier for a generated SELECT (double quotes, doubled). */
export function quoteIdentifier(id: string): string {
  return `"${id.replace(/"/g, '""')}"`;
}
