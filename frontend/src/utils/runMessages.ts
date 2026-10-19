// The result pane's «Mensajes» tab (issue #691, EditorMultipleResults): what
// each run said, one line per statement, with the time it ran. Pure; the
// workspace appends the lines of every fresh run to the tab's log.
//
// Only what the core reports: rows returned, rows affected, the error, and the
// warnings the workspace itself raises (MySQL's implicit commit). Engine
// notices (RAISE NOTICE, SHOW WARNINGS) are not part of the query.run reply, so
// none are listed rather than any invented.

import type { ResultSet } from "./query";

export type RunMessageKind = "rows" | "affected" | "error" | "warning";

export interface RunMessage {
  /** Epoch ms of the run. */
  at: number;
  kind: RunMessageKind;
  /** The statement the line is about. */
  sql: string;
  /** Rows returned or affected. */
  n?: number;
  /** How long the statement took, when known. */
  ms?: number;
  /** The error, or the warning's text. */
  text?: string;
}

/** A finished run, as the workspace knows it. */
export interface RunOutcome {
  at: number;
  sql: string;
  /** A script's statements, when several ran; each becomes its own line. */
  sets?: { sql: string; result: ResultSet | null; error: string | null; elapsedMs: number }[];
  result: ResultSet | null;
  error: string | null;
  elapsedMs: number | null;
  /** Warnings the workspace raised during the run. */
  warnings?: string[];
}

function line(
  at: number,
  sql: string,
  result: ResultSet | null,
  error: string | null,
  ms: number | null,
): RunMessage {
  const base = { at, sql, ...(ms !== null ? { ms } : {}) };
  if (error !== null) return { ...base, kind: "error", text: error };
  if (result && result.columns.length > 0) return { ...base, kind: "rows", n: result.rows.length };
  return { ...base, kind: "affected", n: result?.rowsAffected ?? 0 };
}

/** The lines of one run: one per statement, then its warnings. */
export function runMessages(o: RunOutcome): RunMessage[] {
  const lines =
    o.sets && o.sets.length > 0
      ? o.sets.map((s) => line(o.at, s.sql, s.result, s.error, s.elapsedMs))
      : [line(o.at, o.sql, o.result, o.error, o.elapsedMs)];
  for (const w of o.warnings ?? []) lines.push({ at: o.at, kind: "warning", sql: o.sql, text: w });
  return lines;
}

/** How many lines a tab keeps: the newest, the oldest dropped first. */
export const MESSAGE_CAP = 200;

/** The log with `lines` appended, cut to the newest `cap`. */
export function appendMessages(
  log: readonly RunMessage[],
  lines: readonly RunMessage[],
  cap = MESSAGE_CAP,
): RunMessage[] {
  const all = [...log, ...lines];
  return all.length > cap ? all.slice(all.length - cap) : all;
}
