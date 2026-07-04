// Build a CREATE TABLE statement from a form definition (issue #136, phase 1:
// create). Pure and tested. Identifier quoting is engine-specific — backticks
// for MySQL, bare for Informix (double quotes are string literals there without
// DELIMIDENT, matching the driver's DML), ANSI double quotes otherwise.
// Auto-increment is rendered per engine: AUTO_INCREMENT (MySQL), INTEGER PRIMARY
// KEY AUTOINCREMENT (SQLite), SERIAL (Informix/PostgreSQL).

import { quoteIdentifier } from "./schema";

export interface ColumnDef {
  name: string;
  /** Free-text SQL type, e.g. "INT", "VARCHAR(255)", "DECIMAL(10,2)". */
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
  /** Raw default expression (verbatim); empty = no default. */
  defaultValue: string;
}

export interface TableDef {
  name: string;
  columns: ColumnDef[];
  /** Optional container (database/schema) to create the table in; qualifies the
      name as container.name, like the SELECTs the tree generates. */
  container?: string;
}

export type BuildResult = { ok: true; sql: string } | { ok: false; error: string };

const err = (error: string): BuildResult => ({ ok: false, error });

/** Quote an identifier for the engine (bare for Informix). */
function quoteId(engine: string, id: string): string {
  return engine === "informix" ? id : quoteIdentifier(id, engine);
}

export function buildCreateTable(engine: string, def: TableDef): BuildResult {
  const e = (engine || "").toLowerCase();
  const name = def.name.trim();
  if (!name) return err("El nombre de la tabla es obligatorio.");

  const cols = def.columns.map((c) => ({
    ...c,
    name: c.name.trim(),
    type: c.type.trim(),
    defaultValue: c.defaultValue.trim(),
  }));
  if (cols.length === 0) return err("Agrega al menos una columna.");
  for (const c of cols) {
    if (!c.name) return err("Toda columna necesita un nombre.");
    if (!c.type) return err(`La columna "${c.name}" necesita un tipo.`);
  }
  const lower = cols.map((c) => c.name.toLowerCase());
  if (new Set(lower).size !== lower.length)
    return err("Hay nombres de columna duplicados.");

  const pkCols = cols.filter((c) => c.primaryKey);
  const aiCols = cols.filter((c) => c.autoIncrement);
  for (const c of aiCols) {
    if (!c.primaryKey)
      return err(`La columna "${c.name}" es autoincremental y debe ser clave primaria.`);
  }
  if ((e === "mysql" || e === "mariadb") && aiCols.length > 1)
    return err("MySQL permite solo una columna AUTO_INCREMENT.");
  if (e === "sqlite" && aiCols.length > 0 && pkCols.length > 1)
    return err("En SQLite la columna autoincremental debe ser la única clave primaria.");

  // SQLite autoincrement is only expressible as INTEGER PRIMARY KEY AUTOINCREMENT
  // inline (no separate PK clause).
  const sqliteInlinePk = e === "sqlite" && aiCols.length === 1 && pkCols.length === 1;

  const lines = cols.map((c) => {
    if (sqliteInlinePk && c.primaryKey) {
      return `  ${quoteId(e, c.name)} INTEGER PRIMARY KEY AUTOINCREMENT`;
    }
    let type = c.type;
    if (c.autoIncrement && (e === "informix" || e === "postgres" || e === "postgresql")) {
      type = "SERIAL";
    }
    let line = `  ${quoteId(e, c.name)} ${type}`;
    if (!c.nullable) line += " NOT NULL";
    if (c.defaultValue) line += ` DEFAULT ${c.defaultValue}`;
    if (c.autoIncrement && (e === "mysql" || e === "mariadb")) line += " AUTO_INCREMENT";
    return line;
  });

  if (!sqliteInlinePk && pkCols.length > 0) {
    lines.push(`  PRIMARY KEY (${pkCols.map((c) => quoteId(e, c.name)).join(", ")})`);
  }

  const qname = def.container
    ? `${quoteId(e, def.container)}.${quoteId(e, name)}`
    : quoteId(e, name);
  return { ok: true, sql: `CREATE TABLE ${qname} (\n${lines.join(",\n")}\n)` };
}

/** A blank column row for a fresh designer form. */
export function emptyColumn(): ColumnDef {
  return { name: "", type: "", nullable: true, primaryKey: false, autoIncrement: false, defaultValue: "" };
}

/** Common type suggestions offered per engine (datalist hints, non-exhaustive). */
export function typeSuggestions(engine: string): string[] {
  const e = (engine || "").toLowerCase();
  if (e === "sqlite") return ["INTEGER", "TEXT", "REAL", "BLOB", "NUMERIC"];
  if (e === "informix")
    return ["INTEGER", "SERIAL", "VARCHAR(255)", "CHAR(10)", "DECIMAL(10,2)", "DATE", "DATETIME YEAR TO SECOND"];
  // mysql/mariadb/postgres and the generic default
  return ["INT", "BIGINT", "VARCHAR(255)", "TEXT", "DECIMAL(10,2)", "BOOLEAN", "DATE", "TIMESTAMP"];
}
