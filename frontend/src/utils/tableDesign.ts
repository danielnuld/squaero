// Build a CREATE TABLE statement from a form definition (issue #136, phase 1:
// create). Pure and tested. Identifier quoting is engine-specific — backticks
// for MySQL, bare for Informix (double quotes are string literals there without
// DELIMIDENT, matching the driver's DML), ANSI double quotes otherwise.
// Auto-increment is rendered per engine: AUTO_INCREMENT (MySQL), INTEGER PRIMARY
// KEY AUTOINCREMENT (SQLite), SERIAL (Informix/PostgreSQL).

import { quoteIdentifier } from "./schema";
import type { ResultSet } from "./query";

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

/** Qualify a table name with an optional container (database/schema), the same
    way the generated SELECTs do: container.name, each part engine-quoted. */
function qualifyName(engine: string, container: string | undefined, name: string): string {
  return container
    ? `${quoteId(engine, container)}.${quoteId(engine, name)}`
    : quoteId(engine, name);
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

  const qname = qualifyName(e, def.container, name);
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

// ─── Phase 2: ALTER an existing table by form (issue #136) ──────────────────
// The designer loads a table's current columns (schema.describe), the user edits
// them, and buildAlterTable diffs the original against the edited definition to
// emit the ordered ALTER statements. Column identity is tracked by `origName`
// (undefined = a freshly added column), so a rename is distinguished from a
// drop+add — data is preserved. PK / auto-increment changes are out of scope for
// this phase (managing constraints across engines is a separate concern); only
// name/type/nullable/default are diffed.

/** A designer column carrying its pre-edit name, so renames are detectable. */
export interface AlterColumn extends ColumnDef {
  /** The column's name in the existing table; undefined for a new column. */
  origName?: string;
}

/** Edited table definition fed to buildAlterTable. */
export interface AlterTableDef {
  /** The (possibly renamed) table name. */
  name: string;
  columns: AlterColumn[];
  container?: string;
}

/** A column's state as loaded from the existing table (schema.describe). */
export interface OriginalColumn {
  name: string;
  type: string;
  nullable: boolean;
  defaultValue: string;
}

/** The pre-edit table, used as the diff baseline. */
export interface OriginalTable {
  name: string;
  columns: OriginalColumn[];
}

export type AlterResult =
  | { ok: true; statements: string[] }
  | { ok: false; error: string };

const alterErr = (error: string): AlterResult => ({ ok: false, error });

/**
 * Parse a schema.describe result into the pre-edit column baseline. The result
 * carries `name`, `type`, `notnull` and `dflt_value` columns (a subset any
 * engine reports); a column is nullable when `notnull` is falsy, and the default
 * is the raw `dflt_value` cell (empty when none).
 */
export function columnsFromDescribe(describe: ResultSet): OriginalColumn[] {
  const idx = (n: string) => describe.columns.findIndex((c) => c.name === n);
  const nameIdx = idx("name");
  const typeIdx = idx("type");
  const notnullIdx = idx("notnull");
  const dfltIdx = idx("dflt_value");
  if (nameIdx === -1) return [];
  const out: OriginalColumn[] = [];
  for (const row of describe.rows) {
    const name = row[nameIdx];
    if (name == null || name === "") continue;
    const nn = notnullIdx === -1 ? null : row[notnullIdx];
    out.push({
      name,
      type: (typeIdx === -1 ? "" : row[typeIdx]) ?? "",
      // notnull truthy ("1") → NOT NULL; null/""/"0" → nullable.
      nullable: !(nn != null && nn !== "" && nn !== "0"),
      defaultValue: (dfltIdx === -1 ? "" : row[dfltIdx]) ?? "",
    });
  }
  return out;
}

/** A column's definition clause for ALTER (name + type + NOT NULL + DEFAULT).
    Auto-increment / primary key are intentionally not rendered here. */
function alterColumnClause(engine: string, col: AlterColumn): string {
  let s = `${quoteId(engine, col.name.trim())} ${col.type.trim()}`;
  if (!col.nullable) s += " NOT NULL";
  if (col.defaultValue.trim()) s += ` DEFAULT ${col.defaultValue.trim()}`;
  return s;
}

/**
 * Diff an existing table against an edited definition and produce the ordered
 * ALTER statements (empty when nothing changed). Column changes run first on the
 * original (qualified) name, then the table rename last. Engine-specific:
 * MySQL/MariaDB use CHANGE/MODIFY (full redefinition); PostgreSQL and the generic
 * default use attribute-specific ALTER COLUMN; Informix uses MODIFY + RENAME
 * COLUMN; SQLite can add/drop/rename but cannot modify a column in place and
 * returns an honest error if asked to.
 *
 * Known limitations (the generated SQL is honest — it errors at execution and
 * the transaction rolls back — but these cases are not pre-validated here):
 *   • PostgreSQL type changes emit `ALTER COLUMN … TYPE …` without a `USING`
 *     clause, so an incompatible cast (e.g. text→int) fails at the server;
 *   • swapping two existing column names in a single edit produces sequential
 *     renames that collide on the transient name.
 */
export function buildAlterTable(
  engine: string,
  original: OriginalTable,
  edited: AlterTableDef,
): AlterResult {
  const e = (engine || "").toLowerCase();

  const cols = edited.columns.map((c) => ({
    ...c,
    name: c.name.trim(),
    type: c.type.trim(),
    defaultValue: c.defaultValue.trim(),
  }));
  if (cols.length === 0) return alterErr("La tabla debe conservar al menos una columna.");
  for (const c of cols) {
    if (!c.name) return alterErr("Toda columna necesita un nombre.");
    if (!c.type) return alterErr(`La columna "${c.name}" necesita un tipo.`);
  }
  const lower = cols.map((c) => c.name.toLowerCase());
  if (new Set(lower).size !== lower.length)
    return alterErr("Hay nombres de columna duplicados.");

  const newName = edited.name.trim();
  if (!newName) return alterErr("El nombre de la tabla es obligatorio.");

  const qt = qualifyName(e, edited.container, original.name);
  const addKw = e === "informix" ? "ADD " : "ADD COLUMN ";
  const dropKw = e === "informix" ? "DROP " : "DROP COLUMN ";

  const origByName = new Map(original.columns.map((c) => [c.name, c]));
  const kept = new Set<string>();
  const statements: string[] = [];

  for (const c of cols) {
    if (!c.origName) {
      statements.push(`ALTER TABLE ${qt} ${addKw}${alterColumnClause(e, c)}`);
      continue;
    }
    const o = origByName.get(c.origName);
    if (!o) return alterErr(`La columna original "${c.origName}" ya no existe.`);
    kept.add(c.origName);

    const renamed = c.name !== o.name;
    const attrsChanged =
      c.type !== o.type || c.nullable !== o.nullable || c.defaultValue !== o.defaultValue;
    if (!renamed && !attrsChanged) continue;

    const change = columnChange(e, qt, original.name, o, c, renamed, attrsChanged);
    if (!change.ok) return change;
    statements.push(...change.statements);
  }

  for (const o of original.columns) {
    if (!kept.has(o.name)) {
      statements.push(`ALTER TABLE ${qt} ${dropKw}${quoteId(e, o.name)}`);
    }
  }

  if (newName !== original.name) {
    if (e === "informix") {
      statements.push(`RENAME TABLE ${quoteId(e, original.name)} TO ${quoteId(e, newName)}`);
    } else {
      statements.push(`ALTER TABLE ${qt} RENAME TO ${quoteId(e, newName)}`);
    }
  }

  return { ok: true, statements };
}

/** Per-engine statements to rename and/or redefine one existing column. */
function columnChange(
  e: string,
  qt: string,
  tableName: string,
  o: OriginalColumn,
  c: AlterColumn,
  renamed: boolean,
  attrsChanged: boolean,
): AlterResult {
  const qOld = quoteId(e, o.name);
  const qNew = quoteId(e, c.name);

  if (e === "mysql" || e === "mariadb") {
    // CHANGE renames and redefines in one; MODIFY redefines keeping the name.
    if (renamed) return { ok: true, statements: [`ALTER TABLE ${qt} CHANGE COLUMN ${qOld} ${alterColumnClause(e, c)}`] };
    return { ok: true, statements: [`ALTER TABLE ${qt} MODIFY COLUMN ${alterColumnClause(e, c)}`] };
  }

  if (e === "sqlite") {
    // SQLite can rename a column but cannot alter its type/nullability/default.
    if (attrsChanged)
      return alterErr(
        `SQLite no puede modificar el tipo, nulabilidad o default de la columna "${o.name}"; ` +
          "requiere recrear la tabla.",
      );
    return { ok: true, statements: [`ALTER TABLE ${qt} RENAME COLUMN ${qOld} TO ${qNew}`] };
  }

  if (e === "informix") {
    const stmts: string[] = [];
    // Rename first (bare table.column), then MODIFY targets the new name.
    if (renamed) stmts.push(`RENAME COLUMN ${quoteId(e, tableName)}.${qOld} TO ${qNew}`);
    if (attrsChanged) stmts.push(`ALTER TABLE ${qt} MODIFY (${alterColumnClause(e, c)})`);
    return { ok: true, statements: stmts };
  }

  // PostgreSQL and the ANSI-quoted generic default: rename first, then
  // attribute-specific ALTER COLUMN targeting the (possibly new) name.
  const stmts: string[] = [];
  if (renamed) stmts.push(`ALTER TABLE ${qt} RENAME COLUMN ${qOld} TO ${qNew}`);
  const qc = qNew; // after a rename, subsequent statements use the new name
  if (o.type !== c.type) stmts.push(`ALTER TABLE ${qt} ALTER COLUMN ${qc} TYPE ${c.type}`);
  if (o.nullable !== c.nullable)
    stmts.push(
      `ALTER TABLE ${qt} ALTER COLUMN ${qc} ${c.nullable ? "DROP NOT NULL" : "SET NOT NULL"}`,
    );
  if (o.defaultValue !== c.defaultValue)
    stmts.push(
      `ALTER TABLE ${qt} ALTER COLUMN ${qc} ${
        c.defaultValue ? `SET DEFAULT ${c.defaultValue}` : "DROP DEFAULT"
      }`,
    );
  return { ok: true, statements: stmts };
}
