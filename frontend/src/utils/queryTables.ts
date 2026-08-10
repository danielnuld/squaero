// Which tables a statement mentions, so their columns can be fetched for
// autocomplete before the user needs them.
//
// This is a different question from utils/queryTarget.ts, which asks "does this
// read exactly ONE table, whole rows?" and answers null for anything reshaped — a
// join, a comma list, a subquery. That strictness is right there, because it guards
// row editing. For completions the opposite is wanted: every table named anywhere,
// joins very much included, since those are precisely the queries where remembering
// column names is hardest.
//
// The scrubber is shared with queryTarget so a keyword inside a string literal or a
// comment cannot be mistaken for a table.

import { scrub } from "./queryTarget";

/**
 * Table names referenced by `sql`, unqualified and unquoted, in first-seen order.
 *
 * Names come back as the last dotted segment because that is how the tree labels
 * objects and how the column cache is keyed: `ventas.public.clientes` and
 * `clientes` are the same table as far as completing its columns goes.
 *
 * Deliberately a scan and not a parser. It looks for the places a table name can
 * follow a keyword, which covers what people actually type; a real SQL grammar
 * would be far more code for completions that are a convenience, not a contract.
 */
export function tablesInStatement(sql: string): string[] {
  const text = scrub(sql);
  const out: string[] = [];
  const seen = new Set<string>();

  // A name may be quoted ("a"/`a`/[a]) and dotted. Captured whole, split after.
  const NAME = String.raw`((?:"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\]|[A-Za-z_][\w$]*)(?:\s*[.:]\s*(?:"[^"]+"|\x60[^\x60]+\x60|\[[^\]]+\]|[A-Za-z_][\w$]*))*)`;
  // Every keyword a table name can follow. INTO covers INSERT INTO; UPDATE and
  // the FROM of DELETE are the write paths, where column help matters just as much.
  const pattern = new RegExp(
    String.raw`\b(?:from|join|into|update)\s+` + NAME,
    "gi",
  );

  for (const match of text.matchAll(pattern)) {
    const raw = match[1];
    if (raw === undefined) {
      continue;
    }
    const name = bareName(raw);
    // A subquery reads "from (" — the scan already skipped it, since "(" is not a
    // name character. Keywords can still slip in on malformed input; drop them.
    if (name === "" || KEYWORDS.has(name.toLowerCase()) || seen.has(name)) {
      continue;
    }
    seen.add(name);
    out.push(name);
  }
  return out;
}

/** Last segment of a possibly qualified, possibly quoted name, unquoted. */
function bareName(raw: string): string {
  const parts = raw.split(/\s*[.:]\s*/);
  const last = parts[parts.length - 1] ?? "";
  return last.replace(/^["`[]/, "").replace(/["`\]]$/, "").trim();
}

/**
 * Words that are never a table, for when the scan lands on one.
 *
 * The keywords the pattern itself matches on are in here too: "FROM FROM" would
 * otherwise report a table called FROM.
 */
const KEYWORDS = new Set([
  // What the pattern searches for, so a repeat cannot be read as a name.
  "from",
  "join",
  "into",
  "update",
  "inner",
  "outer",
  "left",
  "right",
  "full",
  "cross",
  // Clauses that can follow where a name was expected.
  "select",
  "where",
  "group",
  "having",
  "order",
  "limit",
  "offset",
  "union",
  "intersect",
  "except",
  "minus",
  "set",
  "values",
  "on",
  "using",
  "as",
  "lateral",
  "only",
  "table",
]);
