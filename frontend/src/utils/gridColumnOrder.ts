// Column display order for the result grid (issue #446).
//
// The data is never touched. A row is an array indexed by the column's ORIGINAL
// position, and the widths, the sort, the per-column filters, the edit session
// and the cell context menu all key on that index — so the order is expressed
// the way gridView.ts already expresses row sorting: a list of ORIGINAL indices
// in display order. Dragging a column changes what is drawn and nothing else.

/** The order a fresh result starts in: the engine's own. */
export function defaultOrder(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

/** Move the column at display position `from` so that it lands at `to`. */
export function moveColumn(
  order: readonly number[],
  from: number,
  to: number,
): number[] {
  const next = [...order];
  if (from === to || from < 0 || to < 0 || from >= next.length || to >= next.length) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** Where the original column `original` currently sits, or -1. */
export function displayIndex(order: readonly number[], original: number): number {
  return order.indexOf(original);
}

/**
 * Reorders a per-column array — a row, the column list — into display order.
 *
 * An order that does not cover the array is ignored rather than trusted: a stale
 * order (a new result with a different column count, arriving before the reset)
 * would otherwise silently drop or duplicate values in whatever the caller is
 * copying.
 */
export function applyOrder<T>(order: readonly number[], items: readonly T[]): T[] {
  if (order.length !== items.length) return [...items];
  return order.map((i) => items[i]);
}
