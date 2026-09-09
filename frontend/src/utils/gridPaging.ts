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

/** The displayed-result state a page turn decides from (issue #478). */
export interface PageableResult {
  /** The SQL that produced the displayed page; absent for a script. */
  pageSql?: string;
  offset?: number;
  pageSize?: number;
  /** Set when the result is an "open table" preview (it regenerates its SQL). */
  preview?: unknown;
  /** The core still holds an open cursor for this result. */
  cursor?: boolean;
  /** Pages already fetched, indexed by page number. */
  pages?: unknown[];
}

/** How the page `delta` steps away is obtained. */
export type PageStep =
  /** Already fetched: show it again, no round-trip. */
  | { kind: "cached"; index: number }
  /** Continue the open cursor: the query is not executed again. */
  | { kind: "cursor"; index: number; offset: number }
  /** Re-run the table preview with a server-side offset. */
  | { kind: "preview"; index: number; offset: number }
  /** Re-run the SQL at a new core-side offset. */
  | { kind: "query"; index: number; offset: number }
  | null;

/**
 * How to get the page `delta` steps from the one on screen (issue #478).
 *
 * Order matters, and it is the whole point of the helper: a page already
 * fetched is shown from memory, the next page continues the cursor the core
 * kept open, and only a result with neither falls back to re-running the query
 * — which is what made paging a heavy query cost the query again, every time.
 * Backwards always finds a cached page, because a cursor only moves forward.
 *
 * Null when there is nothing to turn to: before the first page, or for a result
 * that is not pageable at all (a script). Pure.
 */
export function pageStep(r: PageableResult | undefined, delta: 1 | -1): PageStep {
  if (!r) return null;
  const size = Math.floor(r.pageSize ?? 0);
  if (size < 1) return null;   /* not a paged result (a script) */
  const index = Math.max(0, Math.round((r.offset ?? 0) / size));
  const target = index + delta;
  if (target < 0) return null;
  const offset = target * size;
  if (r.pages?.[target] !== undefined) return { kind: "cached", index: target };
  /* The cursor sits right after the last page fetched, so it can only serve
     that one. Anything else re-runs. */
  if (delta === 1 && r.cursor && target === (r.pages?.length ?? -1)) {
    return { kind: "cursor", index: target, offset };
  }
  if (r.preview) return { kind: "preview", index: target, offset };
  if (r.pageSql) return { kind: "query", index: target, offset };
  return null;
}

/** The displayed-result state a refresh decides from. */
export interface RefreshableResult {
  /** The SQL that produced the displayed page. */
  pageSql?: string;
  offset?: number;
  /** Set when the result is an "open table" preview (it regenerates its SQL). */
  preview?: unknown;
}

/** What a refresh must re-run. */
export type RefreshAction =
  | { kind: "preview"; offset: number }
  | { kind: "query"; sql: string; offset: number }
  | null;

/**
 * What refreshing a displayed result must re-run (issue #314): the table preview
 * at its current page, or the SQL that produced the page — never the editor's
 * current text, which the user may have replaced with something else entirely
 * since the query ran (re-running it would execute a statement nobody asked for).
 * Null when nothing has been run in the tab: there is nothing on screen to
 * refresh, so no statement is executed. Pure.
 */
export function refreshAction(r: RefreshableResult | undefined): RefreshAction {
  if (!r) return null;
  if (r.preview) return { kind: "preview", offset: r.offset ?? 0 };
  if (r.pageSql) return { kind: "query", sql: r.pageSql, offset: r.offset ?? 0 };
  return null;
}

/** Why a refresh cannot run right now; null when it can. */
export type RefreshBlock = "editing" | "running" | "nothing" | null;

/**
 * Whether the result on screen can be re-run, and why not when it cannot
 * (issue #448). A blocked refresh is shown disabled WITH its reason rather than
 * hidden, the same rule the related-data entry follows (#344) — a button that
 * vanishes leaves "it stopped being there" as the whole explanation.
 *
 * An open edit session blocks it on purpose: re-running the query would throw
 * away uncommitted changes without saying so. Pure.
 */
export function refreshBlock(
  r: RefreshableResult | undefined,
  state: { editing: boolean; loading: boolean },
): RefreshBlock {
  if (state.editing) return "editing";
  if (state.loading) return "running";
  if (!refreshAction(r)) return "nothing";
  return null;
}
