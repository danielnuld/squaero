// Decide what SQL to run when the user presses Ctrl/Cmd+Enter (issue #130).
// Pure logic, no CodeMirror dependency: the editor passes in the document text,
// the current selection range and the cursor offset, and gets back the text to
// execute plus a scope tag used to tell the user what actually ran.
//
// Rules:
//   - A non-empty selection runs verbatim ("selección").
//   - Otherwise, when the document holds more than one statement, the statement
//     under the cursor runs ("sentencia").
//   - Otherwise the whole document runs ("documento").

export type RunScope = "selection" | "statement" | "document";

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

/**
 * Split SQL into contiguous top-level statements separated by `;`. The returned
 * segments cover the whole source with no gaps (so the last, semicolon-less
 * statement is included). Semicolons inside single/double/backtick quotes, line
 * comments (`-- … EOL`) and block comments (`/* … *​/`) are ignored. Quotes may
 * be escaped by doubling (`''`, `""`, `` `` ` ``) or, inside string literals, by
 * a backslash (MySQL's default `sql_mode`).
 *
 * Heuristic, not a full SQL parser: it does not understand dollar-quoted strings
 * (Postgres `$tag$…$tag$`) nor compound bodies (`BEGIN … END` in a stored
 * procedure/trigger), so a `;` inside such a body is treated as a separator.
 */
export function splitStatements(sql: string): Statement[] {
  const out: Statement[] = [];
  let state = S.Normal;
  let start = 0;
  const push = (to: number) => out.push({ from: start, to, text: sql.slice(start, to) });
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
        } else if (c === ";") {
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
 * Choose the SQL to execute given the document, the selection range and the
 * cursor. See the module comment for the rules. Ranges are character offsets;
 * `selFrom === selTo` means no selection.
 */
export function pickRunTarget(
  doc: string,
  selFrom: number,
  selTo: number,
  cursor: number,
): RunTarget {
  if (selFrom !== selTo) {
    const from = Math.min(selFrom, selTo);
    const to = Math.max(selFrom, selTo);
    return { text: doc.slice(from, to), scope: "selection" };
  }

  const segments = splitStatements(doc);
  const nonEmpty = segments.filter((s) => s.text.trim() !== "");
  if (nonEmpty.length <= 1) {
    return { text: doc, scope: "document" };
  }

  // Find the segment the cursor sits in; a cursor between statements (in
  // whitespace or on a separator) resolves to the nearest non-empty statement,
  // preferring the one before it.
  let idx = segments.findIndex((s) => cursor >= s.from && cursor <= s.to);
  if (idx === -1) idx = segments.length - 1;
  if (segments[idx].text.trim() === "") {
    let j = idx;
    while (j >= 0 && segments[j].text.trim() === "") j--;
    if (j < 0) {
      j = idx;
      while (j < segments.length && segments[j].text.trim() === "") j++;
    }
    idx = Math.min(Math.max(j, 0), segments.length - 1);
  }
  return { text: segments[idx].text, scope: "statement" };
}

/** Human-readable Spanish label for a run scope, for the status indicator. */
export function scopeLabel(scope: RunScope): string {
  switch (scope) {
    case "selection":
      return "selección";
    case "statement":
      return "sentencia";
    default:
      return "documento";
  }
}
