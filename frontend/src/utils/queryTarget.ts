// Which table a hand-written query reads from, so the grid can offer the row
// editor for it too (issue: "al ejecutar una consulta no aparece el editor").
//
// Until now only the tree's "open table" path set an edit source, so a typed
// `SELECT * FROM clientes WHERE id = 3` came back read-only even though every
// row of it maps 1:1 to a row of `clientes`. This module answers, purely, the
// only question that matters: does this statement read exactly ONE table, whole
// rows, with no reshaping? If yes it returns that table (qualified as written);
// if anything makes a result row stop being a table row — a join, a comma list,
// a subquery, DISTINCT, GROUP BY, a set operation, several statements — it
// returns null and the grid stays read-only.
//
// Projecting only some columns is fine: the caller still refuses to edit unless
// the table's primary key came back in the result (see utils/edit.ts#whereForRow),
// which is what actually guarantees a row can be addressed unambiguously.
//
// Qualified names are read in the engine's own spelling: `db.table` on MySQL,
// `schema.table` on the ANSI engines, `db:owner.table` on Informix (see
// utils/schema.ts#qualifiedName, the mirror of this parser).

import { engineFamily } from "./engineFamily";

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

/** Strip comments and string literals so keywords inside them can't fool us. */
function scrub(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a dotted reference on the dots that are NOT inside a quoted part. */
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
  return parts.map(unquote).filter((p) => p !== "");
}

/** Drop the delimiters of a quoted identifier (`x`, "x", [x]), undoubling. */
function unquote(id: string): string {
  const s = id.trim();
  if (s.length >= 2) {
    if (s[0] === '"' && s.endsWith('"')) return s.slice(1, -1).replace(/""/g, '"');
    if (s[0] === "`" && s.endsWith("`")) return s.slice(1, -1).replace(/``/g, "`");
    if (s[0] === "[" && s.endsWith("]")) return s.slice(1, -1);
  }
  return s;
}

/** A single table reference (`db.schema.t`, `db:owner.t`, `t`) → its parts. */
function refParts(ref: string, engine: string): QueryTarget | null {
  const fam = engineFamily(engine);
  let db: string | undefined;
  let rest = ref;
  // Informix separates the database with a colon: `stores:informix.customer`.
  const colon = ref.indexOf(":");
  if (colon !== -1) {
    db = unquote(ref.slice(0, colon));
    rest = ref.slice(colon + 1);
  }
  const parts = splitParts(rest);
  if (parts.length === 0 || parts.length > 3) return null;
  const table = parts[parts.length - 1];
  if (!table) return null;
  const out: QueryTarget = { table };
  if (db) out.db = db;
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
 * The single table `sql` reads whole rows from, or null when the statement is
 * anything but a plain single-table SELECT (see the module comment). `engine`
 * decides how a two-part name is read and rules MongoDB out — its `db.coll.find()`
 * surface is not SQL and is never parsed here.
 */
export function queryEditTarget(sql: string, engine = ""): QueryTarget | null {
  if (engineFamily(engine) === "mongodb") return null;
  let s = scrub(sql);
  // One statement only: a trailing `;` is fine, an inner one is not.
  s = s.replace(/;\s*$/, "");
  if (s.includes(";")) return null;
  if (!/^select\b/i.test(s)) return null;
  if (RESHAPING.test(s)) return null;

  const from = /\bfrom\b/i.exec(s);
  if (!from) return null;
  const after = s.slice(from.index + from[0].length);
  const end = FROM_END.exec(after);
  const body = (end ? after.slice(0, end.index) : after).trim();
  // A comma list is a join; parentheses are a subquery or a table function.
  if (!body || body.includes(",") || body.includes("(")) return null;

  // `table`, `table alias` or `table AS alias` — the alias is irrelevant here.
  const tokens = body.split(" ").filter(Boolean);
  if (tokens.length > 3) return null;
  if (tokens.length === 3 && tokens[1].toLowerCase() !== "as") return null;
  return refParts(tokens[0], engine);
}
