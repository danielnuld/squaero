// Search a text across the tables of a database or schema (issue #671): find a
// value without knowing which table holds it.
//
// One bounded SELECT per table, ORing a predicate per searchable column. The
// column set comes from schema.describe's DECLARED type (the engine's own name:
// `character varying(40)`, `NVARCHAR`, `int(11)`, …), so the classification is
// tolerant pattern matching rather than an exact list. Identifiers are quoted
// and tables qualified per engine (utils/schema), the row cap is spelled per
// engine (utils/pagination), string literals are escaped per engine
// (utils/backup). Pure, except runSearch, which takes the query runner injected.

import { engineFamily } from "./engineFamily";
import { previewSelect } from "./pagination";
import { qualifiedName, quoteIdentifier } from "./schema";
import { sqlLiteral } from "./backup";
import { errorText } from "./errors";

export type MatchMode = "contains" | "exact" | "startsWith";

export interface SearchOptions {
  text: string;
  mode: MatchMode;
  /** Fold case on both sides (ILIKE on Postgres, LOWER() elsewhere). Off, the
      column's own collation decides — MySQL/SQL Server/SQLite often ignore case
      anyway, which is the engine's call, not ours. */
  ignoreCase: boolean;
  /** Also compare numeric columns, by exact value, when the text is a number. */
  numeric: boolean;
  /** Rows read per table at most. */
  limit: number;
}

export const DEFAULT_LIMIT = 100;
export const MAX_LIMIT = 10000;

/** The per-table cap, floored into [1, MAX_LIMIT]; junk becomes the default. */
export function clampLimit(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(n)));
}

/**
 * Why a search cannot start, as an i18n key, or null when it can. An empty text
 * would match every row of every table, which is a full dump, not a search.
 */
export function searchRefusal(engine: string, opts: SearchOptions): string | null {
  // ponytail: MongoDB could run a find with $regex per string field; not built.
  if (engineFamily(engine) === "mongodb") return "ds.unsupportedMongo";
  if (opts.text.trim() === "") return "ds.emptyText";
  return null;
}

const NUMERIC_TYPE =
  /\b(tinyint|smallint|mediumint|int|integer|bigint|int2|int4|int8|serial|serial8|bigserial|smallserial|float|float4|float8|smallfloat|double|decimal|dec|numeric|number|real|money|smallmoney)\b/;

/**
 * Whether a column of declared `type` is searched as text, as a number, or not
 * at all. Arrays are skipped (LOWER/LIKE reject them). Informix TEXT/CLOB and
 * SQL Server text/ntext are skipped too: they are large-object types that
 * LOWER() rejects on those engines.
 */
export function columnKind(type: string, engine: string): "text" | "number" | null {
  const t = type.trim().toLowerCase();
  if (t === "" || t.endsWith("]")) return null;
  const family = engineFamily(engine);
  if (family === "informix") {
    if (/^(n?char|n?varchar|lvarchar)\b/.test(t)) return "text";
  } else if (family === "mssql") {
    if (/char|^sysname$/.test(t)) return "text";
  } else if (/char|text|clob|^enum\b/.test(t)) {
    return "text";
  }
  return NUMERIC_TYPE.test(t) ? "number" : null;
}

/** The LIKE escape character every generated pattern uses. */
const ESC = "!";

/**
 * The LIKE pattern for `text` under `mode`: `%`, `_` and the escape character
 * itself are escaped so they match literally; on SQL Server `[` too, which T-SQL
 * LIKE reads as the start of a character class.
 */
export function likePattern(text: string, mode: "contains" | "startsWith", engine: string): string {
  const special = engineFamily(engine) === "mssql" ? /[!%_[]/g : /[!%_]/g;
  const body = text.replace(special, (c) => ESC + c);
  return (mode === "contains" ? "%" : "") + body + "%";
}

const NUMBER = /^-?\d+(\.\d+)?$/;

/** One column's predicate, or null when the column takes no part. */
function predicate(
  column: string,
  kind: "text" | "number",
  engine: string,
  opts: SearchOptions,
): string | null {
  const col = quoteIdentifier(column, engine);
  if (kind === "number") {
    const n = opts.text.trim();
    return opts.numeric && NUMBER.test(n) ? `${col} = ${n}` : null;
  }
  const family = engineFamily(engine);
  // N'…' on SQL Server, or text outside the server's code page is lost.
  const lit = (s: string) => (family === "mssql" ? "N" : "") + sqlLiteral(s, engine);
  if (opts.mode === "exact") {
    return opts.ignoreCase ? `LOWER(${col}) = LOWER(${lit(opts.text)})` : `${col} = ${lit(opts.text)}`;
  }
  const pattern = likePattern(opts.text, opts.mode, engine);
  const esc = ` ESCAPE '${ESC}'`;
  if (!opts.ignoreCase) return `${col} LIKE ${lit(pattern)}${esc}`;
  if (family === "postgres") return `${col} ILIKE ${lit(pattern)}${esc}`;
  // Informix only takes a quoted string after LIKE, not an expression, so its
  // pattern is lower-cased here instead of by the server.
  if (family === "informix") return `LOWER(${col}) LIKE ${lit(pattern.toLowerCase())}${esc}`;
  return `LOWER(${col}) LIKE LOWER(${lit(pattern)})${esc}`;
}

/** A table to search, as the object tree names it. */
export interface TableRef {
  name: string;
  db?: string;
  schema?: string;
}

export type TablePlan =
  | { sql: string; openSql: string; columns: string[] }
  | { skipped: string };

/**
 * The bounded search query for one table (`sql`, capped at opts.limit) and the
 * same filter uncapped (`openSql`, what "open the matches" runs in a query tab,
 * where the grid pages it). `columns` is the declared type per column, as
 * utils/edit describeColumnTypes reads it. A table with no column the search can
 * apply to is skipped with a reason (an i18n key), never queried for nothing.
 */
export function planTable(
  table: TableRef,
  columns: Record<string, string>,
  engine: string,
  opts: SearchOptions,
): TablePlan {
  const used: string[] = [];
  const preds: string[] = [];
  for (const [name, type] of Object.entries(columns)) {
    const kind = columnKind(type, engine);
    const p = kind && predicate(name, kind, engine, opts);
    if (p) {
      used.push(name);
      preds.push(p);
    }
  }
  if (preds.length === 0) return { skipped: "ds.skipNoColumns" };
  const where = preds.join(" OR ");
  const qualified = qualifiedName(table, engine);
  return {
    sql: previewSelect(qualified, engine, clampLimit(opts.limit), 0, where),
    openSql: previewSelect(qualified, engine, 0, 0, where),
    columns: used,
  };
}

/** What one table came back with. */
export interface TableResult {
  table: string;
  /** Rows matched (at most the limit). */
  count: number;
  /** The cap was reached: there may be more, shown as "≥ count". */
  capped: boolean;
  /** Uncapped SELECT of the matches, for opening them. */
  openSql?: string;
  /** i18n key: the table was not searched. */
  skipped?: string;
  /** The describe or the query failed. */
  error?: string;
}

/** "N", or "≥ N" when the per-table cap was hit — never a silent cut. */
export function matchLabel(r: Pick<TableResult, "count" | "capped">): string {
  return r.capped ? `≥ ${r.count}` : String(r.count);
}

/** How the search reaches the database; injected so runSearch is testable. */
export interface SearchIo {
  /** Declared type per column of a table. */
  describe: (table: TableRef) => Promise<Record<string, string>>;
  /** Run one SELECT and resolve with how many rows came back. */
  count: (sql: string) => Promise<number>;
}

/**
 * Describe, plan and run the search table by table, in order. `stopped` is
 * checked between tables, so Cancel never starts another query (the running one
 * is the caller's to cancel with op.cancel). `onProgress(i, total, table)` fires
 * before table i (1-based). A failing table is recorded and the search goes on.
 */
export async function runSearch(
  tables: TableRef[],
  engine: string,
  opts: SearchOptions,
  io: SearchIo,
  stopped: () => boolean,
  onProgress?: (i: number, total: number, table: string) => void,
): Promise<{ results: TableResult[]; stopped: boolean }> {
  const limit = clampLimit(opts.limit);
  const results: TableResult[] = [];
  for (let i = 0; i < tables.length; i++) {
    if (stopped()) return { results, stopped: true };
    const table = tables[i].name;
    onProgress?.(i + 1, tables.length, table);
    try {
      const plan = planTable(tables[i], await io.describe(tables[i]), engine, opts);
      if ("skipped" in plan) {
        results.push({ table, count: 0, capped: false, skipped: plan.skipped });
        continue;
      }
      const count = await io.count(plan.sql);
      results.push({ table, count, capped: count >= limit, openSql: plan.openSql });
    } catch (err) {
      // A cancel surfaces as the running query's error: that is a stop, not a failure.
      if (stopped()) return { results, stopped: true };
      results.push({ table, count: 0, capped: false, error: errorText(err) });
    }
  }
  return { results, stopped: false };
}
