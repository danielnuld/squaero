// Pure formatters for copying result-grid data to the clipboard (used by the
// grid context menu). SQL NULL (represented as `null`) becomes an empty string
// in the tab-separated form and JSON `null` in the object form.

import type { ResultColumn } from "./query";

/** A row as a single tab-separated line (NULL -> empty). */
export function rowToTsv(row: (string | null)[]): string {
  return row.map((c) => c ?? "").join("\t");
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
