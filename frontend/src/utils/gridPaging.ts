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
