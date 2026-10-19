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
  /** Result columns holding the object's name and type, when they are not the
      `nombre` / `tipo` aliases the SQL engines produce (MongoDB's own). */
  nameKey?: string;
  typeKey?: string;
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
const COL_COLS: ObjectListColumn = { key: "columnas", label: "objlist.colColumns", numeric: true };
const COL_INDEXES: ObjectListColumn = { key: "indices", label: "objlist.colIndexes", numeric: true };

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
          "TABLE_ROWS AS filas, " +
          "(SELECT COUNT(*) FROM information_schema.COLUMNS c " +
          "WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME) AS columnas, " +
          "CASE WHEN TABLE_TYPE = 'VIEW' THEN NULL ELSE " +
          "(SELECT COUNT(DISTINCT s.INDEX_NAME) FROM information_schema.STATISTICS s " +
          "WHERE s.TABLE_SCHEMA = t.TABLE_SCHEMA AND s.TABLE_NAME = t.TABLE_NAME) END AS indices, " +
          "(DATA_LENGTH + INDEX_LENGTH) AS tamano, " +
          "TABLE_COMMENT AS comentario " +
          `FROM information_schema.TABLES t WHERE TABLE_SCHEMA = '${lit(db)}' ` +
          "ORDER BY TABLE_NAME",
        columns: [COL_NAME, COL_TYPE, COL_ROWS, COL_COLS, COL_INDEXES, COL_SIZE, COL_COMMENT],
        reason: null,
      };
    case "postgres":
      return {
        supported: true,
        sql:
          "SELECT c.relname AS nombre, " +
          "CASE WHEN c.relkind = 'v' THEN 'view' ELSE 'table' END AS tipo, " +
          "CASE WHEN c.relkind = 'v' THEN NULL ELSE c.reltuples::bigint END AS filas, " +
          "(SELECT count(*) FROM pg_attribute a " +
          "WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS columnas, " +
          "CASE WHEN c.relkind = 'v' THEN NULL ELSE " +
          "(SELECT count(*) FROM pg_index i WHERE i.indrelid = c.oid) END AS indices, " +
          "pg_total_relation_size(c.oid) AS tamano, " +
          "obj_description(c.oid) AS comentario " +
          "FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace " +
          `WHERE n.nspname = '${lit(db)}' AND c.relkind IN ('r','v','p') ` +
          "ORDER BY c.relname",
        columns: [COL_NAME, COL_TYPE, COL_ROWS, COL_COLS, COL_INDEXES, COL_SIZE, COL_COMMENT],
        reason: null,
      };
    case "informix":
      // systables exposes the row estimate; size/comment are not a plain column.
      // The type CASE is TRIMmed: its result type is CHAR(n) with n = the longest
      // branch ('table'), so an untrimmed 'view ' never matches the type filter
      // and no view is ever counted as one (issue #315).
      return {
        supported: true,
        sql:
          "SELECT TRIM(tabname) AS nombre, " +
          "TRIM(CASE WHEN tabtype = 'V' THEN 'view' ELSE 'table' END) AS tipo, " +
          "nrows AS filas, ncols AS columnas, " +
          "CASE WHEN tabtype = 'V' THEN NULL ELSE " +
          "(SELECT COUNT(*) FROM sysindexes i WHERE i.tabid = t.tabid) END AS indices " +
          "FROM systables t WHERE tabid > 99 AND tabtype IN ('T', 'V') " +
          "ORDER BY tabname",
        columns: [COL_NAME, COL_TYPE, COL_ROWS, COL_COLS, COL_INDEXES],
        reason: null,
      };
    case "sqlite":
      // No catalog row-count/size (a COUNT per table would be O(n) each); list
      // name + type from sqlite_master, skipping internal sqlite_* objects, with
      // the column and index counts the table-valued pragmas give for free.
      return {
        supported: true,
        sql:
          "SELECT m.name AS nombre, m.type AS tipo, " +
          "(SELECT COUNT(*) FROM pragma_table_info(m.name)) AS columnas, " +
          "CASE WHEN m.type = 'view' THEN NULL ELSE " +
          "(SELECT COUNT(*) FROM pragma_index_list(m.name)) END AS indices " +
          "FROM sqlite_master m " +
          "WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%' " +
          "ORDER BY m.name",
        columns: [COL_NAME, COL_TYPE, COL_COLS, COL_INDEXES],
        reason: null,
      };
    case "mongodb":
      // The collections and views of the connected database, as the server lists
      // them (name, type, options). No row count or size: the server has none
      // without a collStats per collection, and we only advertise what we get.
      return {
        supported: true,
        sql: "db.getCollectionInfos()",
        columns: [
          { key: "name", label: "objlist.colName" },
          { key: "type", label: "objlist.colType" },
        ],
        nameKey: "name",
        typeKey: "type",
        reason: null,
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

/** The kinds the list tells apart. */
export type ListedKind = "table" | "view" | "trigger";

/** One object of the list: its name, kind and the row it came from. */
export interface ListedObject {
  name: string;
  kind: ListedKind;
  /** The catalog row (empty for a trigger, which has its own listing). */
  row: (string | null)[];
  /** A trigger's table. */
  on?: string;
}

/**
 * The objects of an object-list result. The type is trimmed: engines that type
 * the catalog column as fixed-width CHAR pad the value ('view ' on Informix,
 * issue #315). Anything that is not a view lists as a table (a MongoDB
 * collection says "collection", a time-series one "timeseries"), and so does
 * every row when the listing has no type column.
 */
export function listedObjects(
  columns: { name: string }[],
  rows: (string | null)[][],
  support: Pick<ObjectListSupport, "nameKey" | "typeKey">,
): ListedObject[] {
  const at = (k: string) => columns.findIndex((c) => c.name.toLowerCase() === k);
  const ni = at(support.nameKey ?? "nombre");
  const ti = at(support.typeKey ?? "tipo");
  if (ni < 0) return [];
  return rows.map((row) => ({
    name: String(row[ni] ?? "").trim(),
    kind: ti >= 0 && String(row[ti] ?? "").trim() === "view" ? "view" : "table",
    row,
  }));
}

/**
 * A database's triggers (the listing of utils/triggers.ts) as list objects.
 * Empty when the listing does not carry the expected name column.
 */
export function listedTriggers(
  columns: { name: string }[],
  rows: (string | null)[][],
  cols: { nameCol: string | null; tableCol: string | null },
): ListedObject[] {
  const at = (k: string | null) => (k ? columns.findIndex((c) => c.name === k) : -1);
  const ni = at(cols.nameCol);
  const ti = at(cols.tableCol);
  if (ni < 0) return [];
  return rows.map((row) => ({
    name: String(row[ni] ?? "").trim(),
    kind: "trigger" as const,
    row: [],
    on: ti >= 0 ? String(row[ti] ?? "").trim() || undefined : undefined,
  }));
}

/** The objects of one kind (or all) whose name contains `text`, ignoring case. */
export function filterObjects(
  list: ListedObject[],
  kind: ListedKind | "all",
  text: string,
): ListedObject[] {
  const q = text.trim().toLowerCase();
  return list.filter((o) => (kind === "all" || o.kind === kind) && (!q || o.name.toLowerCase().includes(q)));
}

/** How many objects of each kind, for the tabs and the footer. */
export function objectCounts(list: ListedObject[]): Record<ListedKind | "all", number> {
  const n = { all: list.length, table: 0, view: 0, trigger: 0 };
  for (const o of list) n[o.kind]++;
  return n;
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
