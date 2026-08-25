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
  | "indexes"
  | "structure"
  | "history"
  | "snippets"
  | "connectionForm"
  | "schemaSync"
  | "dataDiff"
  | "transfer"
  | "chart"
  | "erDiagram"
  | "queryBuilder"
  | "routines"
  | "triggers"
  | "slowQueries"
  | "explainPlan"
  | "objectList"
  | "notebook"
  | "settings"
  | "help";

/** A SQL query editor tab. */
export interface QueryTab {
  id: number;
  kind: "query";
  /** Display title. */
  title: string;
  /** Current SQL text in the editor. */
  sql: string;
  /** The saved-connection id this tab runs against, bound at creation so the tab
      keeps hitting its own connection even when another is focused. Undefined for
      a tab created with no connection (it then follows whatever is focused). */
  connDefId?: string;
  /** The snippet this tab was opened from (issue #338). Its identity: one tab per
      snippet, and it is what lets the editor save changes back to that snippet
      instead of piling a second copy onto the list. */
  snippetId?: string;
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
  /** The connection this tool acts on, bound at creation so it does not drift
      when another connection is focused (mirrors QueryTab.connDefId). */
  connDefId?: string;
}

export type Tab = QueryTab | ToolTab;

export interface TabState {
  tabs: Tab[];
  activeId: number;
  /** Highest id ever handed out in this session, kept so a closed tab's id is
      never reused. The app keys per-tab state (results, filters, columns, edit
      sessions) by tab id, and a recycled id made a brand-new tab inherit the
      previous one's grid — a table's `preview` even hid the editor behind the
      filter panel — besides letting an in-flight query land in it. */
  seq?: number;
}

/** Returns an id greater than every existing tab id AND than every id already
    handed out (`seq`), so ids only ever move forward. 1 for an empty list. */
export function nextTabId(tabs: Tab[], seq = 0): number {
  return tabs.reduce((max, t) => Math.max(max, t.id), seq) + 1;
}

/** Appends a fresh empty query tab and makes it active. Binds it to `connDefId`
    (the connection focused at creation) so its queries stay on that connection.
    Generic tabs get a numbered title ("Consulta 3"); pass `numbered: false` when
    the title already names something (a table, a routine) so it is used as-is. */
export function addTab(
  state: TabState,
  title = "Consulta",
  connDefId?: string,
  numbered = true,
): TabState {
  const id = nextTabId(state.tabs, state.seq);
  const tab: QueryTab = {
    id,
    kind: "query",
    title: numbered ? `${title} ${id}` : title,
    sql: "",
    connDefId,
  };
  return { tabs: [...state.tabs, tab], activeId: id, seq: id };
}

/**
 * Open a tool tab. If a tab with the same tool + key already exists it is focused
 * instead of duplicated; otherwise a new tool tab is appended and activated.
 */
export function openTool(
  state: TabState,
  tool: ToolKind,
  title: string,
  opts: { key?: string; params?: unknown; sourceId?: number; connDefId?: string } = {},
): TabState {
  const existing = state.tabs.find(
    (t): t is ToolTab =>
      t.kind === "tool" && t.tool === tool && (opts.key === undefined || t.key === opts.key),
  );
  if (existing) {
    return { ...state, activeId: existing.id };
  }
  const id = nextTabId(state.tabs, state.seq);
  const tab: ToolTab = { id, kind: "tool", title, tool, ...opts };
  return { tabs: [...state.tabs, tab], activeId: id, seq: id };
}

/**
 * Open a snippet in a query tab of its own (issue #338), the same
 * focus-instead-of-duplicate rule `openTool` applies: a snippet already open is
 * refocused rather than opened twice.
 *
 * This is what "open a snippet" means now. Dropping the body at the cursor of
 * whatever tab happened to be active mixed two queries into one editor, so what
 * ran stopped being what the user thought they had in front of them; inserting
 * is still available, but it is asked for explicitly.
 */
export function openSnippetTab(
  state: TabState,
  snip: { id: string; name: string; body: string },
  connDefId?: string,
): TabState {
  const open = state.tabs.find(
    (t): t is QueryTab => t.kind === "query" && t.snippetId === snip.id,
  );
  if (open) {
    return { ...state, activeId: open.id };
  }
  const id = nextTabId(state.tabs, state.seq);
  const tab: QueryTab = {
    id,
    kind: "query",
    title: snip.name,
    sql: snip.body,
    connDefId,
    snippetId: snip.id,
  };
  return { tabs: [...state.tabs, tab], activeId: id, seq: id };
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
    return { ...state, tabs, activeId: 0 };
  }
  let activeId = state.activeId;
  if (state.activeId === id) {
    const neighbor = tabs[Math.max(0, index - 1)];
    activeId = neighbor.id;
  }
  return { ...state, tabs, activeId };
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
  return { ...state, tabs: [keep], activeId: id };
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

// --- Workspace persistence (issue #401) -------------------------------------
//
// What is lost when the process dies is not the query you ran — that is in the
// history — but the one you had not run yet, and which tabs were open. So the
// workspace is serialized to storage and rehydrated on start.
//
// Only QUERY tabs are kept. A tool tab is a live panel over state that is not
// stored (a server monitor, a half-filled wizard, a result being charted);
// restoring the shell without what was behind it is worse than not restoring
// it. Results are not stored either: a grid can hold thousands of rows, and one
// rebuilt from disk would look fresh while being arbitrarily old. The SQL comes
// back, the data is re-read on demand.

/** Ceiling on restored tabs. A workspace this size is already unmanageable, and
    the cap keeps one runaway session from filling the store. Oldest go first. */
export const MAX_RESTORED_TABS = 50;

/** The workspace as stored: the query tabs, which one was active, and the id
    counter — `seq` travels with them because ids must never move backwards
    across a restart either (see TabState.seq and issue #355). */
interface StoredWorkspace {
  tabs: QueryTab[];
  activeId: number;
  seq: number;
}

/** Serializes the query tabs of `state` for storage. */
export function serializeWorkspace(state: TabState): string {
  const tabs = state.tabs
    .filter((t): t is QueryTab => t.kind === "query")
    .slice(-MAX_RESTORED_TABS);
  // The active tab may be a tool one, which is not stored: fall back to the last
  // query tab so what reopens is focused on something that exists.
  const active = tabs.some((t) => t.id === state.activeId)
    ? state.activeId
    : (tabs[tabs.length - 1]?.id ?? 0);
  const stored: StoredWorkspace = {
    tabs,
    activeId: active,
    seq: tabs.reduce((max, t) => Math.max(max, t.id), state.seq ?? 0),
  };
  return JSON.stringify(stored);
}

/**
 * Rebuilds a TabState from storage, or null when there is nothing usable —
 * empty, corrupt, or a workspace whose tabs were all tool tabs. The caller then
 * opens its normal first tab, so a bad payload can never leave the app tabless.
 */
export function parseWorkspace(raw: string | null): TabState | null {
  if (!raw) return null;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const w = data as Partial<StoredWorkspace>;
  if (!Array.isArray(w?.tabs)) return null;

  const tabs: QueryTab[] = [];
  for (const item of w.tabs.slice(-MAX_RESTORED_TABS)) {
    const t = item as Partial<QueryTab>;
    if (
      typeof t?.id === "number" &&
      Number.isFinite(t.id) &&
      t.kind === "query" &&
      typeof t.title === "string" &&
      typeof t.sql === "string" &&
      !tabs.some((k) => k.id === t.id)
    ) {
      const tab: QueryTab = { id: t.id, kind: "query", title: t.title, sql: t.sql };
      if (typeof t.connDefId === "string") tab.connDefId = t.connDefId;
      if (typeof t.snippetId === "string") tab.snippetId = t.snippetId;
      tabs.push(tab);
    }
  }
  if (tabs.length === 0) return null;

  const activeId = tabs.some((t) => t.id === w.activeId) ? w.activeId! : tabs[0].id;
  // Never below the highest id restored, whatever the stored counter says: a
  // recycled id would hand a new tab the previous one's results and filters.
  const seq = tabs.reduce(
    (max, t) => Math.max(max, t.id),
    typeof w.seq === "number" && Number.isFinite(w.seq) ? w.seq : 0,
  );
  return { tabs, activeId, seq };
}
