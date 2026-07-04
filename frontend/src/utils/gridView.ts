// Client-side sort + filter for the result grid (issue #132), over the rows
// already fetched into the page. Pure logic: it maps the loaded rows to a
// display order/subset without touching the server. IMPORTANT: this reorders and
// filters ONLY the loaded page — it is not a server-side ORDER BY/WHERE, so a
// truncated result set is sorted/filtered within what was retrieved, not across
// the whole table. The grid documents that limit to the user.
//
// The view is expressed as a list of ORIGINAL row indices in display order, so
// the editable grid can keep keying pending edits/deletes by original index
// regardless of the current sort or filter.

import type { ResultColumn } from "./query";
import { classifyType } from "./format";

export type SortDir = "asc" | "desc";
export interface SortState {
  /** Index into columns. */
  col: number;
  dir: SortDir;
}

/** Per-column filter text, keyed by column index. Blank entries are ignored. */
export type ColumnFilters = Record<number, string>;

/** Whether a neutral column type sorts numerically rather than as text. Single-
    sourced from the cell classifier so the numeric set never drifts. */
export function isNumericType(type: string): boolean {
  return classifyType(type) === "number";
}

/**
 * Cycle a column's sort on repeated header clicks: none → asc → desc → none.
 * Clicking a different column starts it at asc.
 */
export function cycleSort(current: SortState | null, col: number): SortState | null {
  if (!current || current.col !== col) return { col, dir: "asc" };
  if (current.dir === "asc") return { col, dir: "desc" };
  return null;
}

/**
 * Compare two cell values. NULLs sort last (in ascending order). Numeric columns
 * compare by value, with non-numeric text ordered after numbers; text columns
 * use locale comparison.
 */
export function compareValues(a: string | null, b: string | null, numeric: boolean): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (numeric) {
    const na = Number(a);
    const nb = Number(b);
    const aNum = a.trim() !== "" && !Number.isNaN(na);
    const bNum = b.trim() !== "" && !Number.isNaN(nb);
    if (aNum && bNum) return na - nb;
    if (aNum) return -1;
    if (bNum) return 1;
  }
  return a.localeCompare(b);
}

/**
 * Build the display order as a list of original row indices, applying the active
 * per-column text filters (case-insensitive substring; a NULL cell never
 * matches) then a stable sort. With no filters and no sort this is the identity
 * order [0, 1, …].
 */
export function buildViewIndices(
  rows: (string | null)[][],
  columns: ResultColumn[],
  sort: SortState | null,
  filters: ColumnFilters,
): number[] {
  let idx = rows.map((_, i) => i);

  const active = Object.entries(filters)
    .map(([c, q]) => [Number(c), q.trim().toLowerCase()] as const)
    .filter(([, q]) => q !== "");
  if (active.length) {
    idx = idx.filter((i) =>
      active.every(([c, q]) => {
        const cell = rows[i][c];
        return cell !== null && cell.toLowerCase().includes(q);
      }),
    );
  }

  if (sort && columns[sort.col]) {
    const numeric = isNumericType(columns[sort.col].type);
    const mul = sort.dir === "asc" ? 1 : -1;
    // Decorate with position for a stable sort independent of engine guarantees.
    idx = idx
      .map((i, k) => [i, k] as const)
      .sort((x, y) => {
        const c = compareValues(rows[x[0]][sort.col], rows[y[0]][sort.col], numeric) * mul;
        return c !== 0 ? c : x[1] - y[1];
      })
      .map((p) => p[0]);
  }

  return idx;
}

/** Sort indicator glyph for a column header (▲/▼/empty). */
export function sortGlyph(sort: SortState | null, col: number): string {
  if (!sort || sort.col !== col) return "";
  return sort.dir === "asc" ? "▲" : "▼";
}
