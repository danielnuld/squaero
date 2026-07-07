// Schema introspection over IPC, plus the pure parsing of schema.tree result
// sets into typed tree rows. The IPC wrappers pair the transport with the
// shared result normalizer; the parsing helpers are pure and unit-tested.
// Contract: docs/IPC.md (schema.tree / schema.describe / schema.ddl).

import { call } from "./transport";
import { parseQueryResult, type ResultSet } from "./query";
import { engineFamily } from "./engineFamily";

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

/**
 * Quote a SQL identifier for a generated statement, per engine: MySQL/MariaDB
 * use backticks (doubled to escape), Informix uses none, every other engine the
 * ANSI double quote (doubled). `engine` is the driver name; omitted defaults to
 * ANSI double quotes. MySQL treats "..." as a string literal, so the quote char
 * matters; Informix has no delimited identifiers unless DELIMIDENT is set — a
 * "quoted" name is parsed as a string literal and errors — so it stays bare.
 */
export function quoteIdentifier(id: string, engine?: string): string {
  const e = (engine ?? "").toLowerCase();
  if (e === "mysql" || e === "mariadb") {
    return "`" + id.replace(/`/g, "``") + "`";
  }
  if (e === "informix") {
    return id;
  }
  return `"${id.replace(/"/g, '""')}"`;
}

/**
 * Build a qualified object reference for a generated statement, per engine.
 * Most engines dot-join the (quoted) parts: `db.schema.name`. Informix instead
 * separates the database with a COLON and dot-joins the rest — `db:owner.name` —
 * and its identifiers are bare (see quoteIdentifier); a dotted `db.owner.name`
 * or any quoting is a syntax error there. Absent parts are dropped, so a bare
 * `name` (or `owner.name`) comes out correctly when no database is given.
 */
export function qualifiedName(
  parts: { db?: string; schema?: string; name: string },
  engine?: string,
): string {
  const q = (s: string) => quoteIdentifier(s, engine);
  if (engineFamily(engine ?? "") === "informix") {
    // Informix: `database:table`, bare, and WITHOUT the owner. The name is
    // unambiguous within a database, and an owner-qualified reference stalls on
    // some servers (an owner-qualified cross-database catalog lookup can block),
    // so the owner is dropped rather than emitted.
    return parts.db ? `${q(parts.db)}:${q(parts.name)}` : q(parts.name);
  }
  return [parts.db, parts.schema, parts.name]
    .filter((p): p is string => !!p)
    .map(q)
    .join(".");
}
