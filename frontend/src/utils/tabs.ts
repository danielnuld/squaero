// Pure tab-list management for the workspace. A tab is either a SQL query editor
// or a tool (server monitor, user manager, table designer, wizards, …) opened in
// the same window instead of a modal (UX refactor). Components hold the tab array
// in a signal; these helpers compute the next state immutably so they can be
// unit-tested without a DOM (see .rules/frontend.md §4).

/** Which tool a tool-tab hosts. */
export type ToolKind =
  | "monitor"
  | "users"
  | "generator"
  | "import"
  | "tableDesigner"
  | "structure"
  | "history"
  | "snippets"
  | "connectionForm"
  | "schemaSync"
  | "dataDiff"
  | "transfer"
  | "chart"
  | "help";

/** A SQL query editor tab. */
export interface QueryTab {
  id: number;
  kind: "query";
  /** Display title. */
  title: string;
  /** Current SQL text in the editor. */
  sql: string;
}

/** A tool tab hosting a panel that used to be a modal. */
export interface ToolTab {
  id: number;
  kind: "tool";
  title: string;
  tool: ToolKind;
  /** Identity for focus-instead-of-duplicate (e.g. `gen:orders`). */
  key?: string;
  /** Tool-specific payload (table target, wizard snapshot, …). */
  params?: unknown;
  /** The query tab this tool acts on, when it reloads/reads that result. */
  sourceId?: number;
}

export type Tab = QueryTab | ToolTab;

export interface TabState {
  tabs: Tab[];
  activeId: number;
}

/** Returns an id greater than every existing tab id (1 for an empty list). */
export function nextTabId(tabs: Tab[]): number {
  return tabs.reduce((max, t) => Math.max(max, t.id), 0) + 1;
}

/** Appends a fresh empty query tab and makes it active. */
export function addTab(state: TabState, title = "Consulta"): TabState {
  const id = nextTabId(state.tabs);
  const tab: QueryTab = { id, kind: "query", title: `${title} ${id}`, sql: "" };
  return { tabs: [...state.tabs, tab], activeId: id };
}

/**
 * Open a tool tab. If a tab with the same tool + key already exists it is focused
 * instead of duplicated; otherwise a new tool tab is appended and activated.
 */
export function openTool(
  state: TabState,
  tool: ToolKind,
  title: string,
  opts: { key?: string; params?: unknown; sourceId?: number } = {},
): TabState {
  const existing = state.tabs.find(
    (t): t is ToolTab =>
      t.kind === "tool" && t.tool === tool && (opts.key === undefined || t.key === opts.key),
  );
  if (existing) {
    return { ...state, activeId: existing.id };
  }
  const id = nextTabId(state.tabs);
  const tab: ToolTab = { id, kind: "tool", title, tool, ...opts };
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

/**
 * Closes every tab except `id`, which becomes the only (and active) tab. A
 * no-op when `id` is unknown. Used by the tab context menu ("Cerrar las demás").
 */
export function closeOtherTabs(state: TabState, id: number): TabState {
  const keep = state.tabs.find((t) => t.id === id);
  if (!keep) {
    return state;
  }
  return { tabs: [keep], activeId: id };
}

/** Replaces the SQL text of the query tab with `id` (no-op if not found or not a
    query tab). */
export function updateTabSql(state: TabState, id: number, sql: string): TabState {
  return {
    ...state,
    tabs: state.tabs.map((t) => (t.id === id && t.kind === "query" ? { ...t, sql } : t)),
  };
}

/** Returns the active tab, or undefined when none. */
export function activeTab(state: TabState): Tab | undefined {
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
