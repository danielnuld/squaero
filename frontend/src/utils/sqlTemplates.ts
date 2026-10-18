// Editor templates (issue #665): an abbreviation typed in the editor that, on
// Tab or from the completion list, expands into a SQL fragment with navigable
// placeholders. A template is a snippet with an abbreviation — the user's live
// in the snippet list (snippets.ts), a few built-ins ship here. Pure: the
// CodeMirror binding is SqlEditor.tsx, which hands `templateToSnippet`'s output
// to @codemirror/autocomplete's `snippet()`.
//
// Body syntax is CodeMirror's: `${name}` is a placeholder (repeated names are
// one field, edited together), `${1:name}` fixes its Tab order, `${}` is an
// empty stop. That `${name}` is also the editor's raw variable (sqlVariables.ts)
// is fine in practice: expansion replaces it with its text. A literal `${x}` in
// a template is written `$\{x\}`.

import { completionContext } from "./sqlEditor";
import type { Snippet } from "./snippets";

export interface SqlTemplate {
  /** The trigger word, lower case. */
  abbr: string;
  /** What the completion list shows next to the abbreviation. */
  name: string;
  /** The fragment, in the placeholder syntax above. */
  body: string;
}

/** Shipped templates. A user snippet with the same abbreviation replaces one;
    the `builtinTemplates` setting turns them all off. */
export const BUILTIN_TEMPLATES: readonly SqlTemplate[] = [
  { abbr: "sel", name: "SELECT … FROM … WHERE", body: "SELECT ${columns} FROM ${table} WHERE ${condition}" },
  { abbr: "ins", name: "INSERT INTO … VALUES", body: "INSERT INTO ${table} (${columns}) VALUES (${values})" },
  { abbr: "upd", name: "UPDATE … SET … WHERE", body: "UPDATE ${table} SET ${column} = ${value} WHERE ${condition}" },
  { abbr: "del", name: "DELETE FROM … WHERE", body: "DELETE FROM ${table} WHERE ${condition}" },
  { abbr: "cte", name: "WITH … AS (…)", body: "WITH ${name} AS (\n\t${query}\n)\nSELECT * FROM ${name}" },
];

/** The abbreviation `raw` stands for — trimmed, lower case — or null when it is
    not a single word (letters, digits, `_`, not starting with a digit). */
export function normalizeAbbr(raw: string): string | null {
  const a = raw.trim().toLowerCase();
  return /^[a-z_][a-z0-9_]*$/.test(a) ? a : null;
}

/**
 * The templates in force: the user's snippets that carry an abbreviation, then
 * the built-ins whose abbreviation no snippet took. Between snippets with the
 * same abbreviation the first in the list wins.
 */
export function resolveTemplates(
  snippets: readonly Snippet[],
  builtins: readonly SqlTemplate[],
): SqlTemplate[] {
  const out: SqlTemplate[] = [];
  const taken = new Set<string>();
  const add = (abbr: string | null | undefined, name: string, body: string) => {
    const a = abbr ? normalizeAbbr(abbr) : null;
    if (!a || taken.has(a)) return;
    taken.add(a);
    out.push({ abbr: a, name, body });
  };
  for (const s of snippets) add(s.abbr, s.name, s.body);
  for (const b of builtins) add(b.abbr, b.name, b.body);
  return out;
}

/**
 * The template whose abbreviation is the whole word ending at `pos` in `text`,
 * and where that word starts — or null. Case-insensitive. Not after a dot
 * (`t.sel` is a column) nor in the middle of a word.
 */
export function templateAt(
  templates: readonly SqlTemplate[],
  text: string,
  pos: number,
): { template: SqlTemplate; from: number } | null {
  if (/[A-Za-z0-9_$]/.test(text[pos] ?? "")) return null;
  const ctx = completionContext(text, pos);
  if (text[ctx.from - 1] === ".") return null;
  const word = ctx.word.toLowerCase();
  const template = templates.find((t) => t.abbr === word);
  return template ? { template, from: ctx.from } : null;
}

// A `${…}` placeholder as CodeMirror's parser reads it (its `#{…}` form is not offered).
const PLACEHOLDER = /\$\{(?:\d+(?::[^{}]*)?|(?:\\[{}]|[^{}])*)\}/g;

/**
 * `body` with every brace that is not part of a `${…}` placeholder escaped, so
 * CodeMirror's `snippet()` keeps it literally: `#{x}` and a JSON literal's
 * `{"a": 1}` are SQL, not fields. Placeholders, and braces the author already
 * escaped (`$\{x\}`), pass through untouched.
 */
export function templateToSnippet(body: string): string {
  const esc = (s: string) => s.replace(/\\[{}]|[{}]/g, (b) => (b.length === 2 ? b : `\\${b}`));
  let out = "";
  let last = 0;
  for (const m of body.matchAll(PLACEHOLDER)) {
    out += esc(body.slice(last, m.index)) + m[0];
    last = m.index! + m[0].length;
  }
  return out + esc(body.slice(last));
}
