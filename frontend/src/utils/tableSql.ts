// Statements the object tree writes for a table (audit A-17): «Nueva consulta
// sobre X», «Generar SQL ▸» and «Vaciar tabla…». They open in an editor tab and
// run only when the user runs them — except TRUNCATE, which goes through its own
// confirmation. Values are `:columna` variables (sqlVariables.ts), so a
// generated INSERT/UPDATE/DELETE asks for them instead of holding placeholders
// that do not parse. Pure.

import { engineFamily } from "./engineFamily";
import { qualifiedName, quoteIdentifier } from "./schema";

export interface TableRef {
  db?: string;
  schema?: string;
  name: string;
}

/** A variable name for a column: `:nombre`, word characters only. */
const varOf = (col: string) => ":" + (col.replace(/\W+/g, "_").replace(/^_+|_+$/g, "") || "v");

/** True where this module has statements to offer (not MongoDB's mongosh). */
export function hasTableSql(engine: string): boolean {
  return engineFamily(engine) !== "mongodb";
}

/** SELECT of every column (named when known, else `*`). */
export function selectSql(t: TableRef, engine: string, columns: string[] = []): string {
  if (!hasTableSql(engine)) return `db.${t.name}.find({})`;
  const list = columns.length > 0 ? columns.map((c) => quoteIdentifier(c, engine)).join(", ") : "*";
  return `SELECT ${list}\nFROM ${qualifiedName(t, engine)};`;
}

/** INSERT of one row, a variable per column. Null without columns. */
export function insertSql(t: TableRef, engine: string, columns: string[]): string | null {
  if (!hasTableSql(engine) || columns.length === 0) return null;
  const q = (c: string) => quoteIdentifier(c, engine);
  return (
    `INSERT INTO ${qualifiedName(t, engine)} (${columns.map(q).join(", ")})\n` +
    `VALUES (${columns.map(varOf).join(", ")});`
  );
}

/** The WHERE that names one row: the primary key, else every column. */
function rowWhere(engine: string, columns: string[], pk: string[]): string {
  const keys = pk.length > 0 ? pk : columns;
  return keys.map((c) => `${quoteIdentifier(c, engine)} = ${varOf(c)}`).join("\n  AND ");
}

/** UPDATE of one row by its key, setting the other columns. Null without columns. */
export function updateSql(t: TableRef, engine: string, columns: string[], pk: string[]): string | null {
  if (!hasTableSql(engine) || columns.length === 0) return null;
  const set = columns.filter((c) => !pk.includes(c));
  const assigned = (set.length > 0 ? set : columns)
    .map((c) => `${quoteIdentifier(c, engine)} = ${varOf(c)}`)
    .join(",\n    ");
  return `UPDATE ${qualifiedName(t, engine)}\nSET ${assigned}\nWHERE ${rowWhere(engine, columns, pk)};`;
}

/** DELETE of one row by its key. Null without columns. */
export function deleteSql(t: TableRef, engine: string, columns: string[], pk: string[]): string | null {
  if (!hasTableSql(engine) || columns.length === 0) return null;
  return `DELETE FROM ${qualifiedName(t, engine)}\nWHERE ${rowWhere(engine, columns, pk)};`;
}

/** Empty the table, or null where the tree has its own way (MongoDB) or none.
    SQLite has no TRUNCATE: a DELETE without WHERE is its equivalent. */
export function truncateSql(t: TableRef, engine: string): string | null {
  const family = engineFamily(engine);
  if (family === "mongodb") return null;
  const target = qualifiedName(t, engine);
  return family === "sqlite" ? `DELETE FROM ${target}` : `TRUNCATE TABLE ${target}`;
}
