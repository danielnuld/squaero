// Pure per-engine SQL for the object-list view (UI design proposal, phase 3).
// Opening a database shows its objects as a metadata grid (name, type, and —
// where the engine exposes it — row count, size and comment), the way a desktop
// database tool does. All client-side via query.run; no core change. Each engine
// differs in how much metadata its catalogs expose, so the column set is
// per-engine and honest: we only advertise columns the SQL actually returns.

import { engineFamily as family } from "./engineFamily";

/** A column shown in the object-list grid. */
export interface ObjectListColumn {
  /** Result column key (lowercased alias produced by the SQL). */
  key: string;
  /** i18n message key for the header label; resolved with t() at the grid. */
  label: string;
  /** Right-align + tabular digits when true. */
  numeric?: boolean;
}

export interface ObjectListSupport {
  /** True when the engine can list objects with catalog metadata. */
  supported: boolean;
  /** SQL yielding at least `nombre` and `tipo` (null when unsupported). */
  sql: string | null;
  /** Columns present in the result, in display order. */
  columns: ObjectListColumn[];
  /** i18n message key for the honest reason shown when unsupported (t() at the view). */
  reason: string | null;
}

/** Escape a single-quoted SQL string literal. */
const lit = (s: string) => s.replace(/'/g, "''");

const COL_NAME: ObjectListColumn = { key: "nombre", label: "objlist.colName" };
const COL_TYPE: ObjectListColumn = { key: "tipo", label: "objlist.colType" };
const COL_ROWS: ObjectListColumn = { key: "filas", label: "objlist.colRows", numeric: true };
const COL_SIZE: ObjectListColumn = { key: "tamano", label: "objlist.colSize", numeric: true };
const COL_COMMENT: ObjectListColumn = { key: "comentario", label: "objlist.colComment" };

/**
 * Build the object-list query + column set for an engine and database. `db` is
 * the current database context; engines whose connection is already scoped to
 * one database (SQLite, Informix) ignore it.
 */
export function objectListFor(engine: string, db: string): ObjectListSupport {
  switch (family(engine)) {
    case "mysql":
      return {
        supported: true,
        sql:
          "SELECT TABLE_NAME AS nombre, " +
          "CASE WHEN TABLE_TYPE = 'VIEW' THEN 'view' ELSE 'table' END AS tipo, " +
          "TABLE_ROWS AS filas, (DATA_LENGTH + INDEX_LENGTH) AS tamano, " +
          "TABLE_COMMENT AS comentario " +
          `FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${lit(db)}' ` +
          "ORDER BY TABLE_NAME",
        columns: [COL_NAME, COL_TYPE, COL_ROWS, COL_SIZE, COL_COMMENT],
        reason: null,
      };
    case "postgres":
      return {
        supported: true,
        sql:
          "SELECT c.relname AS nombre, " +
          "CASE WHEN c.relkind = 'v' THEN 'view' ELSE 'table' END AS tipo, " +
          "c.reltuples::bigint AS filas, " +
          "pg_total_relation_size(c.oid) AS tamano, " +
          "obj_description(c.oid) AS comentario " +
          "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
          `WHERE n.nspname = '${lit(db)}' AND c.relkind IN ('r','v','p') ` +
          "ORDER BY c.relname",
        columns: [COL_NAME, COL_TYPE, COL_ROWS, COL_SIZE, COL_COMMENT],
        reason: null,
      };
    case "informix":
      // systables exposes the row estimate; size/comment are not a plain column.
      return {
        supported: true,
        sql:
          "SELECT TRIM(tabname) AS nombre, " +
          "CASE WHEN tabtype = 'V' THEN 'view' ELSE 'table' END AS tipo, " +
          "nrows AS filas " +
          "FROM systables WHERE tabid > 99 AND tabtype IN ('T', 'V') " +
          "ORDER BY tabname",
        columns: [COL_NAME, COL_TYPE, COL_ROWS],
        reason: null,
      };
    case "sqlite":
      // No catalog row-count/size (a COUNT per table would be O(n) each); list
      // name + type from sqlite_master, skipping internal sqlite_* objects.
      return {
        supported: true,
        sql:
          "SELECT name AS nombre, type AS tipo FROM sqlite_master " +
          "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' " +
          "ORDER BY name",
        columns: [COL_NAME, COL_TYPE],
        reason: null,
      };
    case "mongodb":
      return {
        supported: false,
        sql: null,
        columns: [],
        reason: "objlist.reasonMongo",
      };
    default:
      return {
        supported: false,
        sql: null,
        columns: [],
        reason: "objlist.reasonUnavailable",
      };
  }
}

/** Human-readable byte size (for the numeric size column). */
export function formatBytes(raw: string | number | null): string {
  if (raw === null || raw === "") return "";
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return String(raw);
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || Number.isInteger(v) ? 0 : 1)} ${units[i]}`;
}
