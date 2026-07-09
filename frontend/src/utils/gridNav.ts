// Pure keyboard-navigation math for the result grid. A selected cell is a
// {r, c} position where `r` is the index into the current VIEW (the sorted /
// filtered list of rows, so it stays valid under sort+filter) and `c` is the
// column index. The component owns the DOM, scrolling and focus; this module
// only computes the next selection and whether a key is a navigation key.

export interface CellPos {
  /** Row index within the current view (0-based). */
  r: number;
  /** Column index (0-based). */
  c: number;
}

/** Keys this module acts on; anything else leaves the selection unchanged. */
const NAV_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** How many rows a PageUp/PageDown jumps. */
export const PAGE_STEP = 10;

/** True when `key` is a grid-navigation key (so the caller can preventDefault). */
export function isNavKey(key: string): boolean {
  return NAV_KEYS.has(key);
}

/** Clamp `n` into [0, max] (max < 0 collapses to 0). */
const clamp = (n: number, max: number) => Math.max(0, Math.min(n, Math.max(0, max)));

/**
 * Next selection after a key press. `rowCount`/`colCount` are the current view
 * and column counts. Returns null (no selectable cell) for an empty grid. With
 * no prior selection, the first navigation key selects the top-left cell. Any
 * non-navigation key returns the selection unchanged.
 */
export function moveSelection(
  sel: CellPos | null,
  key: string,
  rowCount: number,
  colCount: number,
): CellPos | null {
  if (rowCount <= 0 || colCount <= 0) return null;
  if (!isNavKey(key)) return sel;
  if (!sel) return { r: 0, c: 0 };

  let { r, c } = sel;
  switch (key) {
    case "ArrowUp": r -= 1; break;
    case "ArrowDown": r += 1; break;
    case "ArrowLeft": c -= 1; break;
    case "ArrowRight": c += 1; break;
    case "Home": c = 0; break;
    case "End": c = colCount - 1; break;
    case "PageUp": r -= PAGE_STEP; break;
    case "PageDown": r += PAGE_STEP; break;
  }
  return { r: clamp(r, rowCount - 1), c: clamp(c, colCount - 1) };
}

/**
 * New scrollTop needed so view-row `r` is fully visible in the rows viewport,
 * or null when it already is. The grid's header/filter are sticky, so scrollTop
 * maps directly to row offset (row r spans [r*rowHeight, (r+1)*rowHeight)).
 * `rowsViewport` is the height available for rows (viewport minus sticky chrome).
 */
export function scrollRowIntoView(
  r: number,
  rowHeight: number,
  scrollTop: number,
  rowsViewport: number,
): number | null {
  if (rowHeight <= 0 || rowsViewport <= 0) return null;
  const top = r * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + rowsViewport) return bottom - rowsViewport;
  return null;
}
