// Decide what SQL to run (issues #130, #691). Pure logic, no CodeMirror
// dependency: the editor passes in the document text and the current selection
// range, and gets back the text to execute, where it sits in the document (so
// the editor can highlight what will run) and a scope tag that names it.
//
// Three scopes, chosen explicitly (M14, R-04):
//   - "selection": a non-empty selection runs verbatim.
//   - "statement": the statement under the cursor.
//   - "document": the whole script, however many statements it holds — they go
//     to the engine one by one and each gets its own result tab (issue #450).
//
// Ctrl/Cmd+Enter asks for no scope in particular and gets the selection, else
// the statement under the cursor. That rule was dropped once (writing three
// queries and pressing «Ejecutar» ran one of them, with nothing to say the
// other two had been skipped); it is back because the button now NAMES the
// scope («Ejecutar sentencia») and the editor highlights the statement that
// will run, so nothing is skipped in silence. The whole script is one explicit
// step away: Ctrl/Cmd+Shift+Enter or the run button's menu.

import { engineFamily } from "./engineFamily";

export type RunScope = "selection" | "statement" | "document";

export interface RunTarget {
  /** The raw SQL slice to execute; the caller trims/validates it. */
  text: string;
  scope: RunScope;
  /** Where `text` sits in the document: `doc.slice(from, to) === text`. */
  from: number;
  to: number;
}

/** A top-level statement segment, as a half-open range into the source. */
export interface Statement {
  /** Offset of the segment start (inclusive). */
  from: number;
  /** Offset of the segment end (exclusive), at the separating ';' or EOF. */
  to: number;
  /** The raw slice `source.slice(from, to)`. */
  text: string;
}

// Parser states while scanning for statement-separating semicolons. Semicolons
// inside string literals, quoted identifiers or comments do not split.
const enum S {
  Normal,
  Single, // '...'
  Double, // "..."
  Back, //   `...`  (MySQL/MariaDB quoted identifier)
  Line, //   -- ... EOL
  Block, //  /* ... */
}

/** The head of a statement that creates a routine, and which kind it creates. */
const ROUTINE_HEAD =
  /\bcreate\b[\s\S]{0,300}?\b(procedure|function|trigger|event)\b/i;

/** Words after END that close an inner construct, not the routine body. */
const END_INNER = /^(?:if|loop|while|for|case|repeat)\b/i;

/** `END PROCEDURE` / `END FUNCTION` / `END TRIGGER`: Informix ends a body so. */
const END_BODY = /^(?:procedure|function|trigger)\b/i;

const isWordChar = (c: string | undefined) => c !== undefined && /[A-Za-z0-9_$]/.test(c);

/**
 * Split SQL into contiguous top-level statements separated by `;`. The returned
 * segments cover the whole source with no gaps (so the last, semicolon-less
 * statement is included). Semicolons inside single/double/backtick quotes, line
 * comments (`-- … EOL`), block comments (`/* … *​/`), dollar-quoted strings
 * (Postgres `$tag$…$tag$`) and routine bodies are ignored. Quotes may be escaped
 * by doubling (`''`, `""`, `` `` ` ``) or, inside string literals, by a backslash
 * (MySQL's default `sql_mode`).
 *
 * The routine rule (issue #456): a stored procedure, function or trigger is one
 * statement whose body is full of semicolons, so splitting on them turned every
 * routine DDL into a fistful of syntax errors — which is why a routine's own
 * definition could not be run back. Inside a `CREATE … PROCEDURE/FUNCTION/
 * TRIGGER/EVENT`, a `;` separates nothing until the body closes: `BEGIN` opens
 * one and the matching `END` closes it (`END IF`/`END LOOP`/… close inner
 * constructs and do not count), and `END PROCEDURE`/`END FUNCTION` closes an
 * Informix body, which has no BEGIN at all. Hence `engine`: only Informix
 * routines swallow semicolons with no BEGIN in sight; everywhere else a bodyless
 * one-line trigger still ends at its first `;`.
 *
 * Still a heuristic, not a parser — but the shapes it now misses (a `BEGIN` in a
 * string it cannot see, a dialect that ends its body some third way) no longer
 * include the routine DDL every engine hands back.
 */
export function splitStatements(sql: string, engine?: string): Statement[] {
  const out: Statement[] = [];
  const informix = engineFamily(engine ?? "") === "informix";
  let state = S.Normal;
  let start = 0;
  // Routine-body tracking for the statement being scanned, reset at every split.
  // `kind` is resolved lazily — only when a `;`, BEGIN or END asks — so the head
  // it tests against is already in the segment.
  let kind: string | null | undefined;
  let depth = 0; // unmatched BEGINs
  let sawBegin = false;
  let bodyDone = false;
  const routineKind = (to: number): string | null => {
    if (kind === undefined) kind = (ROUTINE_HEAD.exec(sql.slice(start, to))?.[1] ?? null);
    return kind ? kind.toLowerCase() : null;
  };
  const push = (to: number) => {
    out.push({ from: start, to, text: sql.slice(start, to) });
    kind = undefined;
    depth = 0;
    sawBegin = false;
    bodyDone = false;
  };
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];
    switch (state) {
      case S.Normal:
        if (c === "'") state = S.Single;
        else if (c === '"') state = S.Double;
        else if (c === "`") state = S.Back;
        else if (c === "-" && next === "-") {
          state = S.Line;
          i++;
        } else if (c === "/" && next === "*") {
          state = S.Block;
          i++;
        } else if (c === "$" && !isWordChar(sql[i - 1])) {
          // Dollar-quoted string (Postgres): skip to the matching close tag. An
          // unclosed one is a literal `$`, not a runaway string.
          const tag = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(sql.slice(i))?.[0];
          const close = tag ? sql.indexOf(tag, i + tag.length) : -1;
          if (tag && close >= 0) i = close + tag.length - 1;
        } else if (/[A-Za-z]/.test(c) && !isWordChar(sql[i - 1])) {
          const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(sql.slice(i))![0];
          const lower = word.toLowerCase();
          if ((lower === "begin" || lower === "end") && routineKind(i)) {
            const after = sql.slice(i + word.length).trimStart();
            if (lower === "begin") {
              depth++;
              sawBegin = true;
            } else if (END_INNER.test(after)) {
              /* END IF / END LOOP / …: closes what BEGIN never opened. */
            } else if (END_BODY.test(after)) {
              depth = 0;
              bodyDone = true;
            } else {
              depth = Math.max(0, depth - 1);
              if (depth === 0) bodyDone = true;
            }
          }
          i += word.length - 1;
        } else if (c === ";") {
          // Inside an unfinished routine body the semicolon separates nothing.
          const k = routineKind(i);
          const inBody = !bodyDone && (sawBegin || (informix && k !== null && k !== "trigger"));
          if (k && inBody) break;
          push(i);
          start = i + 1;
        }
        break;
      case S.Single:
        // A backslash escapes the next char (MySQL default); '' is a doubled quote.
        if (c === "\\") i++;
        else if (c === "'") {
          if (next === "'") i++;
          else state = S.Normal;
        }
        break;
      case S.Double:
        if (c === "\\") i++;
        else if (c === '"') {
          if (next === '"') i++;
          else state = S.Normal;
        }
        break;
      case S.Back:
        // Backtick identifiers escape only by doubling; no backslash escape.
        if (c === "`") {
          if (next === "`") i++;
          else state = S.Normal;
        }
        break;
      case S.Line:
        if (c === "\n") state = S.Normal;
        break;
      case S.Block:
        if (c === "*" && next === "/") {
          state = S.Normal;
          i++;
        }
        break;
    }
  }
  push(sql.length);
  return out;
}

/**
 * True when a piece of SQL is nothing but comments and whitespace (issue #653).
 * `--` and `/* *​/` everywhere, plus `#` on MySQL/MariaDB and `{ }` on Informix.
 * Engines reject such a piece (Informix: syntax error, MySQL: "Query was
 * empty"), and it is what a comment after a statement's `;` splits into.
 */
export function isCommentOnly(sql: string, engine?: string): boolean {
  const family = engineFamily(engine ?? "");
  const comment =
    family === "mysql"
      ? /--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\//g
      : family === "informix"
        ? /--[^\n]*|\{[^}]*\}|\/\*[\s\S]*?\*\//g
        : /--[^\n]*|\/\*[\s\S]*?\*\//g;
  return sql.replace(comment, "").trim() === "";
}

/** The statements of a script worth sending, trimmed, in order. */
export function runnableStatements(sql: string, engine?: string): string[] {
  return splitStatements(sql, engine)
    .map((s) => s.text.trim())
    .filter((s) => !isCommentOnly(s, engine));
}

/**
 * The statement under the cursor at `pos`, as a range with the surrounding
 * whitespace trimmed (the closing `;` excluded). A cursor right after a `;`, or
 * on a blank line or comment between statements, belongs to the statement
 * before it — the one just written — else to the next. Null when the document
 * holds nothing runnable.
 */
export function statementAt(
  doc: string,
  pos: number,
  engine?: string,
): { from: number; to: number } | null {
  const ranges = splitStatements(doc, engine)
    .filter((s) => !isCommentOnly(s.text, engine))
    .map((s) => {
      const lead = s.text.length - s.text.trimStart().length;
      return { from: s.from + lead, to: s.from + s.text.trimEnd().length };
    });
  if (ranges.length === 0) return null;
  // `to + 1` takes in the `;` that closes it: the cursor right after it.
  const inside = ranges.find((r) => pos >= r.from && pos <= r.to + 1);
  if (inside) return inside;
  const before = ranges.filter((r) => r.to < pos);
  return before.length ? before[before.length - 1] : ranges[0];
}

/**
 * Choose the SQL to execute given the document and the selection range. Ranges
 * are character offsets; `selFrom === selTo` means no selection.
 *
 * `want` names the scope; omitted (Ctrl/Cmd+Enter) it is the selection when
 * there is one, else the statement under the cursor. Asking for the selection
 * with nothing selected gets the statement: the menu disables that entry, and
 * running nothing is never what was meant. A document with nothing runnable
 * yields the whole (blank) document, which the caller rejects as empty.
 */
export function pickRunTarget(
  doc: string,
  selFrom: number,
  selTo: number,
  want?: RunScope,
  engine?: string,
): RunTarget {
  const from = Math.min(selFrom, selTo);
  const to = Math.max(selFrom, selTo);
  const whole: RunTarget = { text: doc, scope: "document", from: 0, to: doc.length };
  if (want === "document") return whole;
  if (from !== to && want !== "statement") {
    return { text: doc.slice(from, to), scope: "selection", from, to };
  }
  const stmt = statementAt(doc, from, engine);
  if (!stmt) return whole;
  return { text: doc.slice(stmt.from, stmt.to), scope: "statement", ...stmt };
}
