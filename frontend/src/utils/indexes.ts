// Pure per-engine SQL for viewing and managing a table's indexes and constraints
// (issue #139): today they are only visible inside the CREATE TABLE DDL. Listing
// runs over catalogs via query.run (same client-side pattern as routines #137 /
// triggers #138 — no core/driver change); create/drop generate the DDL per engine
// and the component applies it in a transaction.
//
// Catalogs differ per engine:
//   indexes     — MySQL/MariaDB information_schema.STATISTICS (grouped by index);
//                 PostgreSQL pg_indexes (indexdef carries the full text); SQLite
//                 pragma_index_list + pragma_index_info; Informix sysindices
//                 (column resolution omitted — best-effort, documented).
//   constraints — MySQL/MariaDB information_schema.TABLE_CONSTRAINTS; PostgreSQL
//                 pg_constraint (contype normalized to a readable type); Informix
//                 sysconstraints. SQLite has no separate constraint catalog (they
//                 live in the CREATE TABLE text) — listing is honestly unsupported.
//
// All identifiers/literals are engine-escaped. Everything here is pure and
// unit-tested; the component only runs the SQL these functions return.

import { quoteIdentifier } from "./schema";
import { engineFamily as family } from "./engineFamily";

/** Escape a single-quoted SQL string literal. Escape backslashes first (MySQL's
    default sql_mode treats `\` as an escape char) then double embedded quotes. */
function q(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "''");
}

/** Quote an identifier for the engine (bare for Informix, matching the DML). */
function quoteId(engine: string, id: string): string {
  return family(engine) === "informix" ? id : quoteIdentifier(id, engine);
}

/** Qualify a table name with its container (database/schema), engine-quoted.
    SQLite indexes live in the table's database, so the table is left bare there. */
function qualifiedTable(engine: string, table: string, container?: string): string {
  if (family(engine) === "sqlite" || !container) return quoteId(engine, table);
  return `${quoteId(engine, container)}.${quoteId(engine, table)}`;
}

// ─── Listing ────────────────────────────────────────────────────────────────

/** A display column in a catalog listing. */
export interface DetailCol {
  label: string;
  col: string;
}

/** What a catalog listing offers for an engine, or why it is unavailable. */
export interface CatalogList {
  supported: boolean;
  /** Short reason when unsupported. */
  reason: string | null;
  /** SQL returning the listing (null when unsupported). */
  sql: string | null;
  /** Result column holding the object name. */
  nameCol: string | null;
  /** Result column holding the constraint type, when applicable (for drop). */
  typeCol: string | null;
  /** Columns to display in the list. */
  detailCols: DetailCol[];
}

const unsupported = (reason: string): CatalogList => ({
  supported: false,
  reason,
  sql: null,
  nameCol: null,
  typeCol: null,
  detailCols: [],
});

/** SQL + column mapping to list a table's indexes. */
export function indexListFor(
  engine: string,
  table: string,
  db?: string,
  schema?: string,
): CatalogList {
  const t = (table || "").trim();
  if (!t) return unsupported("Selecciona una tabla.");
  switch (family(engine)) {
    case "mysql": {
      const dbScope = db && db.trim() ? `'${q(db.trim())}'` : "DATABASE()";
      return {
        supported: true,
        reason: null,
        sql:
          "SELECT INDEX_NAME AS name, " +
          "GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX SEPARATOR ', ') AS columnas, " +
          "IF(MAX(NON_UNIQUE) = 0, 'Sí', 'No') AS unico " +
          "FROM information_schema.STATISTICS " +
          `WHERE TABLE_SCHEMA = ${dbScope} AND TABLE_NAME = '${q(t)}' ` +
          "GROUP BY INDEX_NAME ORDER BY INDEX_NAME",
        nameCol: "name",
        typeCol: null,
        detailCols: [
          { label: "Columnas", col: "columnas" },
          { label: "Único", col: "unico" },
        ],
      };
    }
    case "postgres": {
      const nsScope = schema && schema.trim() ? `'${q(schema.trim())}'` : "current_schema()";
      return {
        supported: true,
        reason: null,
        sql:
          "SELECT indexname AS name, indexdef AS definicion FROM pg_indexes " +
          `WHERE tablename = '${q(t)}' AND schemaname = ${nsScope} ORDER BY indexname`,
        nameCol: "name",
        typeCol: null,
        detailCols: [{ label: "Definición", col: "definicion" }],
      };
    }
    case "sqlite":
      // Correlated table-valued pragma functions: one row per index with its
      // columns concatenated; "unique" is 1 for a unique index.
      return {
        supported: true,
        reason: null,
        sql:
          "SELECT il.name AS name, " +
          "group_concat(ii.name, ', ') AS columnas, " +
          "CASE il.\"unique\" WHEN 1 THEN 'Sí' ELSE 'No' END AS unico " +
          `FROM pragma_index_list('${q(t)}') il ` +
          "JOIN pragma_index_info(il.name) ii " +
          "GROUP BY il.name ORDER BY il.name",
        nameCol: "name",
        typeCol: null,
        detailCols: [
          { label: "Columnas", col: "columnas" },
          { label: "Único", col: "unico" },
        ],
      };
    case "informix":
      // Column resolution (part1..16 → syscolumns) is omitted; list names + kind.
      return {
        supported: true,
        reason: null,
        sql:
          "SELECT i.idxname AS name, " +
          "CASE i.idxtype WHEN 'U' THEN 'Sí' ELSE 'No' END AS unico " +
          "FROM sysindices i, systables t " +
          `WHERE i.tabid = t.tabid AND t.tabname = '${q(t)}' ORDER BY i.idxname`,
        nameCol: "name",
        typeCol: null,
        detailCols: [{ label: "Único", col: "unico" }],
      };
    case "mongodb":
      return unsupported("MongoDB gestiona índices por comandos, no por catálogos SQL.");
    default:
      return unsupported(`Los índices no están disponibles para el motor "${engine || "desconocido"}".`);
  }
}

/** SQL + column mapping to list a table's constraints (PK/FK/UNIQUE/CHECK). */
export function constraintListFor(
  engine: string,
  table: string,
  db?: string,
  schema?: string,
): CatalogList {
  const t = (table || "").trim();
  if (!t) return unsupported("Selecciona una tabla.");
  switch (family(engine)) {
    case "mysql": {
      const dbScope = db && db.trim() ? `'${q(db.trim())}'` : "DATABASE()";
      return {
        supported: true,
        reason: null,
        sql:
          "SELECT CONSTRAINT_NAME AS name, CONSTRAINT_TYPE AS tipo " +
          "FROM information_schema.TABLE_CONSTRAINTS " +
          `WHERE TABLE_SCHEMA = ${dbScope} AND TABLE_NAME = '${q(t)}' ` +
          "ORDER BY CONSTRAINT_TYPE, CONSTRAINT_NAME",
        nameCol: "name",
        typeCol: "tipo",
        detailCols: [{ label: "Tipo", col: "tipo" }],
      };
    }
    case "postgres": {
      const nsScope = schema && schema.trim() ? `'${q(schema.trim())}'` : "current_schema()";
      return {
        supported: true,
        reason: null,
        sql:
          "SELECT con.conname AS name, " +
          "CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' WHEN 'u' THEN 'UNIQUE' " +
          "WHEN 'f' THEN 'FOREIGN KEY' WHEN 'c' THEN 'CHECK' ELSE con.contype::text END AS tipo, " +
          "pg_get_constraintdef(con.oid) AS definicion " +
          "FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid " +
          "JOIN pg_namespace n ON n.oid = c.relnamespace " +
          `WHERE c.relname = '${q(t)}' AND n.nspname = ${nsScope} ORDER BY con.contype, con.conname`,
        nameCol: "name",
        typeCol: "tipo",
        detailCols: [
          { label: "Tipo", col: "tipo" },
          { label: "Definición", col: "definicion" },
        ],
      };
    }
    case "informix":
      return {
        supported: true,
        reason: null,
        sql:
          "SELECT c.constrname AS name, " +
          "CASE c.constrtype WHEN 'P' THEN 'PRIMARY KEY' WHEN 'U' THEN 'UNIQUE' " +
          "WHEN 'R' THEN 'FOREIGN KEY' WHEN 'C' THEN 'CHECK' ELSE c.constrtype END AS tipo " +
          "FROM sysconstraints c, systables t " +
          `WHERE c.tabid = t.tabid AND t.tabname = '${q(t)}' ORDER BY c.constrtype, c.constrname`,
        nameCol: "name",
        typeCol: "tipo",
        detailCols: [{ label: "Tipo", col: "tipo" }],
      };
    case "sqlite":
      return unsupported(
        "SQLite no cataloga constraints por separado; se definen en el CREATE TABLE. Usa la vista de estructura para verlas.",
      );
    case "mongodb":
      return unsupported("MongoDB no expone constraints en catálogos SQL.");
    default:
      return unsupported(`Las constraints no están disponibles para el motor "${engine || "desconocido"}".`);
  }
}

// ─── DDL builders ─────────────────────────────────────────────────────────

export type BuildResult = { ok: true; sql: string } | { ok: false; error: string };
const err = (error: string): BuildResult => ({ ok: false, error });

/** Definition of an index to create. */
export interface CreateIndexSpec {
  name: string;
  table: string;
  columns: string[];
  unique: boolean;
  container?: string;
}

export function buildCreateIndex(engine: string, spec: CreateIndexSpec): BuildResult {
  if (family(engine) === "mongodb")
    return err("MongoDB gestiona índices por comandos, no por DDL SQL.");
  const name = spec.name.trim();
  const table = spec.table.trim();
  const cols = spec.columns.map((c) => c.trim()).filter((c) => c.length > 0);
  if (!name) return err("El índice necesita un nombre.");
  if (!table) return err("Falta la tabla.");
  if (cols.length === 0) return err("Selecciona al menos una columna.");
  const unique = spec.unique ? "UNIQUE " : "";
  const qname = quoteId(engine, name);
  const qtable = qualifiedTable(engine, table, spec.container);
  const qcols = cols.map((c) => quoteId(engine, c)).join(", ");
  return { ok: true, sql: `CREATE ${unique}INDEX ${qname} ON ${qtable} (${qcols})` };
}

/** Identity needed to drop an index. */
export interface DropIndexSpec {
  name: string;
  table: string;
  container?: string;
}

export function buildDropIndex(engine: string, spec: DropIndexSpec): BuildResult {
  if (family(engine) === "mongodb")
    return err("MongoDB gestiona índices por comandos, no por DDL SQL.");
  const name = spec.name.trim();
  if (!name) return err("Falta el nombre del índice.");
  const qname = quoteId(engine, name);
  const f = family(engine);
  if (f === "mysql") {
    const table = spec.table.trim();
    if (!table) return err("MySQL requiere la tabla para eliminar un índice.");
    return { ok: true, sql: `DROP INDEX ${qname} ON ${qualifiedTable(engine, table, spec.container)}` };
  }
  if (f === "postgres") {
    // A Postgres index is schema-scoped, not attached to a table in DROP.
    const qi = spec.container ? `${quoteId(engine, spec.container)}.${qname}` : qname;
    return { ok: true, sql: `DROP INDEX ${qi}` };
  }
  // sqlite / informix / generic
  return { ok: true, sql: `DROP INDEX ${qname}` };
}

export type ConstraintKind = "unique" | "check" | "foreignKey";

/** Definition of a constraint to add via ALTER TABLE. */
export interface AddConstraintSpec {
  kind: ConstraintKind;
  name: string;
  table: string;
  /** Columns for UNIQUE / FOREIGN KEY. */
  columns?: string[];
  /** Raw boolean expression for CHECK (verbatim). */
  checkExpr?: string;
  /** Referenced table for FOREIGN KEY. */
  refTable?: string;
  /** Referenced columns for FOREIGN KEY. */
  refColumns?: string[];
  container?: string;
}

export function buildAddConstraint(engine: string, spec: AddConstraintSpec): BuildResult {
  const f = family(engine);
  if (f === "sqlite")
    return err("SQLite no permite agregar constraints con ALTER TABLE; se definen al crear la tabla.");
  if (f === "mongodb") return err("MongoDB no admite constraints SQL.");

  const name = spec.name.trim();
  const table = spec.table.trim();
  if (!name) return err("La constraint necesita un nombre.");
  if (!table) return err("Falta la tabla.");
  const qt = qualifiedTable(engine, table, spec.container);
  const qname = quoteId(engine, name);
  const cols = (spec.columns ?? []).map((c) => c.trim()).filter((c) => c.length > 0);

  let body: string;
  if (spec.kind === "unique") {
    if (cols.length === 0) return err("Selecciona al menos una columna.");
    body = `UNIQUE (${cols.map((c) => quoteId(engine, c)).join(", ")})`;
  } else if (spec.kind === "check") {
    const expr = (spec.checkExpr ?? "").trim();
    if (!expr) return err("Escribe la expresión del CHECK.");
    body = `CHECK (${expr})`;
  } else {
    // foreignKey
    const refTable = (spec.refTable ?? "").trim();
    const refCols = (spec.refColumns ?? []).map((c) => c.trim()).filter((c) => c.length > 0);
    if (cols.length === 0) return err("Selecciona al menos una columna local.");
    if (!refTable) return err("Indica la tabla referenciada.");
    if (refCols.length === 0) return err("Indica las columnas referenciadas.");
    body =
      `FOREIGN KEY (${cols.map((c) => quoteId(engine, c)).join(", ")}) ` +
      `REFERENCES ${quoteId(engine, refTable)} (${refCols.map((c) => quoteId(engine, c)).join(", ")})`;
  }
  // Informix puts the constraint name AFTER the definition; MySQL/PostgreSQL and
  // the generic default put it before.
  if (f === "informix")
    return { ok: true, sql: `ALTER TABLE ${qt} ADD CONSTRAINT ${body} CONSTRAINT ${qname}` };
  return { ok: true, sql: `ALTER TABLE ${qt} ADD CONSTRAINT ${qname} ${body}` };
}

/** Identity needed to drop a constraint. `type` is the readable kind from the
    listing (PRIMARY KEY / UNIQUE / FOREIGN KEY / CHECK); it selects the MySQL
    syntax, which lacks a generic DROP CONSTRAINT on older versions. */
export interface DropConstraintSpec {
  name: string;
  table: string;
  type?: string;
  container?: string;
}

export function buildDropConstraint(engine: string, spec: DropConstraintSpec): BuildResult {
  const f = family(engine);
  if (f === "sqlite")
    return err("SQLite no permite eliminar constraints con ALTER TABLE; recrea la tabla.");
  if (f === "mongodb") return err("MongoDB no admite constraints SQL.");

  const name = spec.name.trim();
  const table = spec.table.trim();
  if (!name) return err("Falta el nombre de la constraint.");
  if (!table) return err("Falta la tabla.");
  const qt = qualifiedTable(engine, table, spec.container);
  const qname = quoteId(engine, name);

  if (f === "mysql") {
    // MySQL/MariaDB have no portable generic DROP CONSTRAINT; use type-specific.
    const type = (spec.type ?? "").trim().toUpperCase();
    if (type === "PRIMARY KEY") return { ok: true, sql: `ALTER TABLE ${qt} DROP PRIMARY KEY` };
    if (type === "FOREIGN KEY") return { ok: true, sql: `ALTER TABLE ${qt} DROP FOREIGN KEY ${qname}` };
    if (type === "UNIQUE") return { ok: true, sql: `ALTER TABLE ${qt} DROP INDEX ${qname}` };
    if (type === "CHECK") return { ok: true, sql: `ALTER TABLE ${qt} DROP CHECK ${qname}` };
    return err("Indica el tipo de constraint para generar el DROP en MySQL.");
  }
  // postgres / informix / generic
  return { ok: true, sql: `ALTER TABLE ${qt} DROP CONSTRAINT ${qname}` };
}
