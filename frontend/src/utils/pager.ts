// The pager under a table's rows (issues #688, A-20, R-38): which rows are on
// screen, of how many when the total has been counted, and which jumps are
// possible. Pure; the workspace runs the page queries.

export interface PagerInput {
  /** Offset of the first row on screen. */
  offset: number;
  /** Rows on screen. */
  rows: number;
  /** Rows per page (> 0). */
  size: number;
  /** Rows in the table under its filter, once counted; null until then. */
  total: number | null;
  /** A full page came back, so there may be more. */
  more: boolean;
  /** Unsaved edits hold the page still (#134). */
  paused: boolean;
}

export interface PagerView {
  from: number;
  to: number;
  /** 1-based page number. */
  page: number;
  /** Known only with a total. */
  pages: number | null;
  canFirst: boolean;
  canPrev: boolean;
  canNext: boolean;
  /** Only with a total: the last page has to be named to be reached. */
  canLast: boolean;
  /** Offset of the last page, with a total. */
  lastOffset: number | null;
}

export function pagerView(p: PagerInput): PagerView {
  const size = Math.max(1, Math.floor(p.size));
  const offset = Math.max(0, Math.floor(p.offset));
  const page = Math.floor(offset / size) + 1;
  const pages = p.total === null ? null : Math.max(1, Math.ceil(p.total / size));
  const lastOffset = pages === null ? null : (pages - 1) * size;
  const atStart = offset === 0;
  // A counted total is the better witness of "more" than a full page, which
  // may also be the exact last one.
  const more = p.total === null ? p.more : offset + p.rows < p.total;
  return {
    from: p.rows > 0 ? offset + 1 : offset,
    to: offset + p.rows,
    page,
    pages,
    canFirst: !p.paused && !atStart,
    canPrev: !p.paused && !atStart,
    canNext: !p.paused && more,
    canLast: !p.paused && lastOffset !== null && offset < lastOffset,
    lastOffset,
  };
}

/** The page sizes a table's pager offers (A-20, R-38). */
export const PAGE_SIZES = [100, 500, 1000, 5000] as const;
export const DEFAULT_PAGE_SIZE = 1000;
export const PAGE_SIZE_KEY = "quaero.pageSize";

/** A remembered page size, or the default when it is missing or not offered. */
export function parsePageSize(raw: string | null | undefined): number {
  const n = Number(raw);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

/**
 * Where a table lands after its page size changes: the page of the new size
 * that still holds the row that was first on screen, so the reader stays put.
 */
export function offsetForPageSize(offset: number, size: number): number {
  const s = Math.max(1, Math.floor(size));
  return Math.floor(Math.max(0, offset) / s) * s;
}

/**
 * The offset of a page typed into the pager's field (R-38), or null when the
 * text is not a page: not a whole number, below 1, or past the last page when
 * the total is known. 1-based, as the field shows it.
 */
export function offsetForPage(text: string, size: number, pages: number | null): number | null {
  const page = Number(text.trim());
  if (!Number.isInteger(page) || page < 1) return null;
  if (pages !== null && page > pages) return null;
  return (page - 1) * Math.max(1, Math.floor(size));
}
