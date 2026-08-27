// Undo the noise an engine adds when it hands back SQL it stored (issue #409).
//
// Nobody writes a view the way MySQL returns it. `SHOW CREATE VIEW` normalizes
// the definition: every identifier delimited, every term parenthesized, all on
// one line —
//
//   FROM (`clientes` `c` JOIN `pedidos` `p` ON ((`p`.`cliente_id` = `c`.`id`)))
//
// — and that is what the definition panel shows. This strips the delimiters that
// carry no meaning and collapses doubled parentheses, so the formatter gets
// something readable to lay out.
//
// It rewrites the user's SQL, so it is deliberately timid. Two rules only, both
// provable without understanding the statement:
//
//  1. A delimited identifier loses its delimiters when the name is a plain word,
//     is not reserved anywhere we support, and unquoting cannot change which
//     object it names.
//  2. A parenthesis pair whose whole content is another pair loses the outer
//     one, unless it is a call's parenthesis — `f((a,b))` means one argument and
//     `f(a,b)` means two.
//
// What it deliberately does NOT do: decide that a parenthesis is redundant from
// operator precedence. That needs the expression tree, sql-formatter does not
// build one, and a wrong answer silently changes what the query computes. So
// `WHERE (x = 1)` keeps its parenthesis even though a human would drop it.

import { engineFamily } from "./engineFamily";

/**
 * Words that must keep their delimiters: reserved in at least one of the engines
 * whose quoting this touches (MySQL/MariaDB, PostgreSQL, SQLite), or a type name
 * a bare use would be parsed as. The union is deliberate — over-keeping a pair
 * of backticks costs nothing, dropping one that mattered breaks the statement,
 * so a word reserved anywhere stays quoted everywhere.
 */
export const RESERVED: ReadonlySet<string> = new Set(
  (
    // Shared SQL core.
    "add all alter analyze and any as asc authorization begin between both by " +
    "case cast check collate column commit constraint create cross current " +
    "current_date current_time current_timestamp current_user default deferrable " +
    "delete desc distinct do drop else end except exists false fetch filter for " +
    "foreign from full grant group having if ignore in index inner insert intersect " +
    "into is isnull join key lateral leading left like limit localtime " +
    "localtimestamp natural not notnull null nulls offset on only or order outer " +
    "over primary references regexp rename replace restrict returning right rollback " +
    "row rows select session_user set some symmetric table then to trailing " +
    "transaction trigger true union unique update user using values variadic view " +
    "when where window with " +
    // MySQL extras that bite in practice.
    "accessible asensitive before call cascade change char character condition " +
    "continue convert database databases day_hour day_microsecond day_minute " +
    "day_second dec declare delayed describe deterministic distinctrow div dual " +
    "each elseif enclosed escaped exit explain float4 float8 force fulltext " +
    "generated grouping groups high_priority hour_microsecond hour_minute " +
    "hour_second infile inout insensitive int1 int2 int3 int4 int8 iterate keys " +
    "kill lead leave lines load lock long longblob longtext loop low_priority " +
    "master_bind mediumblob mediumint mediumtext middleint minute_microsecond " +
    "minute_second mod modifies no_write_to_binlog optimize option optionally out " +
    "outfile partition purge range read reads read_write real recursive release " +
    "repeat require resignal return revoke rlike schema schemas " +
    "second_microsecond sensitive separator show signal spatial specific sql " +
    "sqlexception sqlstate sqlwarning sql_big_result sql_calc_found_rows " +
    "sql_small_result ssl starting stored straight_join terminated tinyblob " +
    "tinyint tinytext undo unlock unsigned usage use utc_date utc_time " +
    "utc_timestamp varbinary varcharacter varying virtual while write xor " +
    "year_month zerofill " +
    // PostgreSQL extras.
    "analyse array asymmetric concurrently freeze ilike initially isolation " +
    "leakproof notnull placing similar tablesample verbose " +
    // SQLite extras.
    "abort action after attach autoincrement cascade conflict constraint " +
    "cross database detach each exclusive fail glob immediate indexed " +
    "instead isnull match no plan pragma query raise reindex temp temporary " +
    "vacuum virtual without " +
    // Type names: bare, several of these parse as a type and not as a column.
    "bigint binary bit blob boolean bytea char clob date datetime decimal double " +
    "float int integer interval json jsonb money numeric nvarchar precision " +
    "serial smallint text time timestamp timestamptz uuid varchar xml"
  ).split(/\s+/),
);

/** A name that needs no delimiters at all: one plain word, digits after the first. */
const BARE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** The delimiter an engine uses for identifiers, or null when it uses none. */
export function identifierQuote(engine?: string | null): string | null {
  switch (engineFamily(engine ?? "")) {
    case "mysql":
      return "`";
    case "postgres":
    case "sqlite":
      return '"';
    // Informix has no delimited identifiers (see schema.ts#quoteIdentifier), so
    // there is nothing to strip; MongoDB is not SQL. Anything unknown is left
    // alone rather than guessed at.
    default:
      return null;
  }
}

/**
 * True when `name` can be written without delimiters in `engine` and still name
 * the same thing.
 *
 * PostgreSQL is the case that needs care: it folds an undelimited name to lower
 * case, so `"Clientes"` and `Clientes` are DIFFERENT objects there and only an
 * already-lower-case name may lose its quotes. MySQL and SQLite compare names
 * case-insensitively and unquoting changes no letters, so any case is fine.
 */
export function canGoBare(name: string, engine?: string | null): boolean {
  if (!BARE.test(name)) return false;
  if (RESERVED.has(name.toLowerCase())) return false;
  if (engineFamily(engine ?? "") === "postgres" && name !== name.toLowerCase()) return false;
  return true;
}

type SpanKind = "code" | "string" | "comment" | "ident";

interface Span {
  kind: SpanKind;
  start: number;
  /** Exclusive. */
  end: number;
}

/**
 * Split `sql` into spans so the rewrites only ever touch code. A backtick inside
 * a string literal is a character in a value, not a delimiter, and the whole
 * point of scanning instead of running a regex over the text is to know the
 * difference.
 *
 * `identQuote` decides what `"` means: an identifier delimiter on the ANSI
 * engines, a string on MySQL. Dollar-quoted strings and nested block comments
 * are PostgreSQL's; recognizing them elsewhere costs nothing, since no other
 * engine produces them.
 */
export function scanSql(sql: string, identQuote: string | null): Span[] {
  const spans: Span[] = [];
  let i = 0;
  let codeStart = 0;
  const flushCode = (until: number) => {
    if (until > codeStart) spans.push({ kind: "code", start: codeStart, end: until });
  };

  while (i < sql.length) {
    const c = sql[i];

    // Line comments.
    if ((c === "-" && sql[i + 1] === "-") || c === "#") {
      flushCode(i);
      const nl = sql.indexOf("\n", i);
      const end = nl === -1 ? sql.length : nl;
      spans.push({ kind: "comment", start: i, end });
      i = codeStart = end;
      continue;
    }

    // Block comments, nested (PostgreSQL nests them; treating them as nested is
    // harmless for the engines that do not).
    if (c === "/" && sql[i + 1] === "*") {
      flushCode(i);
      let depth = 1;
      let j = i + 2;
      while (j < sql.length && depth > 0) {
        if (sql[j] === "/" && sql[j + 1] === "*") {
          depth++;
          j += 2;
        } else if (sql[j] === "*" && sql[j + 1] === "/") {
          depth--;
          j += 2;
        } else {
          j++;
        }
      }
      spans.push({ kind: "comment", start: i, end: j });
      i = codeStart = j;
      continue;
    }

    // Dollar-quoted string: $tag$ … $tag$ (the body is opaque, quotes included).
    if (c === "$") {
      const m = /^\$[A-Za-z_]?[A-Za-z0-9_]*\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        const end = close === -1 ? sql.length : close + tag.length;
        flushCode(i);
        spans.push({ kind: "string", start: i, end });
        i = codeStart = end;
        continue;
      }
    }

    // Quoted runs: a string, or an identifier when the engine delimits with this
    // character. Both close on the same character, doubled to escape it.
    if (c === "'" || c === '"' || c === "`") {
      const isIdent = identQuote !== null && c === identQuote;
      // MySQL also honours backslash escapes inside string literals; a trailing
      // backslash before the closing quote would otherwise end the string early.
      const backslash = !isIdent && identQuote === "`";
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) break;
        if (backslash && sql[j] === "\\") {
          j += 2;
          continue;
        }
        if (sql[j] === c) {
          if (sql[j + 1] === c) {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      flushCode(i);
      spans.push({ kind: isIdent ? "ident" : "string", start: i, end: Math.min(j, sql.length) });
      i = codeStart = Math.min(j, sql.length);
      continue;
    }

    i++;
  }
  flushCode(sql.length);
  return spans;
}

/** The text of an identifier span with its delimiters and doubling removed. */
function identName(raw: string, quote: string): string {
  return raw.slice(1, -1).split(quote + quote).join(quote);
}

/**
 * Drop the delimiters from every identifier that does not need them. Identifiers
 * inside strings and comments are not identifiers and are left alone.
 */
export function unquoteIdentifiers(sql: string, engine?: string | null): string {
  const quote = identifierQuote(engine);
  if (quote === null) return sql;
  let out = "";
  for (const s of scanSql(sql, quote)) {
    const raw = sql.slice(s.start, s.end);
    if (s.kind !== "ident" || raw.length < 2 || !raw.endsWith(quote)) {
      out += raw;
      continue;
    }
    const name = identName(raw, quote);
    out += canGoBare(name, engine) ? name : raw;
  }
  return out;
}

/**
 * Words after which a `(` opens a group and never an argument list. An
 * ALLOWLIST, because the safe direction is to leave a parenthesis alone: a
 * denylist of function names is a promise that no engine has one we forgot, and
 * it takes only one to change what a query computes.
 *
 * Deliberately absent are the keywords that are ALSO functions somewhere —
 * `left`, `right`, `if`, `char`, `replace`, `convert`, `mod`, `repeat`,
 * `insert`, `values`. Being a reserved word does not make a word uncallable.
 */
const GROUPING_KEYWORDS: ReadonlySet<string> = new Set(
  (
    "and as between by case do else from having in join limit offset on or " +
    "order returning select set then union using when where"
  ).split(" "),
);

/** Operators and punctuation after which a `(` opens a group. */
const GROUPING_PUNCT = new Set("=<>+-*/%!&|^~,(".split(""));

/** Identifier characters; non-ASCII counts, MySQL allows it in a bare name. */
const IDENT_CHAR = /[A-Za-z0-9_$-￿]/;

/**
 * Collapse `((x))` to `(x)`, repeatedly, outside strings and comments.
 *
 * The outer pair goes only when it is not a call's parenthesis: `f((a,b))` passes
 * one row-valued argument and `f(a,b)` passes two, so a `(` immediately after an
 * identifier character is never touched. Anything else — a pair that merely
 * looks redundant to a reader — is left exactly as written.
 */
export function collapseDoubleParens(sql: string, engine?: string | null): string {
  const quote = identifierQuote(engine);

  const pass = (text: string): string => {
    // Mask everything that is not code, so the paren matching below cannot be
    // confused by a parenthesis inside a string literal or a comment.
    const spans = scanSql(text, quote);
    const mask = new Array<boolean>(text.length).fill(false);
    for (const s of spans) {
      if (s.kind === "code") for (let k = s.start; k < s.end; k++) mask[k] = true;
    }

    // Matching close paren for every open paren, over code only.
    const match = new Map<number, number>();
    const stack: number[] = [];
    for (let k = 0; k < text.length; k++) {
      if (!mask[k]) continue;
      if (text[k] === "(") stack.push(k);
      else if (text[k] === ")") {
        const open = stack.pop();
        if (open !== undefined) match.set(open, k);
      }
    }

    const drop = new Set<number>();
    for (const [open, close] of match) {
      const inner = nextCode(text, mask, open + 1);
      if (inner === -1 || text[inner] !== "(") continue;
      const innerClose = match.get(inner);
      if (innerClose === undefined) continue;
      // The outer pair must wrap the inner one and nothing else.
      const after = nextCode(text, mask, innerClose + 1);
      if (after !== close) continue;
      // A call's parenthesis changes the argument count when unwrapped.
      if (!opensGroup(text, mask, open)) continue;
      drop.add(open);
      drop.add(close);
    }
    if (drop.size === 0) return text;
    let out = "";
    for (let k = 0; k < text.length; k++) if (!drop.has(k)) out += text[k];
    return out;
  };

  // `(((x)))` needs more than one pass; each removes one layer per nest.
  let prev = sql;
  for (let n = 0; n < 8; n++) {
    const next = pass(prev);
    if (next === prev) break;
    prev = next;
  }
  return prev;
}

/**
 * True when the `(` at `open` groups an expression rather than opening a call's
 * argument list — the only case where dropping a redundant outer pair is safe.
 */
function opensGroup(text: string, mask: boolean[], open: number): boolean {
  const before = prevCode(text, mask, open - 1);
  if (before === -1) return true; // nothing precedes it
  if (before === BLOCKED) return false; // unreadable: leave the pair alone
  const ch = text[before];
  if (GROUPING_PUNCT.has(ch)) return true;
  if (!IDENT_CHAR.test(ch)) return false;
  // Read the word back, so `on` is recognized and `json_agg` is not.
  let start = before;
  while (start > 0 && mask[start - 1] && IDENT_CHAR.test(text[start - 1])) start--;
  return GROUPING_KEYWORDS.has(text.slice(start, before + 1).toLowerCase());
}

/** Index of the next non-space code character at or after `from`, or -1. */
function nextCode(text: string, mask: boolean[], from: number): number {
  for (let k = from; k < text.length; k++) {
    if (!mask[k]) return -1; // a string/comment intervenes: not "nothing else"
    if (!/\s/.test(text[k])) return k;
  }
  return -1;
}

/**
 * Index of the previous non-space code character at or before `from`; -1 when
 * the start of the text is reached, and BLOCKED when a string or a comment
 * intervenes. The two are different answers — "nothing precedes this paren" is
 * safe, "something we cannot read precedes it" is not — and conflating them let
 * `'sum' ((a))` collapse.
 */
const BLOCKED = -2;

function prevCode(text: string, mask: boolean[], from: number): number {
  for (let k = from; k >= 0; k--) {
    if (!mask[k]) return BLOCKED;
    if (!/\s/.test(text[k])) return k;
  }
  return -1;
}

/**
 * Both rules, in the order that matters: unquoting first, so a name that has
 * just lost its delimiters is a plain identifier when the parenthesis pass looks
 * at what precedes a `(`.
 */
export function tidySql(sql: string, engine?: string | null): string {
  return collapseDoubleParens(unquoteIdentifiers(sql, engine), engine);
}
