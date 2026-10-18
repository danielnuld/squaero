// The transposed view of a result (issue #670): columns as rows, for results
// too wide to read across. It is an ordinary ResultSet, so the same virtualized
// ResultGrid draws it — one grid engine, not two. Each ROW of the transposed set
// is a source column, so its cells keep that column's neutral type in `types`
// for the grid to format them by (.rules/frontend.md §3).

import type { ResultSet } from "./query";

/** Source rows shown side by side at most: each one is a grid column, and the
    grid virtualizes rows, not columns. */
export const TRANSPOSE_MAX_ROWS = 100;

export interface Transposed {
  /** column name, column type, then one column per source row. */
  result: ResultSet;
  /** Neutral type of each transposed row (= each source column). */
  types: string[];
  /** True when the source rows were cut to TRANSPOSE_MAX_ROWS. */
  capped: boolean;
}

/**
 * Transposes `rows` (indices into `source.rows`, in the order to show them) —
 * or, when none are given, the whole page. `headers` names the two leading
 * columns and each source row's column (the caller translates them).
 */
export function transposeResult(
  source: ResultSet,
  rows: readonly number[],
  headers: { column: string; type: string; row: (rowIndex: number) => string },
): Transposed {
  const valid = rows.filter((r) => r >= 0 && r < source.rows.length);
  const all = valid.length > 0 ? valid : source.rows.map((_, i) => i);
  const picked = all.slice(0, TRANSPOSE_MAX_ROWS);
  return {
    result: {
      columns: [
        { name: headers.column, type: "text" },
        { name: headers.type, type: "text" },
        ...picked.map((r) => ({ name: headers.row(r), type: "" })),
      ],
      rows: source.columns.map((col, ci) => [
        col.name,
        col.type,
        ...picked.map((r) => source.rows[r][ci] ?? null),
      ]),
      truncated: false,
      rowsAffected: 0,
    },
    types: source.columns.map((c) => c.type),
    capped: all.length > picked.length,
  };
}
