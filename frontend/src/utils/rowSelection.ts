// Multi-row selection for the result grid (issue #382). A mark is an ORIGINAL
// row index (into result.rows), never a view position, so it survives sorting,
// filtering and scrolling — the same discipline the edit hooks already follow.
// The component owns the DOM and the events; this module only does the math.

import type { ResultSet } from "./query";

export type RowMarks = ReadonlySet<number>;

/** Add or remove one row (ctrl/cmd + click). */
export function toggleMark(marks: RowMarks, row: number): Set<number> {
  const next = new Set(marks);
  if (!next.delete(row)) next.add(row);
  return next;
}

/**
 * Mark every row between two VIEW positions, inclusive and in either order
 * (shift + click, shift + arrows). `view` maps view positions to original row
 * indices. `additive` keeps the marks already made; otherwise the range
 * replaces them, which is what a plain shift + click means.
 */
export function markRange(
  marks: RowMarks,
  view: number[],
  from: number,
  to: number,
  additive = false,
): Set<number> {
  const next = new Set(additive ? marks : []);
  const lo = Math.max(0, Math.min(from, to));
  const hi = Math.min(view.length - 1, Math.max(from, to));
  for (let p = lo; p <= hi; p++) next.add(view[p]);
  return next;
}

/**
 * The marked rows in VIEW order — what the user sees, top to bottom. Rows the
 * current filter hides are dropped: copying rows that are not on screen is not
 * a pleasant surprise.
 */
export function orderedMarks(marks: RowMarks, view: number[]): number[] {
  return view.filter((r) => marks.has(r));
}

/**
 * A result set carrying only the given rows, in the given order. The exporters
 * and the transfer wizard both take a whole ResultSet, so a subset is how a
 * selection reaches them — no second data path. Never truncated: the subset is
 * exactly the rows that were picked.
 */
export function pickRows(result: ResultSet, rows: number[]): ResultSet {
  return {
    ...result,
    rows: rows.filter((i) => i >= 0 && i < result.rows.length).map((i) => result.rows[i]),
    truncated: false,
  };
}
