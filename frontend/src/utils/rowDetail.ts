// Pure helpers for the row form/detail view (issue #133): a panel that shows one
// row of a result set as a field-by-field form, better for wide rows or long /
// JSON cells. Editing reuses the transactional edit session (PendingChanges), so
// here we only derive the fields to render and clamp the row navigation index.
// All pure and unit-tested; the RowDetail component stays a thin binding.

import type { ResultColumn } from "./query";

/** One column of a row, resolved for display in the detail form. */
export interface RowField {
  name: string;
  /** Neutral column type (int, text, json, …). */
  type: string;
  /** Original value from the result set (SQL NULL => null). */
  original: string | null;
  /** Current value: the pending edit if one exists, else the original. */
  value: string | null;
  /** True when a pending edit is recorded and differs from the original. */
  edited: boolean;
}

/**
 * Build the field list for a row, overlaying any pending cell edits (keyed by
 * column name, as recorded by the edit session). A column present in `edits`
 * shows the edited value; `edited` is true only when that value actually differs
 * from the original, so re-typing the same text is not flagged as a change.
 */
export function buildRowFields(
  columns: ResultColumn[],
  row: (string | null)[],
  edits?: Record<string, string | null>,
): RowField[] {
  return columns.map((col, i) => {
    const original = row[i] ?? null;
    const hasEdit = !!edits && Object.prototype.hasOwnProperty.call(edits, col.name);
    const value = hasEdit ? edits![col.name] : original;
    return { name: col.name, type: col.type, original, value, edited: hasEdit && value !== original };
  });
}

/** Clamp a row index into [0, count); returns 0 for an empty set. */
export function clampRowIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  if (index < 0) return 0;
  if (index >= count) return count - 1;
  return index;
}

/** Step the row index by `delta` (e.g. -1 / +1), clamped to the loaded rows. */
export function stepRowIndex(index: number, delta: number, count: number): number {
  return clampRowIndex(index + delta, count);
}

/** True when moving `delta` from `index` stays within the loaded rows. */
export function canStep(index: number, delta: number, count: number): boolean {
  const next = index + delta;
  return next >= 0 && next < count;
}
