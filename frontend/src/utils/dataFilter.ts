// The filter panel's state, and the SQL it turns into (issue #347).
//
// A table opened from the tree is browsed through this instead of through the
// editor: the conditions and the sort become the WHERE and ORDER BY of the paged
// preview, so both run at the SERVER over the whole table. The grid's own header
// sort and column filters only ever reordered the page that came back, which is
// what it has been warning about under every truncated result.
//
// Pure: the predicates themselves are rendered by utils/queryBuilder, which the
// visual query builder shares, and the paging is utils/pagination's. What lives
// here is the panel's own shape — what is drafted, what is applied, and whether
// those two have drifted apart.

import type { PreviewFilter } from "./pagination";
import {
  renderOrderBy,
  renderWhere,
  type ColumnTypes,
  type Condition,
  type OrderBy,
} from "./queryBuilder";

export interface FilterState {
  conditions: Condition[];
  /** How the conditions combine. One connector for the list; no nesting yet. */
  conjunction: "AND" | "OR";
  order: OrderBy[];
  /**
   * The filter the rows on screen were actually fetched with, or null when they
   * came back unfiltered. Kept as the rendered SQL rather than a copy of the
   * draft: it is what paging has to repeat, and comparing it to the draft is
   * what tells the user their edits are not on screen yet.
   */
  applied: PreviewFilter | null;
  /** Panel folded away. Open on first sight, so the feature is discoverable. */
  collapsed: boolean;
}

export function emptyFilter(): FilterState {
  return { conditions: [], conjunction: "AND", order: [], applied: null, collapsed: false };
}

/** The WHERE/ORDER BY the current draft renders to. */
export function draftFilter(
  engine: string,
  state: FilterState,
  types?: ColumnTypes,
): PreviewFilter {
  return {
    where: renderWhere(engine, state.conditions, state.conjunction, types),
    orderBy: renderOrderBy(engine, state.order),
  };
}

/** Two filters are the same when they render to the same two clauses. */
export function sameFilter(a: PreviewFilter | null, b: PreviewFilter | null): boolean {
  return (a?.where ?? "") === (b?.where ?? "") && (a?.orderBy ?? "") === (b?.orderBy ?? "");
}

/**
 * Whether the draft says something the rows on screen do not reflect. Drives the
 * "criteria not applied" note: a panel that silently disagrees with its grid is
 * worse than no panel, because the numbers look answered.
 */
export function filterIsDirty(
  engine: string,
  state: FilterState,
  types?: ColumnTypes,
): boolean {
  return !sameFilter(draftFilter(engine, state, types), state.applied);
}

/** Whether anything at all is being filtered or sorted right now. */
export function filterIsEmpty(filter: PreviewFilter | null): boolean {
  return !filter?.where && !filter?.orderBy;
}

/**
 * The state after applying the draft: what is on screen now matches what is
 * written. Returns a new object.
 */
export function applyFilter(
  engine: string,
  state: FilterState,
  types?: ColumnTypes,
): FilterState {
  return { ...state, applied: draftFilter(engine, state, types) };
}

/**
 * Set the sort to a single column, cycling the way a grid header does:
 * ascending, descending, then off. Any other sort columns are dropped — clicking
 * a header means "sort by this", and quietly keeping a previous column would
 * make the result unexplainable.
 */
export function cycleSortColumn(order: OrderBy[], column: string): OrderBy[] {
  const current = order.length === 1 && order[0].column === column ? order[0].dir : null;
  if (current === null) return [{ column, dir: "ASC" }];
  if (current === "ASC") return [{ column, dir: "DESC" }];
  return [];
}
