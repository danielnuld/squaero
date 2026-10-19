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
// routines.ts ships in the DOM-free logic bundle (src/logic.ts), so it takes
// the locale as a parameter instead of reading the reactive one from i18n.ts.
import { translate, type Locale } from "./translate";

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
  /** Listing columns shown in the selected routine's header, with the i18n key
      of their label (P6). */
  metaCols: { col: string; label: string }[];
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
        metaCols: [
          { col: "DATA_TYPE", label: "explorer.meta.returns" },
          { col: "DEFINER", label: "explorer.meta.owner" },
          { col: "LAST_ALTERED", label: "explorer.meta.altered" },
        ],
      };
    }
    case "postgres":
      return {
        supported: true,
        listSql:
          "SELECT n.nspname AS schema, p.proname AS name, " +
          "CASE p.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' " +
          "WHEN 'w' THEN 'WINDOW' ELSE 'FUNCTION' END AS type, " +
          "pg_get_function_result(p.oid) AS returns, " +
          "pg_get_function_arguments(p.oid) AS arguments, l.lanname AS language, " +
          "CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE' ELSE 'VOLATILE' END AS volatility, " +
          "pg_get_userbyid(p.proowner) AS owner " +
          "FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace " +
          "JOIN pg_language l ON l.oid = p.prolang " +
          "WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') " +
          "ORDER BY n.nspname, p.proname",
        nameCol: "name",
        typeCol: "type",
        schemaCol: "schema",
        idCol: null,
        metaCols: [
          { col: "returns", label: "explorer.meta.returns" },
          { col: "arguments", label: "explorer.meta.arguments" },
          { col: "language", label: "explorer.meta.language" },
          { col: "volatility", label: "explorer.meta.volatility" },
          { col: "owner", label: "explorer.meta.owner" },
        ],
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
        metaCols: [],
      };
    default:
      return {
        supported: false,
        listSql: null,
        nameCol: null,
        typeCol: null,
        schemaCol: null,
        idCol: null,
        metaCols: [],
      };
  }
}

/** The routine list's type filter. */
export type RoutineFilter = "all" | "function" | "procedure";

/** Whether a routine passes the filter: aggregates and window functions are
    functions. */
export function routineMatches(type: RoutineType, filter: RoutineFilter): boolean {
  if (filter === "all") return true;
  return filter === "procedure" ? type === "PROCEDURE" : type !== "PROCEDURE";
}

/** Read a catalog type cell into a RoutineType (FUNCTION when unknown). */
export function routineTypeOf(cell: string | null): RoutineType {
  const upper = (cell ?? "").toUpperCase();
  return upper.includes("PROCEDURE")
    ? "PROCEDURE"
    : upper.includes("AGGREGATE")
      ? "AGGREGATE"
      : upper.includes("WINDOW")
        ? "WINDOW"
        : "FUNCTION";
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
export function unsupportedReason(engine: string, lang: Locale = "es"): string {
  const f = family(engine);
  if (f === "sqlite") return translate(lang, "routines.unsupported.sqlite");
  if (f === "mongodb") return translate(lang, "routines.unsupported.mongodb");
  return translate(lang, "routines.unsupported.other", {
    engine: engine || translate(lang, "engine.unknown"),
  });
}
