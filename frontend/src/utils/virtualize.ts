// Pure virtualization math for the result grid. The grid renders only the rows
// intersecting the viewport (plus an overscan margin) and offsets them with a
// spacer so the scrollbar reflects the full dataset. Virtualization is a hard
// requirement, not an optimization (see .rules/frontend.md §2).

export interface VisibleRange {
  /** Index of the first row to render (inclusive). */
  start: number;
  /** Index one past the last row to render (exclusive). */
  end: number;
  /** Pixel offset of the first rendered row from the top of the content. */
  offsetY: number;
  /** Total content height in pixels (rowCount * rowHeight). */
  totalHeight: number;
}

export interface VirtualizeParams {
  scrollTop: number;
  viewportHeight: number;
  rowHeight: number;
  rowCount: number;
  /** Extra rows rendered above and below the viewport. Default 6. */
  overscan?: number;
}

/**
 * Computes the slice of rows to render for a given scroll position. Clamps to
 * [0, rowCount] and tolerates zero/negative inputs (empty result sets, an
 * unmeasured viewport during the first paint).
 */
export function visibleRange(params: VirtualizeParams): VisibleRange {
  const { scrollTop, viewportHeight, rowHeight, rowCount } = params;
  const overscan = params.overscan ?? 6;

  if (rowHeight <= 0 || rowCount <= 0) {
    return { start: 0, end: 0, offsetY: 0, totalHeight: 0 };
  }

  const totalHeight = rowCount * rowHeight;
  const safeScroll = Math.max(0, Math.min(scrollTop, totalHeight));
  const safeViewport = Math.max(0, viewportHeight);

  const first = Math.floor(safeScroll / rowHeight);
  const visibleCount = Math.ceil(safeViewport / rowHeight);

  const start = Math.max(0, first - overscan);
  const end = Math.min(rowCount, first + visibleCount + overscan);

  return { start, end, offsetY: start * rowHeight, totalHeight };
}

/**
 * Whether more rows should be requested from the core. True when the dataset is
 * truncated (more rows exist server-side) and the rendered window comes within
 * `threshold` rows of the last loaded row. Pure: the caller fires the fetch.
 */
export function needsMoreRows(
  visibleEnd: number,
  loadedCount: number,
  truncated: boolean,
  threshold = 50,
): boolean {
  if (!truncated || loadedCount <= 0) {
    return false;
  }
  return visibleEnd >= loadedCount - threshold;
}
