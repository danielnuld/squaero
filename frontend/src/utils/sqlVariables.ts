// Variables in the editor's SQL (issue #481): `:nombre` for a value and
// `${nombre}` for raw text, filled in when the statement runs.
//
// Two forms because they answer two different needs, and conflating them makes
// one of them wrong. `:nombre` stands where a VALUE goes, so it is written out
// as a SQL literal — quoted, with the quotes inside it doubled, or bare when it
// is a number so `LIMIT :n` is still valid SQL. `${nombre}` stands for whatever
// the user typed, verbatim, which is the only way to parameterize a table name
// or a fragment of a WHERE. Raw substitution can produce nonsense SQL; that is
// its purpose and its cost, and it is why the value form is not raw.
//
// The scan skips string literals, quoted identifiers and comments, so a time in
// a string ('12:30'), a Postgres cast (x::text) and a commented-out draft are
// not variables. It is a scanner, not a parser — the same honest heuristic
// splitStatements uses (utils/runScope.ts), kept separate here because that one
// carries routine-body logic this has no use for.
//
// MongoDB gets only `${nombre}`: its surface is `db.c.find({a: 1})`, where a
// colon is punctuation on every line, and a variable form that fires on the
// language's own syntax is worse than not having it.

import { engineFamily } from "./engineFamily";

/** How a variable is written into the SQL when it runs. */
export type VarKind =
  /** `:nombre` — a value, emitted as a SQL literal. */
  | "value"
  /** `${nombre}` — text, emitted exactly as typed. */
  | "raw";

export interface SqlVariable {
  /** The bare name, without its punctuation. */
  name: string;
  kind: VarKind;
  /** How it appears in the SQL, and the key its value is stored under. */
  token: string;
}

/** What the user supplied for one variable. */
export interface VarValue {
  text: string;
  /** The value form only: write the SQL keyword NULL instead of a literal. An
      explicit switch rather than the word "NULL" typed in the box, so a row
      whose value really is the text "NULL" stays possible (the rule the grid
      already follows for editing a cell — issue #398). */
  isNull?: boolean;
}

/** Values by token, e.g. `{ ":desde": { text: "2026-01-01" } }`. */
export type VarValues = Record<string, VarValue>;

/** The token a variable of this kind and name is written as. */
export function varToken(name: string, kind: VarKind): string {
  return kind === "raw" ? `\${${name}}` : `:${name}`;
}

const NAME_START = /[A-Za-z_]/;
const NAME_CHAR = /[A-Za-z0-9_]/;

/** Reads a variable name at `i`, or null when there is no name there. */
function readName(sql: string, i: number): string | null {
  if (i >= sql.length || !NAME_START.test(sql[i])) return null;
  let end = i;
  while (end < sql.length && NAME_CHAR.test(sql[end])) end++;
  return sql.slice(i, end);
}

/**
 * Every variable in `sql`, in the order it first appears, each one once.
 *
 * A name may appear as both forms; they are different variables and keep
 * separate values, because `:x` and `${x}` do different things to the SQL.
 */
export function findVariables(sql: string, engine?: string): SqlVariable[] {
  const found: SqlVariable[] = [];
  const seen = new Set<string>();
  const add = (name: string, kind: VarKind) => {
    const token = varToken(name, kind);
    if (seen.has(token)) return;
    seen.add(token);
    found.push({ name, kind, token });
  };
  scan(sql, engine, add);
  return found;
}

/**
 * `sql` with every variable replaced by its value: a literal for `:nombre`, the
 * text as typed for `${nombre}`.
 *
 * A variable with no value is left exactly as it is rather than dropped — the
 * caller asks for the missing ones first (missingVariables), and SQL that still
 * carries `:desde` fails with a message that names it, which beats a statement
 * silently missing a comparison.
 */
export function applyVariables(sql: string, values: VarValues, engine?: string): string {
  let out = "";
  let copied = 0;
  scan(sql, engine, (name, kind, from, to) => {
    const token = varToken(name, kind);
    const value = values[token];
    if (value === undefined) return;
    out += sql.slice(copied, from) + render(value, kind, engine);
    copied = to;
  });
  return out + sql.slice(copied);
}

/** The variables of `sql` that have nothing to write yet. */
export function missingVariables(
  vars: readonly SqlVariable[],
  values: VarValues,
): SqlVariable[] {
  return vars.filter((v) => {
    const value = values[v.token];
    if (value === undefined) return true;
    // A blank raw variable would erase a piece of the statement, and a blank
    // value is virtually always a box nobody filled in — ask, do not guess.
    return !value.isNull && value.text.trim() === "";
  });
}

/** What one variable contributes to the SQL. */
function render(value: VarValue, kind: VarKind, engine?: string): string {
  if (kind === "raw") return value.text;
  if (value.isNull) return "NULL";
  const trimmed = value.text.trim();
  // A number stays a number: quoting it would break `LIMIT :n` outright and can
  // cost an index on a comparison against an integer column.
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  const family = engineFamily(engine ?? "");
  // MySQL treats a backslash in a string literal as an escape under its default
  // sql_mode, so a path or a regexp would arrive mangled.
  const escaped =
    family === "mysql"
      ? value.text.replace(/\\/g, "\\\\").replace(/'/g, "''")
      : value.text.replace(/'/g, "''");
  return `'${escaped}'`;
}

/** Parser states. Only what a variable can hide inside. */
const enum S {
  Normal,
  Single, // '…'
  Double, // "…"
  Back, //   `…`
  Line, //   -- … EOL
  Block, //  /* … */
  Dollar, // $tag$ … $tag$ (Postgres)
}

/**
 * Walks `sql` and reports every variable occurrence with its span. Shared by
 * findVariables and applyVariables so both agree on what a variable is — two
 * scanners would eventually disagree, and the one that ran would not be the one
 * that was tested.
 */
function scan(
  sql: string,
  engine: string | undefined,
  onVar: (name: string, kind: VarKind, from: number, to: number) => void,
): void {
  const colons = engineFamily(engine ?? "") !== "mongodb";
  let state = S.Normal;
  let tag = ""; // the open $tag$, while inside one
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];
    switch (state) {
      case S.Normal: {
        if (c === "'") {
          state = S.Single;
        } else if (c === '"') {
          state = S.Double;
        } else if (c === "`") {
          state = S.Back;
        } else if (c === "-" && next === "-") {
          state = S.Line;
          i++;
        } else if (c === "/" && next === "*") {
          state = S.Block;
          i++;
        } else if (c === "$") {
          if (next === "{") {
            const name = readName(sql, i + 2);
            if (name !== null && sql[i + 2 + name.length] === "}") {
              onVar(name, "raw", i, i + 2 + name.length + 1);
              i = i + 2 + name.length; // the closing brace is consumed by the loop
              break;
            }
          }
          // A dollar-quoted string: $tag$ … $tag$, tag possibly empty.
          const close = sql.indexOf("$", i + 1);
          const candidate = close < 0 ? null : sql.slice(i + 1, close);
          if (candidate !== null && /^[A-Za-z_][A-Za-z0-9_]*$|^$/.test(candidate)) {
            tag = sql.slice(i, close + 1);
            state = S.Dollar;
            i = close;
          }
        } else if (colons && c === ":") {
          // Not a Postgres cast (`::`), and not the second colon of one.
          if (next === ":" ) {
            i++; // skip both colons of a cast
            break;
          }
          if (sql[i - 1] === ":") break;
          const name = readName(sql, i + 1);
          if (name !== null) {
            onVar(name, "value", i, i + 1 + name.length);
            i += name.length;
          }
        }
        break;
      }
      case S.Single:
        if (c === "\\" && next !== undefined) i++;
        else if (c === "'" && next === "'") i++;
        else if (c === "'") state = S.Normal;
        break;
      case S.Double:
        if (c === "\\" && next !== undefined) i++;
        else if (c === '"' && next === '"') i++;
        else if (c === '"') state = S.Normal;
        break;
      case S.Back:
        if (c === "`" && next === "`") i++;
        else if (c === "`") state = S.Normal;
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
      case S.Dollar:
        if (c === "$" && sql.startsWith(tag, i)) {
          state = S.Normal;
          i += tag.length - 1;
        }
        break;
    }
  }
}
