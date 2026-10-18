// Which table a hand-written query reads from, so the grid can offer the row
// editor for it too (issue: "al ejecutar una consulta no aparece el editor").
//
// Until now only the tree's "open table" path set an edit source, so a typed
// `SELECT * FROM clientes WHERE id = 3` came back read-only even though every
// row of it maps 1:1 to a row of `clientes`. This module answers, purely, the
// only question that matters: does this statement read exactly ONE table, whole
// rows, with no reshaping? If yes it returns that table (qualified as written);
// if anything makes a result row stop being a table row — a join, a comma list,
// a subquery, DISTINCT, GROUP BY, a set operation, several statements — it says
// so (EditBlock), and the toolbar shows that reason on a disabled Editar
// instead of hiding the edit functions in silence (issue #718).
//
// Projecting only some columns is fine: the caller still refuses to edit unless
// the table's primary key came back in the result (see utils/edit.ts#whereForRow),
// which is what actually guarantees a row can be addressed unambiguously.
//
// Qualified names are read in the engine's own spelling: `db.table` on MySQL,
// `schema.table` on the ANSI engines, `db:owner.table` on Informix (see
// utils/schema.ts#qualifiedName, the mirror of this parser).

import { engineFamily } from "./engineFamily";
import { describePkColumns } from "./edit";
import type { ResultColumn, ResultSet } from "./query";

/** The table a query reads from, in the parts schema.describe expects. */
export interface QueryTarget {
  table: string;
  db?: string;
  schema?: string;
}

/** Clauses that end the FROM list. `for`/`window`/`into` included so an engine
    extension can't be mistaken for an alias. */
const FROM_END =
  /\b(where|group|having|order|limit|offset|union|intersect|except|minus|fetch|for|window|into|with)\b/i;

/** Anything here means a result row is no longer one table row. */
const RESHAPING = /\b(join|distinct|union|intersect|except|minus|group\s+by|into)\b/i;

/** Strip comments and string literals so keywords inside them can't fool us.
    Exported for utils/sqlEffects.ts, which asks a different question of the same
    scrubbed text. */
export function scrub(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a dotted reference on the dots that are NOT inside a quoted part. The
    parts keep their delimiters: whether a name was quoted decides its case. */
function splitParts(ref: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let quote = "";
  for (const ch of ref) {
    if (quote) {
      cur += ch;
      if (ch === quote || (quote === "[" && ch === "]")) quote = "";
    } else if (ch === '"' || ch === "`" || ch === "[") {
      quote = ch;
      cur += ch;
    } else if (ch === ".") {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter((p) => p !== "");
}

/** Drop the delimiters of a quoted identifier (`x`, "x", [x]), undoubling. An
    unquoted one is folded the way the engine folds it: PostgreSQL and Informix
    store `Clientes` as `clientes`, so describing it as typed finds nothing. */
function ident(id: string, fold: boolean): string {
  const s = id.trim();
  if (s.length >= 2) {
    if (s[0] === '"' && s.endsWith('"')) return s.slice(1, -1).replace(/""/g, '"');
    if (s[0] === "`" && s.endsWith("`")) return s.slice(1, -1).replace(/``/g, "`");
    if (s[0] === "[" && s.endsWith("]")) return s.slice(1, -1);
  }
  return fold ? s.toLowerCase() : s;
}

/** A single table reference (`db.schema.t`, `db:owner.t`, `t`) → its parts. */
function refParts(ref: string, engine: string): QueryTarget | null {
  const fam = engineFamily(engine);
  const fold = fam === "postgres" || fam === "informix";
  let db: string | undefined;
  let rest = ref;
  // Informix separates the database with a colon: `stores:informix.customer`.
  const colon = ref.indexOf(":");
  if (colon !== -1) {
    db = ident(ref.slice(0, colon), fold);
    rest = ref.slice(colon + 1);
  }
  const parts = splitParts(rest).map((p) => ident(p, fold));
  if (parts.length === 0 || parts.length > 3) return null;
  const table = parts[parts.length - 1];
  if (!table) return null;
  const out: QueryTarget = { table };
  if (db) out.db = db;
  // Informix: the owner is dropped, as utils/schema.ts#qualifiedName drops it.
  // The core reads a `schema` as the DATABASE there, so `informix.customer` would
  // otherwise be looked up (and edited) in a database called "informix".
  if (fam === "informix") return out;
  if (parts.length === 3) {
    out.db = parts[0];
    out.schema = parts[1];
  } else if (parts.length === 2) {
    // Two parts mean a database on MySQL and a schema everywhere else.
    if (fam === "mysql") out.db = parts[0];
    else out.schema = parts[0];
  }
  return out;
}

/**
 * Why a result cannot be edited (issue #718), for the toolbar to say instead of
 * hiding the edit functions:
 * - `statement`: not one SELECT (DML, DDL, a script);
 * - `multiTable`: a join, a subquery, DISTINCT, GROUP BY, a set operation —
 *   result rows are no longer rows of one table;
 * - `engine`: the driver cannot write rows (no DBC_FEAT_DML);
 * - `noTable`: the table's structure could not be read;
 * - `noPk`: the table has no primary key (a view never has one);
 * - `pkNotProjected`: the key is not among the result's columns.
 */
export type EditBlock =
  | "statement"
  | "multiTable"
  | "engine"
  | "noTable"
  | "noPk"
  | "pkNotProjected";

/** Engines whose driver implements row.insert/update/delete (DBC_FEAT_DML), for
    a session whose conn.open did not report its features. */
const DML_ENGINES = new Set(["sqlite", "postgres", "mysql", "informix"]);

/** Whether the engine's driver can write rows at all: `dml` is what conn.open
    reported (features.dml); without it, the known engines. */
export function engineEdits(engine: string, dml?: boolean): boolean {
  return dml ?? DML_ENGINES.has(engineFamily(engine));
}

/** Parse `sql` down to its one table, or say why it has none (engine aside). */
function parseTarget(sql: string, engine: string): { target: QueryTarget } | { block: EditBlock } {
  let s = scrub(sql);
  // One statement only: a trailing `;` is fine, an inner one is not.
  s = s.replace(/;\s*$/, "");
  if (s.includes(";")) return { block: "statement" };
  if (!/^select\b/i.test(s)) return { block: "statement" };
  if (RESHAPING.test(s)) return { block: "multiTable" };

  const from = /\bfrom\b/i.exec(s);
  if (!from) return { block: "multiTable" };
  const after = s.slice(from.index + from[0].length);
  const end = FROM_END.exec(after);
  const body = (end ? after.slice(0, end.index) : after).trim();
  // A comma list is a join; parentheses are a subquery or a table function.
  if (!body || body.includes(",") || body.includes("(")) return { block: "multiTable" };

  // `table`, `table alias` or `table AS alias` — the alias is irrelevant here.
  const tokens = body.split(" ").filter(Boolean);
  if (tokens.length > 3) return { block: "multiTable" };
  if (tokens.length === 3 && tokens[1].toLowerCase() !== "as") return { block: "multiTable" };
  const target = refParts(tokens[0], engine);
  return target ? { target } : { block: "multiTable" };
}

/**
 * The single table `sql` reads whole rows from, or why its result cannot be
 * edited (see the module comment). `engine` decides how a two-part name is read,
 * how unquoted names are folded, and whether rows can be written at all.
 */
export function queryEditCheck(
  sql: string,
  engine = "",
  dml?: boolean,
): { target: QueryTarget } | { block: EditBlock } {
  return engineEdits(engine, dml) ? parseTarget(sql, engine) : { block: "engine" };
}

/**
 * The single table `sql` reads whole rows from, or null when the statement is
 * anything but a plain single-table SELECT. Unlike queryEditCheck it does not
 * ask whether the engine can edit (a snippet name needs only the table), but
 * MongoDB's `db.coll.find()` surface is not SQL and is never parsed here.
 */
export function queryEditTarget(sql: string, engine = ""): QueryTarget | null {
  if (engineFamily(engine) === "mongodb") return null;
  const check = parseTarget(sql, engine);
  return "target" in check ? check.target : null;
}

/**
 * The primary key to edit `columns` by, from the table's describe — each key
 * column spelled as the RESULT spells it — or why there is none. A result keeps
 * the select list's spelling on MySQL and SQL Server (`SELECT ID` comes back as
 * `ID` while the catalog says `id`), and those engines match column names
 * case-insensitively, so a case-only difference still addresses the same column.
 * An exact match wins, for the engines where `"Id"` and `id` are two columns.
 */
export function editablePk(
  describe: ResultSet,
  columns: ResultColumn[],
): { pk: string[] } | { block: EditBlock } {
  if (describe.rows.length === 0) return { block: "noTable" };
  const keys = describePkColumns(describe);
  if (keys.length === 0) return { block: "noPk" };
  const pk: string[] = [];
  for (const key of keys) {
    const col =
      columns.find((c) => c.name === key) ??
      columns.find((c) => c.name.toLowerCase() === key.toLowerCase());
    if (!col) return { block: "pkNotProjected" };
    pk.push(col.name);
  }
  return { pk };
}
