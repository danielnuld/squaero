// Go to definition, find usages (issue #663) and rename (issue #664) in the SQL
// editor, answered from the semantic scope (sqlScope.ts).
//
// Everything works on identities the scope pass already resolved: an alias is
// its Relation object, a CTE its Cte object, so a same-named alias of another
// statement or of a sibling subquery is simply a different object and is never
// touched. Database objects (tables, their columns) have no declaration in the
// script, so they are matched by name across every statement.
//
// Only tokens are ever edited, and the tokenizer never yields anything inside a
// string or a comment, so neither can be renamed by accident.

import type { Cte, Range, Reference, Relation, SqlAnalysis } from "./sqlScope";
import { RESERVED, canGoBare } from "./sqlTidy";
import { quoteIdentifier } from "./schema";
import { engineFamily } from "./engineFamily";
import { tokenizeSql } from "./sqlTokens";

/** What an identifier of the script names. */
export type SqlSymbol =
  /** A FROM item referred to by an alias (or a table function by its name). */
  | { kind: "relation"; relation: Relation }
  | { kind: "cte"; cte: Cte }
  /** A database table or view, by its name as written (`s.t` or `t`). */
  | { kind: "table"; name: string }
  /** A column of a database table. */
  | { kind: "column"; table: string; name: string };

/** Where "go to definition" leads: a span of the script, or a database object. */
export type Definition =
  | { kind: "range"; range: Range }
  | { kind: "object"; name: string };

const lc = (s: string) => s.toLowerCase();
const sameName = (a: string, b: string) => lc(a) === lc(b);
const covers = (r: Range, offset: number) => r.start <= offset && offset <= r.end;

/** `s.t` and `t` are the same table; `s1.t` and `s2.t` are not. */
function sameTable(a: string, b: string): boolean {
  const pa = a.split(".");
  const pb = b.split(".");
  if (!sameName(pa[pa.length - 1], pb[pb.length - 1])) return false;
  if (pa.length === 1 || pb.length === 1) return true;
  return sameName(pa[pa.length - 2], pb[pb.length - 2]);
}

function relationSymbol(rel: Relation): SqlSymbol | null {
  if (rel.alias) return { kind: "relation", relation: rel };
  if (rel.kind === "cte" && rel.cte) return { kind: "cte", cte: rel.cte };
  if (rel.kind === "table" && rel.target) return { kind: "table", name: rel.target };
  return rel.targetRange ? { kind: "relation", relation: rel } : null;
}

function referenceSymbol(ref: Reference): SqlSymbol | null {
  const rel = ref.relation;
  if (!rel) return null;
  if (ref.role === "column") {
    return rel.kind === "table" && rel.target ? { kind: "column", table: rel.target, name: ref.name } : null;
  }
  if (ref.role === "relation") {
    if (rel.kind === "cte" && rel.cte) return { kind: "cte", cte: rel.cte };
    return rel.target ? { kind: "table", name: rel.target } : null;
  }
  return relationSymbol(rel);
}

/** The symbol under `offset` (a cursor touching either end of a name counts). */
export function symbolAt(analysis: SqlAnalysis, offset: number): SqlSymbol | null {
  for (const s of analysis.statements) {
    if (offset < s.start || offset > s.end) continue;
    const cte = s.ctes.find((c) => covers(c.range, offset));
    if (cte) return { kind: "cte", cte };
    for (const scope of s.scopes) {
      const rel = scope.relations.find((r) => r.alias && covers(r.alias, offset));
      if (rel) return { kind: "relation", relation: rel };
    }
    const ref = s.references.find((r) => covers(r, offset));
    if (ref) return referenceSymbol(ref);
  }
  return null;
}

/** Where the identifier at `offset` is defined, or null when it names nothing known. */
export function definitionAt(analysis: SqlAnalysis, offset: number): Definition | null {
  const sym = symbolAt(analysis, offset);
  if (!sym) return null;
  switch (sym.kind) {
    case "relation": {
      const range = sym.relation.alias ?? sym.relation.targetRange;
      return range ? { kind: "range", range } : null;
    }
    case "cte":
      return { kind: "range", range: sym.cte.range };
    case "table":
      return { kind: "object", name: sym.name };
    case "column":
      return { kind: "object", name: sym.table };
  }
}

function refersTo(ref: Reference, sym: SqlSymbol): boolean {
  const rel = ref.relation;
  switch (sym.kind) {
    case "relation":
      return ref.role === "qualifier" && rel === sym.relation;
    case "cte":
      return (
        (ref.role === "relation" && ref.cte === sym.cte) ||
        (ref.role === "qualifier" && !!rel && rel.cte === sym.cte && !rel.alias)
      );
    case "table":
      return (
        !!rel && rel.kind === "table" && sameTable(rel.target!, sym.name) &&
        (ref.role === "relation" || (ref.role === "qualifier" && !rel.alias))
      );
    case "column":
      return (
        ref.role === "column" && !!rel && rel.kind === "table" &&
        sameTable(rel.target!, sym.table) && sameName(ref.name, sym.name)
      );
  }
}

/**
 * Every span of the script that names `sym`, its declaration included, in
 * document order. Database objects are matched in all statements; an alias or
 * CTE only where it is in scope.
 */
export function occurrencesOf(analysis: SqlAnalysis, sym: SqlSymbol): Range[] {
  const out: Range[] = [];
  if (sym.kind === "cte") out.push(sym.cte.range);
  if (sym.kind === "relation") {
    const decl = sym.relation.alias ?? sym.relation.targetRange;
    if (decl) out.push(decl);
  }
  for (const s of analysis.statements) for (const ref of s.references) if (refersTo(ref, sym)) out.push(ref);
  out.sort((a, b) => a.start - b.start);
  return out
    .filter((r, i) => i === 0 || r.start !== out[i - 1].start)
    .map((r) => ({ start: r.start, end: r.end }));
}

/** The name a symbol is written with, unquoted (the last part for a table). */
export function symbolName(sym: SqlSymbol): string {
  switch (sym.kind) {
    case "relation":
      return sym.relation.name;
    case "cte":
      return sym.cte.name;
    case "table":
      return sym.name.split(".").pop()!;
    case "column":
      return sym.name;
  }
}

export type RenameError =
  /** Nothing renameable under the cursor. */
  | "no-symbol"
  | "empty"
  /** Control characters (a line break…) cannot be part of a name. */
  | "invalid"
  /** The name needs delimiters and the engine has none (Informix). */
  | "needs-quotes"
  /** Another alias of the same FROM, or another CTE, already has that name. */
  | "conflict";

export type RenameResult =
  | { changes: { from: number; to: number; insert: string }[] }
  | { error: RenameError };

const QUOTE_START = /^["`[]/;

/**
 * The edits that rename the symbol at `offset` of `sql` to `newName`. A name
 * that cannot stand bare in `engine` is delimited; an occurrence that was
 * delimited stays delimited. Text only: nothing is executed.
 */
export function renameEdits(
  sql: string,
  analysis: SqlAnalysis,
  offset: number,
  newName: string,
  engine?: string | null,
): RenameResult {
  const sym = symbolAt(analysis, offset);
  if (!sym) return { error: "no-symbol" };
  const name = newName.trim();
  if (name === "") return { error: "empty" };
  if (/[\u0000-\u001f\u007f]/.test(name)) return { error: "invalid" };
  const bare = canGoBare(name, engine);
  if (!bare && engineFamily(engine ?? "") === "informix") return { error: "needs-quotes" };

  if (sym.kind === "relation" &&
      sym.relation.scope.relations.some((r) => r !== sym.relation && sameName(r.name, name))) {
    return { error: "conflict" };
  }
  if (sym.kind === "cte" &&
      analysis.statements.some((s) => s.ctes.includes(sym.cte) && s.ctes.some((c) => c !== sym.cte && sameName(c.name, name)))) {
    return { error: "conflict" };
  }

  const quoted = quoteIdentifier(name, engine ?? undefined);
  return {
    changes: occurrencesOf(analysis, sym).map((r) => ({
      from: r.start,
      to: r.end,
      insert: bare && !QUOTE_START.test(sql[r.start]) ? name : quoted,
    })),
  };
}

/** A routine call under the cursor: `fn(`, `s.fn(`, `CALL p(`. */
export interface RoutineTarget {
  name: string;
  schema?: string;
}

/** Words before `name (` that make it a table or a column list, not a call. */
const NOT_A_CALL = new Set(["table", "references", "into", "exists", "view", "index"]);

/**
 * The routine named at `offset`, when the name there is followed by `(`.
 * Callers ask sqlScope first: a relation or alias with a column list also
 * reads `name (`, and it is the scope pass that knows it is not a call.
 */
export function routineAt(sql: string, offset: number, engine?: string | null): RoutineTarget | null {
  const toks = tokenizeSql(sql, engine);
  const isName = (i: number) => !!toks[i] && (toks[i].kind === "quoted" || toks[i].kind === "word");
  let i = toks.findIndex((t) => covers(t, offset) && (t.kind === "word" || t.kind === "quoted"));
  if (i === -1) return null;
  // Walk to the last part of a dotted chain.
  while (toks[i + 1]?.text === "." && isName(i + 2)) i += 2;
  let first = i;
  while (toks[first - 1]?.text === "." && isName(first - 2)) first -= 2;
  const last = toks[i];
  if (toks[i + 1]?.text !== "(") return null;
  if (last.kind === "word" && RESERVED.has(lc(last.value))) return null;
  const before = toks[first - 1];
  if (before?.kind === "word" && NOT_A_CALL.has(lc(before.value))) return null;
  return { name: last.value, schema: i > first ? toks[i - 2].value : undefined };
}

/**
 * The loaded tree's table or view that `name` (`t`, `s.t` or `db.s.t`, as
 * written in the script) names; a qualifier must match the node's schema or
 * database. Undefined when the tree has not loaded it.
 */
export function objectNodeFor<T extends { kind: string; label: string; db?: string; schema?: string }>(
  nodes: readonly T[],
  name: string,
): T | undefined {
  const parts = name.split(".");
  const bare = parts[parts.length - 1];
  const qualifier = parts.length > 1 ? parts[parts.length - 2] : undefined;
  return nodes.find(
    (n) =>
      (n.kind === "table" || n.kind === "view") &&
      sameName(n.label, bare) &&
      (qualifier === undefined || sameName(n.schema ?? "", qualifier) || sameName(n.db ?? "", qualifier)),
  );
}
