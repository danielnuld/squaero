// A small SQL tokenizer for the editor's semantic layer (issue #660).
//
// The scope resolver in sqlScope.ts needs words, quoted names and punctuation
// with their exact offsets, and nothing from inside strings or comments. The
// string/comment/identifier split is sqlTidy's scanner — the one place that
// already knows MySQL backslash escapes, nested and dollar-quoted runs — so this
// only cuts its code spans into tokens and adds the two delimiters it does not
// know: SQL Server's `[x]` and Informix's `{ comment }`.
//
// Offsets are UTF-16 indices into the text passed in, so they land on the same
// characters CodeMirror counts.

import { engineFamily } from "./engineFamily";
import { scanSql } from "./sqlTidy";

export type SqlTokenKind =
  /** A bare word: a keyword or an undelimited name. */
  | "word"
  /** A delimited identifier: `"x"`, `` `x` `` or `[x]`. */
  | "quoted"
  | "string"
  | "number"
  /** A bind parameter or variable: `?`, `$1`, `:name`, `@x`, `${name}`. */
  | "param"
  /** One punctuation/operator character, or `::`. */
  | "punct";

export interface SqlToken {
  kind: SqlTokenKind;
  start: number;
  /** Exclusive. */
  end: number;
  /** The source text, `sql.slice(start, end)`. */
  text: string;
  /** For `quoted`, the name without delimiters or doubling; otherwise `text`. */
  value: string;
}

/**
 * What `"` means per engine. Unlike sqlTidy's `identifierQuote` (which only
 * names engines whose quotes it may strip), this has to classify every
 * engine: SQL Server delimits with `"` too (QUOTED_IDENTIFIER is on by default),
 * Informix delimits nothing so `"x"` is a string, and an unknown engine is read
 * the ANSI way.
 */
function quoteFor(family: string): string | null {
  if (family === "mysql") return "`";
  if (family === "informix") return null;
  return '"';
}

const CODE_TOKEN =
  /\s+|\$\{[\p{L}_][\p{L}\p{N}_]*\}|\$\d+|::|:[\p{L}_][\p{L}\p{N}_]*|@@?[\p{L}_][\p{L}\p{N}_]*|\?|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+|[\p{L}_][\p{L}\p{N}_$]*|[\s\S]/gu;

/**
 * The tokens of `sql`, in order, without whitespace or comments. Never throws:
 * an unterminated string or delimiter runs to the end of the text, as the
 * scanner already does.
 */
export function tokenizeSql(sql: string, engine?: string | null): SqlToken[] {
  const family = engineFamily(engine ?? "");
  const quote = quoteFor(family);
  const out: SqlToken[] = [];
  const push = (kind: SqlTokenKind, start: number, end: number, value?: string) => {
    const text = sql.slice(start, end);
    out.push({ kind, start, end, text, value: value ?? text });
  };

  for (const span of scanSql(sql, quote)) {
    if (span.kind === "comment") continue;
    if (span.kind === "string") {
      push("string", span.start, span.end);
      continue;
    }
    if (span.kind === "ident") {
      const raw = sql.slice(span.start, span.end);
      const q = raw[0];
      const closed = raw.length > 1 && raw.endsWith(q);
      const body = closed ? raw.slice(1, -1) : raw.slice(1);
      push("quoted", span.start, span.end, body.split(q + q).join(q));
      continue;
    }
    // Code: cut into tokens, honouring the delimiters scanSql does not know.
    let i = span.start;
    while (i < span.end) {
      const c = sql[i];
      if (c === "[" && family === "mssql") {
        let j = i + 1;
        while (j < span.end && !(sql[j] === "]" && sql[j + 1] !== "]")) j += sql[j] === "]" ? 2 : 1;
        const end = Math.min(j + 1, span.end);
        push("quoted", i, end, sql.slice(i + 1, j).split("]]").join("]"));
        i = end;
        continue;
      }
      if (c === "{" && family === "informix") {
        const close = sql.indexOf("}", i);
        i = close === -1 || close >= span.end ? span.end : close + 1;
        continue;
      }
      CODE_TOKEN.lastIndex = i;
      const m = CODE_TOKEN.exec(sql)!;
      let end = i + m[0].length;
      if (end > span.end) end = span.end;
      const text = sql.slice(i, end);
      if (!/^\s/.test(text)) {
        const kind: SqlTokenKind = /^[\p{L}_]/u.test(text)
          ? "word"
          : /^[\d.]/.test(text) && text !== "."
            ? "number"
            : text === "?" || (/^[$:@]/.test(text) && text.length > 1 && text !== "::")
              ? "param"
              : "punct";
        push(kind, i, end);
      }
      i = end;
    }
  }
  return out;
}
