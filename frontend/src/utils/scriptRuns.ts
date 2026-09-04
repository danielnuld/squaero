// A script's results, one per statement (issue #450).
//
// Running several statements used to leave a single result on screen — the last
// one that returned columns — so every earlier SELECT was executed against the
// server and then thrown away. The workspace now keeps one entry per statement
// and shows a tab for each; this module is the pure part: how a run becomes
// those entries, what each one is called, and which one to open.

import type { ResultSet, StatementRun } from "./query";
import { proposedSnippetName } from "./snippets";
import { errorText } from "./errors";

/** One statement of a script, as the result pane shows it. */
export interface ScriptSet {
  sql: string;
  /** Short name for its tab. */
  label: string;
  result: ResultSet | null;
  error: string | null;
  elapsedMs: number;
}

/**
 * What a statement's tab is called: the table it reads, when the statement says
 * so, else its leading keyword. The table comes from the same helper that names
 * a saved snippet, so a tab and a snippet name the same query the same way.
 */
export function statementLabel(sql: string, engine = ""): string {
  const table = proposedSnippetName(sql, engine);
  if (table) return table;
  const keyword = /^\s*(\w+)/.exec(sql)?.[1];
  return keyword ? keyword.toUpperCase() : "SQL";
}

/** How a statement ended, which is what its tab shows beside the name. */
export type SetKind = "rows" | "affected" | "error";

export function setKind(set: ScriptSet): SetKind {
  if (set.error !== null) return "error";
  return (set.result?.columns.length ?? 0) > 0 ? "rows" : "affected";
}

/** The number that belongs beside the name: rows returned, or rows written. */
export function setCount(set: ScriptSet): number {
  if (set.error !== null) return 0;
  return setKind(set) === "rows"
    ? (set.result?.rows.length ?? 0)
    : (set.result?.rowsAffected ?? 0);
}

/** Turns a run into the entries the result pane shows. */
export function scriptSets(runs: StatementRun[], engine = ""): ScriptSet[] {
  return runs.map((r) => ({
    sql: r.sql,
    label: statementLabel(r.sql, engine),
    result: r.result,
    error: r.error === undefined ? null : errorText(r.error),
    elapsedMs: r.elapsedMs,
  }));
}

/**
 * Which statement's tab to open when the script finishes.
 *
 * The one that failed, if any — it is the only thing the user has to act on.
 * Otherwise the FIRST that returned rows: a script is read from the top, and
 * every other result is now one click away rather than gone.
 */
export function pickActiveSet(sets: ScriptSet[]): number {
  const failed = sets.findIndex((s) => s.error !== null);
  if (failed >= 0) return failed;
  const withRows = sets.findIndex((s) => (s.result?.columns.length ?? 0) > 0);
  return withRows >= 0 ? withRows : 0;
}
