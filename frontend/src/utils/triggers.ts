// Pure per-engine SQL for exploring triggers and (scheduled) events (issue #138):
// list a database's triggers/events and fetch each one's definition (DDL) — all
// client-side via query.run, no core/driver change (same pattern as routines #137
// and the server monitor #148). Editing is offered as "open the DDL in the editor"
// so the user recreates it in the transactional session, honestly matching what
// each engine allows. Catalogs differ per engine:
//   triggers — MySQL/MariaDB information_schema.TRIGGERS + SHOW CREATE TRIGGER;
//              PostgreSQL pg_trigger + pg_get_triggerdef; SQLite sqlite_master
//              (the DDL is inline in the `sql` column, no second query); Informix
//              systriggers + systrigbody (text reassembled from ordered rows).
//   events  — MySQL/MariaDB only: information_schema.EVENTS + SHOW CREATE EVENT.
// SQLite/PostgreSQL/Informix/MongoDB have no built-in scheduled events here.
// All pure and unit-tested; the component just runs the SQL these return.

import { quoteIdentifier } from "./schema";

/** Which schema object the explorer is listing. */
export type ObjectKind = "trigger" | "event";

/** Identity needed to fetch an object's definition. */
export interface ObjectRef {
  name: string;
  /** Owning table, when the engine needs it to disambiguate (PostgreSQL trigger). */
  table?: string;
  /** Stable catalog id disambiguating overloads (Informix trigid). */
  id?: string;
}

/** A column surfaced in the object list, with its display label. */
export interface DetailCol {
  label: string;
  col: string;
}

/** What object exploration is available for an engine + kind. */
export interface ObjectSupport {
  supported: boolean;
  /** SQL listing the objects (null when unsupported). */
  listSql: string | null;
  /** Result column holding the object name. */
  nameCol: string | null;
  /** Result column holding the owning table, if any. */
  tableCol: string | null;
  /** Result column holding a stable id for overload disambiguation, if any. */
  idCol: string | null;
  /** When set, the list row already carries the full DDL in this column
      (SQLite); no separate definition query is needed. */
  inlineDefCol: string | null;
  /** Extra columns to show alongside the name in the list. */
  detailCols: DetailCol[];
}

/** How to fetch and read an object's definition text. */
export interface DefinitionQuery {
  sql: string;
  column: string;
  /** When true, concatenate a single-column multi-row result in order. */
  concatRows: boolean;
}

function family(engine: string): string {
  const e = engine.toLowerCase();
  if (e === "mysql" || e === "mariadb") return "mysql";
  if (e === "postgres" || e === "postgresql") return "postgres";
  return e;
}

/** Escape a single-quoted SQL string literal (double embedded quotes). */
function q(value: string): string {
  return value.replace(/'/g, "''");
}

const UNSUPPORTED: ObjectSupport = {
  supported: false,
  listSql: null,
  nameCol: null,
  tableCol: null,
  idCol: null,
  inlineDefCol: null,
  detailCols: [],
};

function triggersFor(engine: string, db?: string): ObjectSupport {
  switch (family(engine)) {
    case "mysql": {
      const scope = db && db.trim() ? `'${q(db.trim())}'` : "DATABASE()";
      return {
        supported: true,
        listSql:
          "SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, EVENT_OBJECT_TABLE " +
          `FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ${scope} ` +
          "ORDER BY EVENT_OBJECT_TABLE, TRIGGER_NAME",
        nameCol: "TRIGGER_NAME",
        tableCol: "EVENT_OBJECT_TABLE",
        idCol: null,
        inlineDefCol: null,
        detailCols: [
          { label: "Momento", col: "ACTION_TIMING" },
          { label: "Evento", col: "EVENT_MANIPULATION" },
          { label: "Tabla", col: "EVENT_OBJECT_TABLE" },
        ],
      };
    }
    case "postgres":
      // pg_trigger yields one row per trigger (unlike information_schema.triggers,
      // which repeats a trigger per firing event); tgisinternal filters FK/constraint
      // triggers that users never author.
      return {
        supported: true,
        listSql:
          'SELECT t.tgname AS name, c.relname AS "table", n.nspname AS schema ' +
          "FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid " +
          "JOIN pg_namespace n ON n.oid = c.relnamespace " +
          "WHERE NOT t.tgisinternal " +
          "AND n.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "ORDER BY c.relname, t.tgname",
        nameCol: "name",
        tableCol: "table",
        idCol: null,
        inlineDefCol: null,
        detailCols: [{ label: "Tabla", col: "table" }],
      };
    case "sqlite":
      // The CREATE TRIGGER text is stored verbatim in sqlite_master.sql.
      return {
        supported: true,
        listSql:
          "SELECT name, tbl_name AS \"table\", sql FROM sqlite_master " +
          "WHERE type = 'trigger' ORDER BY tbl_name, name",
        nameCol: "name",
        tableCol: "table",
        idCol: null,
        inlineDefCol: "sql",
        detailCols: [{ label: "Tabla", col: "table" }],
      };
    case "informix":
      // systrigbody carries the source text; trigid pins the exact trigger.
      return {
        supported: true,
        listSql:
          "SELECT trigid, trigname AS name, tabid FROM systriggers ORDER BY trigname",
        nameCol: "name",
        tableCol: null,
        idCol: "trigid",
        inlineDefCol: null,
        detailCols: [],
      };
    default:
      return UNSUPPORTED;
  }
}

function eventsFor(engine: string, db?: string): ObjectSupport {
  if (family(engine) !== "mysql") return UNSUPPORTED;
  const scope = db && db.trim() ? `'${q(db.trim())}'` : "DATABASE()";
  return {
    supported: true,
    listSql:
      "SELECT EVENT_NAME, EVENT_TYPE, STATUS, INTERVAL_VALUE, INTERVAL_FIELD " +
      `FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ${scope} ORDER BY EVENT_NAME`,
    nameCol: "EVENT_NAME",
    tableCol: null,
    idCol: null,
    inlineDefCol: null,
    detailCols: [
      { label: "Tipo", col: "EVENT_TYPE" },
      { label: "Estado", col: "STATUS" },
    ],
  };
}

/** Listing capabilities for an engine + object kind. */
export function objectsFor(engine: string, kind: ObjectKind, db?: string): ObjectSupport {
  return kind === "event" ? eventsFor(engine, db) : triggersFor(engine, db);
}

/**
 * Build the query returning an object's definition (DDL), or null when the engine
 * is unsupported, the ref is incomplete, or the definition is already inline in
 * the list row (SQLite — read `inlineDefCol` from the row instead).
 */
export function definitionFor(
  engine: string,
  kind: ObjectKind,
  ref: ObjectRef,
): DefinitionQuery | null {
  if (!ref || !ref.name.trim()) return null;
  const name = ref.name.trim();
  const f = family(engine);

  if (kind === "event") {
    if (f !== "mysql") return null;
    return {
      sql: `SHOW CREATE EVENT ${quoteIdentifier(name, "mysql")}`,
      column: "Create Event",
      concatRows: false,
    };
  }

  // triggers
  switch (f) {
    case "mysql":
      return {
        sql: `SHOW CREATE TRIGGER ${quoteIdentifier(name, "mysql")}`,
        column: "SQL Original Statement",
        concatRows: false,
      };
    case "postgres": {
      // A trigger name is unique only per table, so pin to the table when known.
      const tableClause =
        ref.table && ref.table.trim() ? ` AND c.relname = '${q(ref.table.trim())}'` : "";
      return {
        sql:
          "SELECT pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t " +
          "JOIN pg_class c ON c.oid = t.tgrelid " +
          `WHERE NOT t.tgisinternal AND t.tgname = '${q(name)}'${tableClause} LIMIT 1`,
        column: "definition",
        concatRows: false,
      };
    }
    case "sqlite":
      // Definition is inline in the list row; a direct lookup as a fallback.
      return {
        sql:
          "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND " +
          `name = '${q(name)}' LIMIT 1`,
        column: "sql",
        concatRows: false,
      };
    case "informix": {
      const id = (ref.id ?? "").trim();
      const where =
        id && /^\d+$/.test(id)
          ? `b.trigid = ${id}`
          : "b.trigid = (SELECT FIRST 1 t.trigid FROM systriggers t " +
            `WHERE t.trigname = '${q(name)}')`;
      return {
        sql: `SELECT b.data FROM systrigbody b WHERE ${where} AND b.datakey = 'D' ORDER BY b.seqno`,
        column: "data",
        concatRows: true,
      };
    }
    default:
      return null;
  }
}

/** A short reason the given object kind is unavailable on an engine. */
export function unsupportedReason(engine: string, kind: ObjectKind): string {
  const f = family(engine);
  const what = kind === "event" ? "Los eventos programados" : "Los triggers";
  if (kind === "event") {
    if (f === "sqlite") return "SQLite no tiene eventos programados.";
    if (f === "postgres" || f === "postgresql")
      return "PostgreSQL no tiene eventos programados nativos (se usan extensiones como pg_cron).";
    if (f === "informix") return "Los eventos programados de Informix no están disponibles aquí.";
    if (f === "mongodb") return "MongoDB no expone eventos programados en catálogos SQL.";
    return `Los eventos programados no están disponibles para el motor "${engine || "desconocido"}".`;
  }
  if (f === "mongodb") return "MongoDB no expone triggers en catálogos SQL.";
  return `${what} no están disponibles para el motor "${engine || "desconocido"}".`;
}
