// Decide what SQL to run when the user presses Ctrl/Cmd+Enter (issue #130).
// Pure logic, no CodeMirror dependency: the editor passes in the document text
// and the current selection range, and gets back the text to execute plus a
// scope tag used to tell the user what actually ran.
//
// Two rules, and only two:
//   - A non-empty selection runs verbatim ("selección").
//   - Otherwise the whole document runs ("documento"), however many statements
//     it holds — they go to the engine one by one and each gets its own result
//     tab (issue #450).
//
// It used to run the STATEMENT UNDER THE CURSOR whenever the document held more
// than one, which is what a scratch buffer of queries wants but not what the
// button says: writing three queries and pressing Ejecutar ran one of them,
// with nothing to say the other two had been skipped. Running a single
// statement on purpose is what selecting it is for.

import { engineFamily } from "./engineFamily";

export type RunScope = "selection" | "document";

export interface RunTarget {
  /** The raw SQL slice to execute; the caller trims/validates it. */
  text: string;
  scope: RunScope;
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
 * Choose the SQL to execute given the document and the selection range. Ranges
 * are character offsets; `selFrom === selTo` means no selection.
 *
 * `scopeLabel` used to live below this: a hardcoded Spanish label with no
 * caller, since the status bar and the snippet banner both translate the scope
 * through i18n. It went with the statement rule.
 */
export function pickRunTarget(doc: string, selFrom: number, selTo: number): RunTarget {
  if (selFrom !== selTo) {
    const from = Math.min(selFrom, selTo);
    const to = Math.max(selFrom, selTo);
    return { text: doc.slice(from, to), scope: "selection" };
  }
  return { text: doc, scope: "document" };
}
