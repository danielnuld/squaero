// Pure formatters for copying result-grid data to the clipboard (used by the
// grid context menu). SQL NULL (represented as `null`) becomes an empty string
// in the tab-separated form and JSON `null` in the object form.

import type { ResultColumn, ResultSet } from "./query";
import type { RowClipboard, RowSource } from "./rowPaste";
import { applyOrder } from "./gridColumnOrder";

/** A row as a single tab-separated line (NULL -> empty). */
export function rowToTsv(row: (string | null)[]): string {
  return row.map((c) => c ?? "").join("\t");
}

/**
 * Rows copied from the grid (#517): the tab-separated text other programs get,
 * and beside it the exact copy a paste in this app uses instead — the text
 * cannot tell NULL from "" nor carry a tab inside a value. Both follow the
 * grid's column `order`, so what is copied is what is on screen (#446).
 */
export function copyRows(
  result: ResultSet,
  rowIndices: number[],
  order: readonly number[],
  source: RowSource | null,
  withHeader = false,
): RowClipboard {
  const columns = applyOrder(order, result.columns).map((c) => c.name);
  const rows = rowIndices
    .filter((i) => result.rows[i] !== undefined)
    .map((i) => applyOrder(order, result.rows[i]));
  // The header line is only for the text other programs get (a spreadsheet
  // takes it as its first row); the in-app copy already carries the columns.
  const lines = rows.map(rowToTsv);
  if (withHeader) lines.unshift(columns.join("\t"));
  return { text: lines.join("\n"), columns, rows, source };
}

/** Rows of a result as new-row value maps keyed by column name, for duplicating. */
export function rowsAsInserts(
  result: ResultSet,
  rowIndices: number[],
): Record<string, string | null>[] {
  return rowIndices
    .filter((i) => result.rows[i] !== undefined)
    .map((i) =>
      Object.fromEntries(result.columns.map((c, ci) => [c.name, result.rows[i][ci] ?? null])),
    );
}

/** A row as a JSON object keyed by column name (NULL -> JSON null). */
export function rowToJson(
  columns: ResultColumn[],
  row: (string | null)[],
): string {
  const obj: Record<string, string | null> = {};
  columns.forEach((col, i) => {
    obj[col.name] = row[i] ?? null;
  });
  return JSON.stringify(obj);
}

/** Write text to the clipboard, best-effort (no throw if unavailable). */
export function copyText(text: string): void {
  try {
    void navigator?.clipboard?.writeText(text);
  } catch {
    /* clipboard blocked or unavailable: silently ignore */
  }
}
