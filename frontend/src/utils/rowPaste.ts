// Pasting rows as new, unsaved rows of a table (openspec: paste-rows-as-inserts).
//
// Everything that decides WHAT a paste becomes lives here, pure: whether the
// clipboard is an exact copy made in this app or text from somewhere else,
// where each value lands, what happens to the primary key, and which pending
// rows are already known to collide. App.tsx only carries the result out — it
// either adds the rows to the edit session or opens the import wizard, as a
// paste always did before (issue #383).

import { parseClipboard } from "./importers";

/** Above this many rows a paste goes to the import wizard, which is built for
    volume; the pending-rows section is not virtualized. */
export const PASTE_ROW_LIMIT = 500;

/** What a pasted batch does with the primary key it carries. */
export type PkMode = "generate" | "keep";

/** Where a set of rows was read from. */
export interface RowSource {
  connDefId: string;
  db?: string;
  schema?: string;
  table: string;
}

/**
 * The exact copy kept next to the clipboard text. The text is what other
 * programs get; it cannot tell NULL from "" nor survive a tab inside a value,
 * so a paste whose text still matches `text` uses these rows instead.
 */
export interface RowClipboard {
  text: string;
  columns: string[];
  rows: (string | null)[][];
  source: RowSource | null;
}

/** The table a paste lands on. */
export interface PasteTarget {
  /** Column names in the grid's visible order. */
  columns: string[];
  source: RowSource;
}

export type PastePlan =
  /** Not a table (a single value): leave the paste to whatever wanted it. */
  | { kind: "none" }
  | {
      kind: "inserts";
      rows: Record<string, string | null>[];
      /** Copied columns the target does not have. */
      ignoredColumns: string[];
      pkMode: PkMode;
      /** Came from another program, so empty cells were a guess. */
      fromText: boolean;
    }
  | { kind: "wizard"; reason: "shape" | "tooMany" };

/** Same table on the same saved connection. */
export function sameSource(a: RowSource | null, b: RowSource): boolean {
  return (
    !!a &&
    a.connDefId === b.connDefId &&
    (a.db ?? "") === (b.db ?? "") &&
    (a.schema ?? "") === (b.schema ?? "") &&
    a.table === b.table
  );
}

const lower = (s: string) => s.toLowerCase();

/**
 * Decide what a paste of `text` over `target` becomes.
 *
 * - `text` equal to `clip.text`: the exact copy, placed by column name
 *   (case-insensitive), NULLs intact. Copied columns the target lacks are
 *   reported; target columns the copy lacks stay out of the insert, so the
 *   database applies their default.
 * - Any other text with a tab or a newline: every line must have exactly as
 *   many cells as the grid has columns. A first line naming all the columns is
 *   a header (placed by name); otherwise lines are placed by position.
 *   `emptyAsNull` turns empty cells into NULL.
 * - Anything else goes to the wizard, as does more than PASTE_ROW_LIMIT rows.
 *
 * The primary key starts as "generate" only when the rows come from this very
 * table; pasted anywhere else the copied key is probably meant to be kept.
 */
export function planPaste(
  text: string,
  clip: RowClipboard | null,
  target: PasteTarget,
  opts: { emptyAsNull: boolean },
): PastePlan {
  const byLower = new Map(target.columns.map((c) => [lower(c), c]));

  if (clip && clip.text === text) {
    if (clip.rows.length === 0) return { kind: "none" };
    if (clip.rows.length > PASTE_ROW_LIMIT) return { kind: "wizard", reason: "tooMany" };
    const landing = clip.columns.map((c) => byLower.get(lower(c)) ?? null);
    if (landing.every((c) => c === null)) return { kind: "wizard", reason: "shape" };
    const rows = clip.rows.map((row) => {
      const values: Record<string, string | null> = {};
      landing.forEach((col, i) => {
        if (col !== null) values[col] = row[i] ?? null;
      });
      return values;
    });
    return {
      kind: "inserts",
      rows,
      ignoredColumns: clip.columns.filter((_, i) => landing[i] === null),
      pkMode: sameSource(clip.source, target.source) ? "generate" : "keep",
      fromText: false,
    };
  }

  if (!text.includes("\t") && !text.includes("\n")) return { kind: "none" };

  const parsed = parseClipboard(text);
  const records = [parsed.headers, ...parsed.rows];
  const width = target.columns.length;
  if (records.some((r) => r.length !== width)) return { kind: "wizard", reason: "shape" };

  const headerNames = parsed.headers.map((h) => byLower.get(lower(h.trim())) ?? null);
  const isHeader =
    headerNames.every((h) => h !== null) && new Set(headerNames).size === width;
  const order = isHeader ? (headerNames as string[]) : target.columns;
  const data = isHeader ? parsed.rows : records;

  if (data.length === 0) return { kind: "none" };
  if (data.length > PASTE_ROW_LIMIT) return { kind: "wizard", reason: "tooMany" };

  const rows = data.map((record) => {
    const values: Record<string, string | null> = {};
    order.forEach((col, i) => {
      const cell = record[i] ?? "";
      values[col] = opts.emptyAsNull && cell === "" ? null : cell;
    });
    return values;
  });
  return { kind: "inserts", rows, ignoredColumns: [], pkMode: "keep", fromText: true };
}

/** The rows already on screen, to check pending rows against. */
export interface LoadedRows {
  columns: string[];
  rows: (string | null)[][];
}

/**
 * Pending rows whose values are already known to collide, as
 * insert index -> the columns involved.
 *
 * Checked sets: the primary key of every insert whose batch KEEPS it, and each
 * unique index. A set collides when all its columns carry a value equal to
 * another pending row's or a loaded row's. A NULL or a column left out of the
 * insert never collides — SQL does not treat NULLs as equal, and a left-out
 * column takes a default nobody can see from here.
 *
 * ponytail: exact string equality, so a case-insensitive collation's
 * duplicates ("A@x.mx" vs "a@x.mx") and rows on other pages are not caught
 * here; the database still rejects them on save, and the failed row is shown.
 */
export function findConflicts(
  inserts: Record<string, string | null>[],
  loaded: LoadedRows,
  keys: { pk: string[]; uniqueSets: string[][] },
  pkModeOf: (insertIndex: number) => PkMode,
): Map<number, string[]> {
  const out = new Map<number, string[]>();
  const loadedIndex = new Map(loaded.columns.map((c, i) => [lower(c), i]));

  const tupleOf = (values: Record<string, string | null>, set: string[]): string[] | null => {
    const byLowerKey = new Map(Object.keys(values).map((k) => [lower(k), k]));
    const tuple: string[] = [];
    for (const col of set) {
      const key = byLowerKey.get(lower(col));
      const v = key === undefined ? null : values[key];
      if (v === null || v === undefined) return null;
      tuple.push(v);
    }
    return tuple;
  };
  const loadedTuple = (row: (string | null)[], set: string[]): string[] | null => {
    const tuple: string[] = [];
    for (const col of set) {
      const i = loadedIndex.get(lower(col));
      const v = i === undefined ? null : row[i];
      if (v === null || v === undefined) return null;
      tuple.push(v);
    }
    return tuple;
  };
  const same = (a: string[], b: string[]) => a.every((v, i) => v === b[i]);
  const flag = (i: number, set: string[]) => {
    const cols = out.get(i) ?? [];
    for (const c of set) if (!cols.includes(c)) cols.push(c);
    out.set(i, cols);
  };

  const check = (set: string[], applies: (i: number) => boolean) => {
    if (set.length === 0) return;
    const tuples = inserts.map((values, i) => (applies(i) ? tupleOf(values, set) : null));
    tuples.forEach((tuple, i) => {
      if (!tuple) return;
      const clashesPending = tuples.some((other, j) => j !== i && other && same(tuple, other));
      const clashesLoaded = loaded.rows.some((row) => {
        const t = loadedTuple(row, set);
        return t !== null && same(tuple, t);
      });
      if (clashesPending || clashesLoaded) flag(i, set);
    });
  };

  check(keys.pk, (i) => pkModeOf(i) === "keep");
  for (const set of keys.uniqueSets) check(set, () => true);
  return out;
}
