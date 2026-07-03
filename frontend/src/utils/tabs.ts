// Pure tab-list management for the query workspace. Components hold the tab
// array in a signal; these helpers compute the next state immutably so they can
// be unit-tested without a DOM (see .rules/frontend.md §4).

export interface QueryTab {
  /** Stable unique id. */
  id: number;
  /** Display title. */
  title: string;
  /** Current SQL text in the editor. */
  sql: string;
}

export interface TabState {
  tabs: QueryTab[];
  activeId: number;
}

/** Returns an id greater than every existing tab id (1 for an empty list). */
export function nextTabId(tabs: QueryTab[]): number {
  return tabs.reduce((max, t) => Math.max(max, t.id), 0) + 1;
}

/** Appends a fresh empty tab and makes it active. */
export function addTab(state: TabState, title = "Consulta"): TabState {
  const id = nextTabId(state.tabs);
  const tab: QueryTab = { id, title: `${title} ${id}`, sql: "" };
  return { tabs: [...state.tabs, tab], activeId: id };
}

/**
 * Closes the tab with `id`. If it was active, selects a neighbor (the previous
 * tab, or the next one when closing the first). Closing the last remaining tab
 * yields an empty list with activeId 0.
 */
export function closeTab(state: TabState, id: number): TabState {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) {
    return state;
  }
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (tabs.length === 0) {
    return { tabs, activeId: 0 };
  }
  let activeId = state.activeId;
  if (state.activeId === id) {
    const neighbor = tabs[Math.max(0, index - 1)];
    activeId = neighbor.id;
  }
  return { tabs, activeId };
}

/** Replaces the SQL text of the tab with `id` (no-op if not found). */
export function updateTabSql(state: TabState, id: number, sql: string): TabState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === id ? { ...t, sql } : t)),
  };
}

/** Returns the active tab, or undefined when none. */
export function activeTab(state: TabState): QueryTab | undefined {
  return state.tabs.find((t) => t.id === state.activeId);
}

/**
 * Moves the active tab by `dir` (+1 next, -1 previous), wrapping around the
 * ends. A no-op when there are fewer than two tabs or the active id is unknown.
 * Used by the Ctrl+PageUp/PageDown shortcuts (issue #42).
 */
export function cycleTab(state: TabState, dir: 1 | -1): TabState {
  const n = state.tabs.length;
  if (n < 2) return state;
  const index = state.tabs.findIndex((t) => t.id === state.activeId);
  if (index === -1) return state;
  const next = state.tabs[(index + dir + n) % n];
  return { ...state, activeId: next.id };
}
