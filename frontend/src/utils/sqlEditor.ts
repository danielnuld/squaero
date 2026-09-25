// The iPhone's SQL editor (issue #578, task 6.1, design D8): a UITextView with
// no CodeMirror behind it, so what CodeMirror gives desktop — colouring and
// completion — is worked out here, pure, and run in JavaScriptCore. Offsets are
// UTF-16 code units, JavaScript's and NSString's alike, so a span lands on the
// same characters in the text view.

import { RESERVED, identifierQuote, scanSql } from "./sqlTidy";
import { tablesInStatement } from "./queryTables";

/** The tables a statement names, to describe them for completion. */
export { tablesInStatement };

export type HighlightKind = "keyword" | "string" | "number" | "comment" | "variable" | "ident";

export interface HighlightSpan {
  kind: HighlightKind;
  start: number;
  /** Exclusive. */
  end: number;
}

/** Words coloured as keywords beyond the reserved ones: common, never a name. */
const EXTRA_KEYWORDS = ["first", "skip", "top", "count", "sum", "avg", "min", "max", "coalesce"];

const KEYWORDS: ReadonlySet<string> = new Set([...RESERVED, ...EXTRA_KEYWORDS]);

// In code: `${name}`, `:name` (not a `::` cast, not `a:b` inside a word), a
// number standing alone, or a word.
const CODE_TOKEN = /\$\{[A-Za-z_][A-Za-z0-9_]*\}|(?<![:\w]):[A-Za-z_][A-Za-z0-9_]*|\b\d+(?:\.\d+)?\b|[A-Za-z_][A-Za-z0-9_$]*/g;

/**
 * The coloured spans of `sql`, in order and never overlapping. Strings,
 * comments and quoted identifiers come from sqlTidy's scanner, so a keyword in
 * a string is part of the string; `"` is an identifier or a string by engine
 * (a string where the engine delimits none, as Informix).
 */
export function highlightSql(sql: string, engine?: string | null): HighlightSpan[] {
  const out: HighlightSpan[] = [];
  for (const span of scanSql(sql, identifierQuote(engine))) {
    if (span.kind !== "code") {
      out.push({ kind: span.kind, start: span.start, end: span.end });
      continue;
    }
    const code = sql.slice(span.start, span.end);
    for (const m of code.matchAll(CODE_TOKEN)) {
      const text = m[0];
      const start = span.start + (m.index ?? 0);
      let kind: HighlightKind | null = null;
      if (text.startsWith("$") || text.startsWith(":")) kind = "variable";
      else if (/^\d/.test(text)) kind = "number";
      else if (KEYWORDS.has(text.toLowerCase())) kind = "keyword";
      if (kind) out.push({ kind, start, end: start + text.length });
    }
  }
  return out;
}

/** Where a completion goes: the word being typed and, after `t.`, its table. */
export interface CompletionContext {
  /** Offset where the typed word starts; a completion replaces [from, cursor). */
  from: number;
  word: string;
  /** The name before the dot, unquoted, when the word follows `name.`. */
  table?: string;
}

const WORD_CHAR = /[A-Za-z0-9_$]/;

/** The word before `cursor`, and the table it is qualified with, if any. */
export function completionContext(sql: string, cursor: number): CompletionContext {
  const at = Math.max(0, Math.min(cursor, sql.length));
  let from = at;
  while (from > 0 && WORD_CHAR.test(sql[from - 1])) from--;
  const ctx: CompletionContext = { from, word: sql.slice(from, at) };
  if (from > 0 && sql[from - 1] === ".") {
    let t = from - 1;
    const quote = /["`\]]/.test(sql[t - 1] ?? "") ? sql[t - 1] : null;
    if (quote) {
      const open = quote === "]" ? "[" : quote;
      const start = sql.lastIndexOf(open, t - 2);
      if (start !== -1) ctx.table = sql.slice(start + 1, t - 1);
    } else {
      let s = t;
      while (s > 0 && WORD_CHAR.test(sql[s - 1])) s--;
      if (s < t) ctx.table = sql.slice(s, t);
    }
  }
  return ctx;
}

/** What the editor knows of the schema: table names, and the columns of the
    tables it has described so far, keyed by table name. */
export interface EditorSchema {
  tables: string[];
  columns: Record<string, string[]>;
}

function columnsOf(schema: EditorSchema, table: string): string[] {
  const key = Object.keys(schema.columns).find((k) => k.toLowerCase() === table.toLowerCase());
  return key ? schema.columns[key] : [];
}

/**
 * The suggestions for `ctx` in `sql`, best first, without duplicates: after
 * `t.` the columns of t; otherwise the columns of the tables the statement
 * names, then tables, then keywords (in upper case). Prefix match, any case;
 * the word itself, typed in full, is not suggested back. Nothing for an empty
 * word, so the row does not fill on every space.
 */
export function completionItems(
  sql: string,
  ctx: CompletionContext,
  schema: EditorSchema,
  limit = 12,
): string[] {
  const word = ctx.word.toLowerCase();
  const pool: string[] = [];
  if (ctx.table !== undefined) {
    pool.push(...columnsOf(schema, ctx.table));
  } else {
    if (word === "") return [];
    for (const t of tablesInStatement(sql)) pool.push(...columnsOf(schema, t));
    pool.push(...schema.tables);
    for (const k of KEYWORDS) pool.push(k.toUpperCase());
  }
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of pool) {
    const low = item.toLowerCase();
    if (!low.startsWith(word) || low === word || seen.has(low)) continue;
    seen.add(low);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}
