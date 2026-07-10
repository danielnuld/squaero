// Pure paging math for the "open table" preview grid. The preview fetches one
// page at a time with a server-side LIMIT/OFFSET (utils/pagination.ts), so the
// query caps its own row count and the core cannot peek past it to know whether a
// further page exists. We therefore infer "has more" from the returned page: a
// full page means another page may exist (the standard full-page heuristic — the
// only cost is one empty final page when the row count is an exact multiple).

/** The offset of the page `delta` steps away, clamped to >= 0 (page size >= 1). */
export function nextOffset(offset: number, delta: number, size: number): number {
  const s = Math.max(1, Math.floor(size));
  return Math.max(0, Math.floor(offset) + Math.trunc(delta) * s);
}

/** Whether a further page may exist: true when a full page of rows came back. */
export function pageHasMore(rowCount: number, size: number): boolean {
  return rowCount >= Math.max(1, Math.floor(size));
}
