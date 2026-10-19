// Rectangular cell selection for the result grid (issue #690): Shift+arrows,
// Shift+click and dragging select a block of cells, Ctrl+C copies it as TSV.
//
// Positions here are in DISPLAY space — `r` a position in the current view (the
// sorted and searched rows), `c` a position among the columns as drawn — because
// a block is what the user sees, not what the engine sent. The component maps
// them back to original indices. Pure: the DOM, focus and clipboard stay there.

import type { CellPos } from "./gridNav";

/** An inclusive block of cells, normalized so r1 <= r2 and c1 <= c2. */
export interface CellRange {
  r1: number;
  c1: number;
  r2: number;
  c2: number;
}

/** The block spanned by two corners, in either order. */
export function rangeBetween(a: CellPos, b: CellPos): CellRange {
  return {
    r1: Math.min(a.r, b.r),
    c1: Math.min(a.c, b.c),
    r2: Math.max(a.r, b.r),
    c2: Math.max(a.c, b.c),
  };
}

export function inRange(range: CellRange | null, r: number, c: number): boolean {
  return !!range && r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2;
}

export function rangeCellCount(range: CellRange | null): number {
  return range ? (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1) : 0;
}

/**
 * One TSV field, the way spreadsheets read it back: NULL is an empty field, and
 * a value holding a tab, a line break or a double quote is quoted with its
 * quotes doubled — unquoted, a tab inside a value would split it in two cells.
 */
export function tsvField(value: string | null): string {
  if (value === null) return "";
  return /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** A block of values as TSV: one line per row, tab between cells. */
export function rangeToTsv(rows: readonly (readonly (string | null)[])[]): string {
  return rows.map((row) => row.map(tsvField).join("\t")).join("\n");
}
