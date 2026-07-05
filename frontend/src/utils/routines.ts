// Pure per-engine SQL for exploring stored procedures and functions (issue #137):
// list the routines of a database and fetch each one's definition (DDL) — all
// client-side via query.run, no core/driver change (same pattern as the server
// monitor #148 and user admin #140). Each engine keeps its routines in a
// different catalog: MySQL/MariaDB expose information_schema.ROUTINES + SHOW
// CREATE {PROCEDURE|FUNCTION}; PostgreSQL uses pg_proc + pg_get_functiondef;
// Informix uses sysprocedures + sysprocbody (definition reassembled from text
// rows). SQLite (no stored routines) and MongoDB are honestly "not supported".
// All pure and unit-tested; the component just runs the SQL these return.

import { quoteIdentifier } from "./schema";
import { engineFamily as family } from "./engineFamily";

/** A routine (stored procedure or function) as listed from the catalog. */
export type RoutineType = "PROCEDURE" | "FUNCTION" | "AGGREGATE" | "WINDOW";

/** Identity needed to fetch a routine's definition. */
export interface RoutineRef {
  name: string;
  type: RoutineType;
  /** Schema/owner, when the engine namespaces routines (PostgreSQL). */
  schema?: string;
  /** Stable catalog id disambiguating overloaded routines (Informix procid). */
  id?: string;
}

/** What routine exploration is available for an engine. */
export interface RoutineSupport {
  supported: boolean;
  /** SQL listing the routines (null when unsupported). */
  listSql: string | null;
  /** Result column holding the routine name. */
  nameCol: string | null;
  /** Result column holding the routine type (PROCEDURE/FUNCTION), if any. */
  typeCol: string | null;
  /** Result column holding the schema/owner, if the engine namespaces routines. */
  schemaCol: string | null;
  /** Result column holding a stable id disambiguating overloads (Informix procid). */
  idCol: string | null;
}

/** How to fetch and read a routine's definition text. */
export interface DefinitionQuery {
  sql: string;
  /** Column holding the DDL text. */
  column: string;
  /** When true, the result is one text fragment per row to be concatenated in
      order (Informix sysprocbody); otherwise the first row's column is the DDL. */
  concatRows: boolean;
}

/** Escape a single-quoted SQL string literal (double embedded quotes). */
function q(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Routine-listing capabilities for an engine. `db` scopes the listing to a
 * database/schema where the engine supports it (MySQL: ROUTINE_SCHEMA; falls
 * back to DATABASE() when omitted). PostgreSQL and Informix ignore `db` — their
 * connections are already bound to a single database — and list every schema.
 */
export function routinesFor(engine: string, db?: string): RoutineSupport {
  switch (family(engine)) {
    case "mysql": {
      const scope = db && db.trim() ? `'${q(db.trim())}'` : "DATABASE()";
      return {
        supported: true,
        listSql:
          "SELECT ROUTINE_NAME, ROUTINE_TYPE, DATA_TYPE, DEFINER, LAST_ALTERED " +
          `FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ${scope} ` +
          "ORDER BY ROUTINE_TYPE, ROUTINE_NAME",
        nameCol: "ROUTINE_NAME",
        typeCol: "ROUTINE_TYPE",
        schemaCol: null,
        idCol: null,
      };
    }
    case "postgres":
      return {
        supported: true,
        listSql:
          "SELECT n.nspname AS schema, p.proname AS name, " +
          "CASE p.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' " +
          "WHEN 'w' THEN 'WINDOW' ELSE 'FUNCTION' END AS type, " +
          "pg_get_function_result(p.oid) AS returns " +
          "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
          "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "ORDER BY n.nspname, p.proname",
        nameCol: "name",
        typeCol: "type",
        schemaCol: "schema",
        idCol: null,
      };
    case "informix":
      // procid is carried so definitionFor can pin an overloaded routine to its
      // exact body (procname is not unique — Informix overloads by signature).
      return {
        supported: true,
        listSql:
          "SELECT procid, procname AS name, " +
          "CASE WHEN isproc = 't' THEN 'PROCEDURE' ELSE 'FUNCTION' END AS type " +
          "FROM sysprocedures ORDER BY procname",
        nameCol: "name",
        typeCol: "type",
        schemaCol: null,
        idCol: "procid",
      };
    default:
      return {
        supported: false,
        listSql: null,
        nameCol: null,
        typeCol: null,
        schemaCol: null,
        idCol: null,
      };
  }
}

/**
 * Build the query that returns a routine's definition (DDL), or null when the
 * engine is unsupported or the ref is incomplete.
 */
export function definitionFor(engine: string, ref: RoutineRef): DefinitionQuery | null {
  if (!ref || !ref.name.trim()) return null;
  const name = ref.name.trim();
  switch (family(engine)) {
    case "mysql": {
      const kw = ref.type === "FUNCTION" ? "FUNCTION" : "PROCEDURE";
      const col = ref.type === "FUNCTION" ? "Create Function" : "Create Procedure";
      return {
        sql: `SHOW CREATE ${kw} ${quoteIdentifier(name, "mysql")}`,
        column: col,
        concatRows: false,
      };
    }
    case "postgres": {
      const schema = ref.schema && ref.schema.trim() ? ref.schema.trim() : "public";
      // Overloaded routines share a name; take the first match (documented limit).
      return {
        sql:
          "SELECT pg_get_functiondef(p.oid) AS definition " +
          "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
          `WHERE n.nspname = '${q(schema)}' AND p.proname = '${q(name)}' LIMIT 1`,
        column: "definition",
        concatRows: false,
      };
    }
    case "informix": {
      // sysprocbody stores the source as ordered text fragments (datakey 'T').
      // procname is NOT unique (routines overload by signature) so pin to the
      // exact procid when we have it; otherwise fall back to the first matching
      // routine by name (FIRST 1) rather than interleaving several bodies.
      const id = (ref.id ?? "").trim();
      const where =
        id && /^\d+$/.test(id)
          ? `b.procid = ${id}`
          : "b.procid = (SELECT FIRST 1 p.procid FROM sysprocedures p " +
            `WHERE p.procname = '${q(name)}')`;
      return {
        sql: `SELECT b.data FROM sysprocbody b WHERE ${where} AND b.datakey = 'T' ORDER BY b.seqno`,
        column: "data",
        concatRows: true,
      };
    }
    default:
      return null;
  }
}

/** A short reason routine exploration is unavailable on an engine. */
export function unsupportedReason(engine: string): string {
  const f = family(engine);
  if (f === "sqlite")
    return "SQLite no tiene procedimientos ni funciones almacenadas: es una base de datos embebida.";
  if (f === "mongodb")
    return "MongoDB no expone procedimientos almacenados en catálogos SQL.";
  return `La exploración de procedimientos no está disponible para el motor "${engine || "desconocido"}".`;
}
