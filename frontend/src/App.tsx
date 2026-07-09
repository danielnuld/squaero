import {
  For,
  Show,
  Switch,
  Match,
  createMemo,
  createSignal,
  createEffect,
  onMount,
  onCleanup,
} from "solid-js";
import { createStore } from "solid-js/store";
import { runQuery, type ResultSet } from "./utils/query";
import { errorText, describeError } from "./utils/errors";
import { openConnection, closeConnection, testConnection } from "./utils/conn";
import {
  addTab,
  openTool,
  closeTab,
  closeOtherTabs,
  cycleTab,
  updateTabSql,
  activeTab,
  type TabState,
  type QueryTab,
  type ToolTab,
  type Tab,
} from "./utils/tabs";
import { openContextMenu, type MenuItem } from "./utils/contextMenu";
import { type RunScope } from "./utils/runScope";
import { rowToTsv, rowToJson, copyText } from "./utils/rowCopy";
import {
  loadTheme,
  saveTheme,
  nextTheme,
  applyTheme,
  type ThemePref,
} from "./utils/theme";
import { loadSkin, saveSkin, applySkin, type SkinPref } from "./utils/skin";
import { matchShortcut } from "./utils/shortcuts";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { clampSidebarWidth, SIDEBAR_DEFAULT } from "./utils/layout";
import {
  buildDsn,
  nextConnectionId,
  upsertConnection,
  removeConnection,
  AVAILABLE_DRIVERS,
  type Connection,
} from "./utils/connections";
import { loadConnections, saveConnections } from "./utils/connectionStore";
import { exportConnections, importConnections, summaryText } from "./utils/connectionsIO";
import { addHistory, clampLimit, type HistoryEntry } from "./utils/history";
import {
  loadHistory,
  saveHistory,
  loadHistoryLimit,
  saveHistoryLimit,
} from "./utils/historyStore";
import {
  addSnippet,
  renameSnippet,
  removeSnippet,
  mergeSnippets,
  parseSnippets,
  serializeSnippets,
  type Snippet,
} from "./utils/snippets";
import { loadSnippets, saveSnippets } from "./utils/snippetStore";
import { rowHeightFor, type Settings } from "./utils/settings";
import { loadSettings, saveSettings } from "./utils/settingsStore";
import { pushRecent } from "./utils/recentTables";
import type { Command } from "./utils/commandPalette";
import { schemaDescribe, schemaTree, parseTreeRows } from "./utils/schema";
import { objectPreviewQuery } from "./utils/pagination";
import { useDatabaseSql } from "./utils/dbContext";
import {
  describePkColumns,
  describeColumnNames,
  runPlanItem,
  txBegin,
  txCommit,
  txRollback,
} from "./utils/edit";
import {
  emptyPending,
  setCell,
  toggleDelete,
  addInsert,
  setInsertCell,
  removeInsert,
  hasChanges,
  changeCount,
  buildPlan,
  type EditSource,
  type PendingChanges,
} from "./utils/editSession";
import {
  exportResult,
  mimeFor,
  fileNameFor,
  type ExportFormat,
} from "./utils/exporters";
import { buildXlsx, XLSX_MIME } from "./utils/xlsx";
import { saveText, saveBytes } from "./utils/download";
import type { TreeNode } from "./utils/tree";
import { SqlEditor } from "./components/SqlEditor";
import { ResultGrid } from "./components/ResultGrid";
import { StatusBar } from "./components/StatusBar";
import { SettingsPanel } from "./components/SettingsPanel";
import { EmptyState } from "./components/EmptyState";
import { BrandWordmark } from "./components/Brand";
import { CommandPalette } from "./components/CommandPalette";
import { SlowQueries } from "./components/SlowQueries";
import { ExplainPlan } from "./components/ExplainPlan";
import { UpdateModal } from "./components/UpdateModal";
import { TOOL_CATALOG } from "./utils/toolCatalog";
import { APP_VERSION } from "./utils/version";
import {
  checkForUpdate,
  loadSkippedVersion,
  saveSkippedVersion,
  type UpdateInfo,
} from "./utils/update";
import { openExternal } from "./utils/openExternal";
import { canInstall, installUpdate } from "./utils/installUpdate";
import { ConnectionBar } from "./components/ConnectionBar";
import { AppToolbar } from "./components/AppToolbar";
import { ObjectToolbar } from "./components/ObjectToolbar";
import { ObjectListView } from "./components/ObjectListView";
import { InfoPane } from "./components/InfoPane";
import { ConnectionForm } from "./components/ConnectionForm";
import { ObjectTree } from "./components/ObjectTree";
import { StructureView } from "./components/StructureView";
import { ImportWizard } from "./components/ImportWizard";
import { DataGenerator } from "./components/DataGenerator";
import { ServerMonitor } from "./components/ServerMonitor";
import { UserManager } from "./components/UserManager";
import { ChartView } from "./components/ChartView";
import { ErDiagram } from "./components/ErDiagram";
import { QueryBuilder } from "./components/QueryBuilder";
import { RoutineExplorer } from "./components/RoutineExplorer";
import { TriggersExplorer } from "./components/TriggersExplorer";
import { ContextMenu } from "./components/ContextMenu";
import { TableDesigner } from "./components/TableDesigner";
import { IndexManager } from "./components/IndexManager";
import { SchemaSyncWizard } from "./components/SchemaSyncWizard";
import { DataDiffWizard } from "./components/DataDiffWizard";
import { TransferWizard } from "./components/TransferWizard";
import { HistoryPanel } from "./components/HistoryPanel";
import { SnippetsPanel } from "./components/SnippetsPanel";
import { RowDetail } from "./components/RowDetail";
import { stepRowIndex } from "./utils/rowDetail";

// Per-tab execution state, keyed by tab id.
interface TabResult {
  loading: boolean;
  error: string | null;
  result: ResultSet | null;
  elapsedMs: number | null;
  /** What the last run executed — selection / statement / document (issue #130). */
  ranScope?: RunScope | null;
  /** The table this result was read from + its PK, when opened from the tree.
      Present + pk non-empty => the grid is editable. */
  source?: EditSource | null;
  /** Offset pagination (issue #134): the SQL that produced this page, the current
      row offset, and the page size — so prev/next re-run the same SQL at a new
      offset. `truncated` on the result means a further page exists. */
  pageSql?: string;
  offset?: number;
  pageSize?: number;
}

// Per-tab edit-session state (M7). Present only while editing a tab.
interface EditSessionState {
  editing: boolean;
  pending: PendingChanges;
  busy: boolean;
  error: string | null;
  /** Generated SQL statements to confirm; non-null shows the preview dialog. */
  preview: string[] | null;
}

const emptyEdit = (): EditSessionState => ({
  editing: false,
  pending: emptyPending(),
  busy: false,
  error: null,
  preview: null,
});

// The live connection opened in the core: its core-side connId plus the saved
// connection's display name.
interface ActiveConnection {
  /** The saved connection's id (stable across reconnects). */
  defId: string;
  /** The core session id (changes on reconnect). */
  connId: string;
  name: string;
  driver: string;
  /** Accent color carried from the saved connection, for the bar/tabs. */
  color?: string;
}

// Sent explicitly rather than relying on the core's default so the page size is
// owned by the UI. True page-by-page fetching (offset/cursor) needs protocol
// support and lands later; for now the grid virtualizes the returned page and
// surfaces `truncated` honestly.
const PAGE_LIMIT = 1000;

const emptyResult = (): TabResult => ({
  loading: false,
  error: null,
  result: null,
  elapsedMs: null,
});

// A table target (import / generator / diff / transfer / structure).
type EditTarget = { table: string; db?: string; schema?: string };

// Any export the workspace offers: the text formats plus binary XLSX (issue #141).
type AnyExportFormat = ExportFormat | "xlsx";
const EXPORT_FORMATS: { fmt: AnyExportFormat; label: string }[] = [
  { fmt: "csv", label: "CSV" },
  { fmt: "json", label: "JSON" },
  { fmt: "xlsx", label: "Excel" },
  { fmt: "xml", label: "XML" },
  { fmt: "html", label: "HTML" },
  { fmt: "sql", label: "SQL" },
];

// Root layout: resizable sidebar (connection manager) | tabbed workspace
// (editor over result grid), with a status bar across the bottom. Connecting
// opens a real connection in the core; running SQL goes through query.run and
// renders into the virtualized grid — the demonstrable end-to-end path (#17).
export function App() {
  const [tabs, setTabs] = createSignal<TabState>(addTab({ tabs: [], activeId: 0 }));
  const [results, setResults] = createStore<Record<number, TabResult>>({});
  const [edits, setEdits] = createStore<Record<number, EditSessionState>>({});
  const [sidebarWidth, setSidebarWidth] = createSignal(SIDEBAR_DEFAULT);

  const [connections, setConnections] = createSignal<Connection[]>(loadConnections());
  // Several connections can be open at once; `focusedDefId` names the one the
  // object tree and newly-created query tabs bind to. `active`/`activeDefId` are
  // derived views of the focused connection, so most of the app keeps referring
  // to "the current connection" unchanged.
  const [openConns, setOpenConns] = createSignal<ActiveConnection[]>([]);
  const [focusedDefId, setFocusedDefId] = createSignal<string | null>(null);
  const active = () => openConns().find((o) => o.defId === focusedDefId()) ?? null;
  const activeDefId = focusedDefId;
  const focusConn = (defId: string) => setFocusedDefId(defId);
  // The connection a tab runs against: its bound one (if still open), else — for
  // an unbound tab — the focused connection.
  const tabConn = (tab: Tab | undefined): ActiveConnection | null => {
    if (tab && tab.connDefId) {
      return openConns().find((o) => o.defId === tab.connDefId) ?? null;
    }
    return active();
  };
  // The accent color of a query tab's bound connection, for the tab strip.
  const tabColor = (tab: Tab): string | undefined =>
    tab.kind === "query" && tab.connDefId
      ? connections().find((c) => c.id === tab.connDefId)?.color
      : undefined;
  // Working database context: the databases available on the active connection
  // and the one selected. Scopes the ER diagram / query builder and (on engines
  // that allow it) sets the editor's default database via USE.
  const [databases, setDatabases] = createSignal<string[]>([]);
  const [activeDb, setActiveDb] = createSignal<string | null>(null);
  const [connectingId, setConnectingId] = createSignal<string | null>(null);
  const [treeReload, setTreeReload] = createSignal(0);
  // Row form/detail view (issue #133): index of the loaded row shown as a form,
  // or null when closed. Navigation walks the loaded rows in original order.
  const [detailIndex, setDetailIndex] = createSignal<number | null>(null);

  // --- Query history (issue #128) ----------------------------------------
  const [history, setHistory] = createSignal<HistoryEntry[]>(loadHistory());
  const [historyLimit, setHistoryLimit] = createSignal(loadHistoryLimit());

  // --- Favorites / snippets (issue #129) ---------------------------------
  const [snippets, setSnippets] = createSignal<Snippet[]>(loadSnippets());
  const [snippetInsert, setSnippetInsert] = createSignal({ text: "", tick: 0 });

  // --- Recently opened tables (issue #178, editor empty state) -----------
  const [recentTables, setRecentTables] = createSignal<TreeNode[]>([]);
  const recordRecent = (node: TreeNode) => setRecentTables((l) => pushRecent(l, node));

  // --- Command palette (issue #174) --------------------------------------
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  // "all" is the full palette (Mod+K); "objects" scopes it to the connection's
  // tables/views (Mod+P), for a quick go-to-object jump.
  const [paletteMode, setPaletteMode] = createSignal<"all" | "objects">("all");
  const [loadedObjects, setLoadedObjects] = createSignal<TreeNode[]>([]);

  // Bumped by Ctrl/Cmd+F to open the SQL editor's find panel (see SqlEditor).
  const [findTick, setFindTick] = createSignal(0);

  // A newer release found on startup (autoupdater); drives the update modal.
  const [update, setUpdate] = createSignal<UpdateInfo | null>(null);


  // --- User preferences (issue #181) -------------------------------------
  // Theme (above) and the history limit (below) keep their own stores; this
  // holds only the settings owned by settings.ts (grid density, slow threshold,
  // check-updates-on-start). Patched immutably so the panel stays controlled.
  const [settings, setSettings] = createSignal<Settings>(loadSettings());
  const patchSettings = (patch: Partial<Settings>) => {
    const next = { ...settings(), ...patch };
    setSettings(next);
    saveSettings(next);
  };

  // --- Theme, shortcuts, help (issue #42) --------------------------------
  const safeStorage = (): Storage | undefined => {
    try {
      return typeof localStorage !== "undefined" ? localStorage : undefined;
    } catch {
      return undefined;
    }
  };
  const [theme, setTheme] = createSignal<ThemePref>(loadTheme(safeStorage()));

  const prefersDark = () =>
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  const isMac = () =>
    typeof navigator !== "undefined" &&
    /mac/i.test(navigator.platform || navigator.userAgent || "");

  const applyThemePref = (pref: ThemePref) => {
    setTheme(pref);
    saveTheme(pref, safeStorage());
    if (typeof document !== "undefined") {
      applyTheme(pref, document.documentElement, prefersDark());
    }
  };
  const toggleTheme = () => applyThemePref(nextTheme(theme()));

  // Accent skin (indigo brand vs an alternate blue), orthogonal to light/dark.
  const [skin, setSkin] = createSignal<SkinPref>(loadSkin(safeStorage()));
  const applySkinPref = (s: SkinPref) => {
    setSkin(s);
    saveSkin(s, safeStorage());
    if (typeof document !== "undefined") {
      applySkin(s, document.documentElement);
    }
  };

  const runShortcut = (action: ReturnType<typeof matchShortcut>) => {
    switch (action) {
      case "new-tab":
        setTabs((s) => addTab(s, "Consulta", focusedDefId() ?? undefined));
        break;
      case "close-tab": {
        const t = current();
        if (t) setTabs((s) => closeTab(s, t.id));
        break;
      }
      case "next-tab":
        setTabs((s) => cycleTab(s, 1));
        break;
      case "prev-tab":
        setTabs((s) => cycleTab(s, -1));
        break;
      case "refresh":
        refreshAll();
        break;
      case "toggle-theme":
        toggleTheme();
        break;
      case "toggle-help":
        showTool("help", "Atajos de teclado", { key: "help" });
        break;
      case "command-palette":
        setPaletteMode("all");
        setPaletteOpen((v) => !v);
        break;
      case "object-palette":
        // Always open scoped to objects (a "go to table/view" jump), never a
        // toggle — pressing Ctrl+P should reliably land on the object search.
        setPaletteMode("objects");
        setPaletteOpen(true);
        break;
      case "editor-find":
        setFindTick((t) => t + 1);
        break;
    }
  };

  // Refresh (issue #107): reload the object tree from the root and re-run the
  // active tab's query. An in-progress edit session is left untouched so a
  // refresh never silently discards pending changes.
  const refreshAll = () => {
    if (!active()) return;
    setTreeReload((n) => n + 1);
    const t = current();
    if (t && !currentEdit().editing) reloadCurrent(t.id);
  };

  // Check GitHub for a newer release once at startup; a hit (that the user has
  // not skipped) opens the update modal. Failures are swallowed in checkForUpdate.
  onMount(() => {
    void (async () => {
      const info = await checkForUpdate(APP_VERSION);
      if (info && info.version !== loadSkippedVersion()) setUpdate(info);
    })();
  });

  onMount(() => {
    if (typeof document !== "undefined") {
      applyTheme(theme(), document.documentElement, prefersDark());
      applySkin(skin(), document.documentElement);
    }
    // Follow the OS live while the preference is "system".
    const onSystemChange = () => {
      if (theme() === "system" && typeof document !== "undefined") {
        applyTheme("system", document.documentElement, prefersDark());
      }
    };
    const mql =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : undefined;
    mql?.addEventListener?.("change", onSystemChange);

    const onKey = (e: KeyboardEvent) => {
      const action = matchShortcut(e);
      if (!action) return;
      // While the command palette owns the screen, only the palette toggles act;
      // other shortcuts are swallowed (preventDefault, no-op) so the webview host
      // never runs its own find/print behind the overlay.
      if (paletteOpen() && action !== "command-palette" && action !== "object-palette") {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      runShortcut(action);
    };
    document.addEventListener("keydown", onKey);

    // Suppress the native WebView2/Chromium context menu everywhere. We ONLY
    // preventDefault here — we must not close our menu, because Solid delegates
    // `contextmenu` to the document, so this listener shares the node with the
    // surface handlers that just opened a menu (stopPropagation there does not
    // stop a same-node listener). Closing on an outside click is handled by the
    // ContextMenu's own mousedown listener, which fires before this on any
    // right-click (mousedown precedes contextmenu).
    const onNativeMenu = (e: MouseEvent) => e.preventDefault();
    document.addEventListener("contextmenu", onNativeMenu);

    onCleanup(() => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("contextmenu", onNativeMenu);
      mql?.removeEventListener?.("change", onSystemChange);
    });
  });

  // SQL formatting (issue #106): a bumped counter asks the editor to reformat,
  // using the active connection's engine to pick the dialect.
  const [formatTick, setFormatTick] = createSignal(0);
  const activeDialect = createMemo(() => {
    const id = activeDefId();
    if (!id) return "";
    return connections().find((c) => c.id === id)?.driver ?? "";
  });

  // Document/window title (issue #192): "Quaero — <conexión activa>" when a
  // connection is active, else just "Quaero". The native shell window title is
  // set to "Quaero" in main.cc; this keeps the document title in sync so the
  // active connection is reflected wherever the title surfaces.
  createEffect(() => {
    const conn = active();
    document.title = conn?.name ? `Quaero — ${conn.name}` : "Quaero";
  });

  // SQL autocomplete schema (issue #110). Table/view NAMES come from the loaded
  // object tree (no IPC), so name completion is instant. COLUMNS are cached
  // lazily as tables are opened (openData describes the table anyway) — we do NOT
  // eagerly describe dozens of tables at connect: on a single-connection engine
  // like Informix that avalanche of schema.describe calls monopolized the
  // connection and left the first table-open "loading" for seconds (issue: the
  // sidebar open hangs). Columns fill in progressively as the user browses.
  const [columnCache, setColumnCache] = createSignal<Record<string, string[]>>({});
  createEffect(() => {
    active();
    void treeReload(); // a connection switch or refresh clears the cache
    setColumnCache({});
  });
  const sqlSchema = createMemo<Record<string, string[]>>(() => {
    const cache = columnCache();
    const out: Record<string, string[]> = {};
    for (const n of loadedObjects()) {
      if (n.kind === "table" || n.kind === "view") out[n.label] = cache[n.label] ?? [];
    }
    return out;
  });

  const current = createMemo(() => activeTab(tabs()));
  // The active tab split by kind: query tabs drive the editor+grid panes; tool
  // tabs render their panel in the same workspace area (UX refactor: tools open
  // as tabs in-window instead of modals).
  const currentQuery = createMemo<QueryTab | undefined>(() => {
    const t = current();
    return t && t.kind === "query" ? t : undefined;
  });
  const currentTool = createMemo<ToolTab | undefined>(() => {
    const t = current();
    return t && t.kind === "tool" ? t : undefined;
  });
  // The connection a tool panel acts on: the tool tab's bound one, else focused.
  const toolConn = () => tabConn(currentTool());
  // Open (or focus) a tool tab, and close one by id. Bind the tab to the focused
  // connection at creation so the panel stays on that connection even if another
  // is focused later; an explicit opts.connDefId (e.g. EXPLAIN from a bound query
  // tab) overrides it.
  const showTool = (
    tool: Parameters<typeof openTool>[1],
    title: string,
    opts?: Parameters<typeof openTool>[3],
  ) =>
    setTabs((s) =>
      openTool(s, tool, title, { connDefId: focusedDefId() ?? undefined, ...opts }),
    );
  // The sidebar tools live behind a single 🧰 button in the object-tree header
  // now (the always-open list was removed in the Explorer-first layout): open a
  // context menu of the tool catalog, each launching its tool tab.
  const openToolsMenu = (e: MouseEvent) => {
    const items: MenuItem[] = TOOL_CATALOG.map((t) => ({
      label: `${t.icon}  ${t.label}`,
      action: () => showTool(t.tool, t.tabTitle, { key: t.key }),
    }));
    openContextMenu(e, items);
  };
  const closeTool = (id: number) => setTabs((s) => closeTab(s, id));
  const closeToolByKind = (tool: ToolTab["tool"]) =>
    setTabs((s) => {
      const t = s.tabs.find((x): x is ToolTab => x.kind === "tool" && x.tool === tool);
      return t ? closeTab(s, t.id) : s;
    });
  // Track the last active query tab so tool tabs (snippets) can act on the query
  // editor even when a tool tab is the active one.
  const [lastQueryId, setLastQueryId] = createSignal<number | null>(null);
  createEffect(() => {
    const q = currentQuery();
    if (q) setLastQueryId(q.id);
  });
  const lastQuerySql = () => {
    const id = lastQueryId();
    const t = id !== null ? tabs().tabs.find((x) => x.id === id) : undefined;
    return t && t.kind === "query" ? t.sql : "";
  };
  // A memo so reads in JSX/StatusBar track the per-tab store entry reactively.
  const currentResult = createMemo<TabResult>(() => {
    const t = current();
    return (t && results[t.id]) || emptyResult();
  });
  const currentEdit = createMemo<EditSessionState>(() => {
    const t = current();
    return (t && edits[t.id]) || emptyEdit();
  });
  // A tab is editable when it was opened from a table whose primary key is known
  // and projected — otherwise a row cannot be identified unambiguously.
  const currentEditable = createMemo<boolean>(() => {
    const src = currentResult().source;
    return !!src && src.pk.length > 0;
  });

  // Resolve the row-detail target reactively: null unless an in-range row of the
  // current result is selected. Closes itself (returns null) when a reload shrinks
  // the result past the selected index, so navigating after an apply is safe.
  const detailData = createMemo(() => {
    const idx = detailIndex();
    const res = currentResult().result;
    if (idx === null || !res || idx < 0 || idx >= res.rows.length) return null;
    return { idx, res };
  });

  const newTab = () => setTabs((s) => addTab(s, "Consulta", focusedDefId() ?? undefined));
  const selectTab = (id: number) => setTabs((s) => ({ ...s, activeId: id }));
  const removeTab = (id: number, e: MouseEvent) => {
    e.stopPropagation();
    setTabs((s) => closeTab(s, id));
  };

  const onEditorChange = (id: number, sql: string) =>
    setTabs((s) => updateTabSql(s, id, sql));

  // --- Query history actions (issue #128) --------------------------------
  // Re-run a stored query in a fresh tab so the current one is preserved.
  const runFromHistory = (sql: string) => {
    let newId = 0;
    setTabs((s) => {
      const added = addTab(s, "Consulta", focusedDefId() ?? undefined);
      newId = added.activeId;
      return updateTabSql(added, newId, sql);
    });
    void run(sql);
  };

  // Open SQL in a fresh tab WITHOUT running it (e.g. a routine's CREATE DDL,
  // which would error if executed against an object that already exists).
  const openSqlInNewTab = (sql: string) => {
    let newId = 0;
    setTabs((s) => {
      const added = addTab(s, "Consulta", focusedDefId() ?? undefined);
      newId = added.activeId;
      return updateTabSql(added, newId, sql);
    });
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const changeHistoryLimit = (n: number) => {
    const cap = clampLimit(n); // keep signal, in-memory purge and storage in sync
    setHistoryLimit(cap);
    saveHistoryLimit(cap);
    // Apply the new cap immediately by purging the current log.
    setHistory((list) => {
      const next = list.slice(0, cap);
      saveHistory(next);
      return next;
    });
  };

  // --- Favorites / snippets actions (issue #129) -------------------------
  const persistSnippets = (list: Snippet[]) => {
    setSnippets(list);
    saveSnippets(list);
  };
  const saveSnippet = (name: string, body: string) =>
    persistSnippets(addSnippet(snippets(), name, body));
  const renameSnip = (id: string, name: string) =>
    persistSnippets(renameSnippet(snippets(), id, name));
  const removeSnip = (id: string) => persistSnippets(removeSnippet(snippets(), id));
  // Drop a snippet into the editor at the cursor via a bumped insert request.
  // Snippets live in their own tab now, so first jump back to the last query
  // editor (or open one), then bump the insert tick once it has (re)mounted.
  const insertSnippet = (body: string) => {
    const id = lastQueryId();
    if (id !== null) setTabs((s) => ({ ...s, activeId: id }));
    else setTabs((s) => addTab(s, "Consulta", focusedDefId() ?? undefined));
    setTimeout(() => setSnippetInsert((r) => ({ text: body, tick: r.tick + 1 })), 0);
  };
  const exportSnippets = () =>
    void saveText("quaero-snippets.json", serializeSnippets(snippets()), "application/json");
  const importSnippets = (file: File) => {
    void file.text().then((text) => persistSnippets(mergeSnippets(snippets(), parseSnippets(text))));
  };

  // --- Connection management (issue #16) ---------------------------------
  const persist = (list: Connection[]) => {
    setConnections(list);
    saveConnections(list);
  };

  // Export/import saved connections (issue #188). Export defaults to no passwords;
  // import merges into the saved list and reports what changed.
  const exportConns = (includePasswords: boolean) =>
    void saveText(
      "quaero-connections.json",
      exportConnections(connections(), includePasswords),
      "application/json",
    );
  const importConns = async (file: File): Promise<string> => {
    const text = await file.text();
    const res = importConnections(connections(), text);
    if ("error" in res) return `No se pudo importar: ${res.error}`;
    persist(res.list);
    return summaryText(res.summary);
  };

  // The connection form opens as a tool tab carrying the draft in its params.
  const openConnForm = (draft: Connection) =>
    showTool(
      "connectionForm",
      draft.name ? `Editar · ${draft.name}` : "Nueva conexión",
      { key: "connform", params: { draft } },
    );

  const onNewConnection = () =>
    openConnForm({
      id: nextConnectionId(connections()),
      name: "",
      driver: AVAILABLE_DRIVERS[0],
      params: {},
    });

  const onEditConnection = (c: Connection) =>
    openConnForm({ ...c, params: { ...c.params } });

  const onDeleteConnection = (id: string) => {
    persist(removeConnection(connections(), id));
    // Close it if it happens to be open (focused or not).
    if (openConns().some((o) => o.defId === id)) {
      void disconnect(id);
    }
  };

  const onSaveConnection = (c: Connection) => {
    persist(upsertConnection(connections(), c));
    closeToolByKind("connectionForm");
  };

  // Close one open connection (the focused one when no id is given). Other open
  // connections stay up; focus falls to another, or none.
  const disconnect = async (defId?: string) => {
    const target = defId ?? focusedDefId();
    if (target == null) return;
    const o = openConns().find((x) => x.defId === target);
    if (!o) return;
    try {
      await closeConnection(o.connId);
    } catch {
      /* best-effort close */
    }
    const rest = openConns().filter((x) => x.defId !== target);
    setOpenConns(rest);
    if (focusedDefId() === target) {
      setFocusedDefId(rest[0]?.defId ?? null);
    }
    if (rest.length === 0) {
      setDatabases([]);
      setActiveDb(null);
    }
  };

  // --- End-to-end connect path (issue #17) -------------------------------
  // Opening a connection ADDS it to the open set (others stay up) and focuses it;
  // if it is already open, this just focuses it. `force` (Reconectar) drops the
  // existing session and opens a fresh one to recover a dropped/killed server.
  const onConnect = async (c: Connection, force = false) => {
    if (connectingId() !== null) return;
    const existing = openConns().find((o) => o.defId === c.id);
    if (existing && !force) {
      setFocusedDefId(c.id); // already open — just bring it into focus
      return;
    }
    setConnectingId(c.id);
    try {
      if (existing) {
        // Reconnect: drop the stale session before opening a fresh one.
        try {
          await closeConnection(existing.connId);
        } catch {
          /* best-effort */
        }
        setOpenConns((list) => list.filter((o) => o.defId !== c.id));
      }
      const connId = await openConnection(c.driver, buildDsn(c));
      setOpenConns((list) => [
        ...list,
        { defId: c.id, connId, name: c.name, driver: c.driver, color: c.color },
      ]);
      setFocusedDefId(c.id);
    } catch (err) {
      const tab = current();
      const f = describeError(err);
      if (tab) {
        setResults(tab.id, {
          ...emptyResult(),
          error: `No se pudo conectar a "${c.name}": ${f.detail ?? f.title}`,
        });
      }
    } finally {
      setConnectingId(null);
    }
  };

  // Reconnect the active connection (fresh session) — recovers after the server
  // dropped or the process was killed.
  const reconnect = () => {
    const id = activeDefId();
    const c = id ? connections().find((x) => x.id === id) : undefined;
    if (c) void onConnect(c, true);
  };

  // Load the connection's databases and pick a default working one (the DSN's
  // database if set, else the first). Runs whenever the active connection
  // changes; failures leave the list empty (the selector just hides).
  createEffect(() => {
    const conn = active();
    if (!conn) {
      setDatabases([]);
      setActiveDb(null);
      return;
    }
    const connId = conn.connId;
    void (async () => {
      try {
        const dbs = parseTreeRows(await schemaTree(connId), "database")
          .filter((n) => n.kind === "database" || n.kind === "schema")
          .map((n) => n.name);
        if (active()?.connId !== connId) return; // connection changed meanwhile
        setDatabases(dbs);
        const configured = connections().find((c) => c.id === activeDefId())?.params.database;
        setActiveDb(configured && dbs.includes(configured) ? configured : (dbs[0] ?? null));
      } catch {
        setDatabases([]);
      }
    })();
  });

  // Select the working database: scope the tools + (where supported) set the
  // editor's default database on the live session via USE.
  const selectDb = (db: string) => {
    setActiveDb(db);
    const conn = active();
    const sql = useDatabaseSql(activeDialect(), db);
    if (conn && sql) void runQuery(conn.connId, sql).catch(() => {});
  };

  // Keep the working-database selector in sync when the user navigates the tree
  // into another database (clicking a db node or opening one of its tables).
  // Guarded: only switch to a name that is actually a selectable database, and
  // only when it differs from the current one, to avoid redundant USE queries.
  const syncWorkingDb = (name?: string | null) => {
    if (name && name !== activeDb() && databases().includes(name)) {
      selectDb(name);
    }
  };

  // Record an executed query in the client-side history (issue #128), collapsing
  // immediate repeats and purging past the configured limit, then persist.
  const recordHistory = (sql: string, conn: ActiveConnection, durationMs?: number) => {
    const entry: HistoryEntry = {
      sql,
      ts: Date.now(),
      connId: activeDefId() ?? "",
      connName: conn.name,
      durationMs,
    };
    setHistory((list) => {
      const next = addHistory(list, entry, historyLimit());
      saveHistory(next);
      return next;
    });
  };

  const run = async (sql: string, scope: RunScope = "document", offset = 0) => {
    const tab = current();
    if (!tab) return;
    const id = tab.id;
    const trimmed = sql.trim();
    if (!trimmed) {
      setResults(id, { ...emptyResult(), error: "La consulta está vacía." });
      return;
    }
    // Run against the tab's OWN connection (bound at creation), so a prod tab and
    // a dev tab keep hitting their own servers regardless of which is focused. A
    // tab with no binding follows whatever is focused.
    const conn = tabConn(tab);
    if (!conn) {
      setResults(id, {
        ...emptyResult(),
        error:
          tab.kind === "query" && tab.connDefId
            ? "La conexión de esta pestaña está cerrada. Vuelve a conectarla desde el panel de conexiones."
            : "No hay conexión activa. Abre una conexión para ejecutar consultas.",
      });
      return;
    }
    // Paging the same query keeps the edit source so the grid stays editable
    // across pages; a fresh query (different SQL) drops it.
    const prev = results[id];
    const keepSource =
      prev?.source && prev.pageSql === trimmed ? prev.source : undefined;
    setResults(id, { ...emptyResult(), loading: true, ranScope: scope });
    const started = performance.now();
    try {
      const result = await runQuery(conn.connId, trimmed, PAGE_LIMIT, offset);
      const elapsedMs = performance.now() - started;
      setResults(id, {
        loading: false,
        error: null,
        result,
        elapsedMs,
        ranScope: scope,
        pageSql: trimmed,
        offset,
        pageSize: PAGE_LIMIT,
        source: keepSource,
      });
      // Record after the run so the entry carries its duration (issue #179);
      // page turns (offset > 0) are not logged.
      if (offset === 0) recordHistory(trimmed, conn, elapsedMs);
    } catch (err) {
      const elapsedMs = performance.now() - started;
      setResults(id, {
        loading: false,
        error: errorText(err),
        result: null,
        elapsedMs,
        ranScope: scope,
      });
      if (offset === 0) recordHistory(trimmed, conn, elapsedMs);
    }
  };

  // Offset pagination (issue #134): re-run the current result's SQL at the
  // previous / next page. Guarded while editing so a page turn never discards
  // pending changes.
  const pageBy = (delta: 1 | -1) => {
    const t = current();
    if (!t) return;
    const r = results[t.id];
    if (!r || !r.pageSql || r.loading || currentEdit().editing) return;
    const size = r.pageSize ?? PAGE_LIMIT;
    const nextOffset = Math.max(0, (r.offset ?? 0) + delta * size);
    if (nextOffset === (r.offset ?? 0)) return;
    void run(r.pageSql, r.ranScope ?? "document", nextOffset);
  };

  // Show the execution plan of the active query (issue #131): build the EXPLAIN
  // for the engine and run it as a normal (read-only) result in the grid. The
  // editor text is left untouched. Honest errors for empty SQL, no connection,
  // or an engine without an inline EXPLAIN.
  // Open the visual execution plan (issue #187) for a statement as a tool tab.
  // The ExplainPlan component runs the structured EXPLAIN and renders the tree;
  // it handles unsupported engines / no connection honestly on its own.
  const showExplainPlan = (rawSql: string, connDefId?: string) => {
    const sql = rawSql.trim();
    if (!sql) return;
    // Bind the plan to the originating tab's connection so it explains against
    // the right server; without one it falls back to the focused connection.
    showTool("explainPlan", "Plan de ejecución", {
      key: `plan:${sql}`,
      params: { sql },
      ...(connDefId ? { connDefId } : {}),
    });
  };

  // The editor's "Plan" button: visual plan for the active tab's SQL, against
  // that tab's own connection.
  const explainActive = () => {
    const tab = current();
    if (!tab) return;
    const sql = (tabs().tabs.find((t) => t.id === tab.id)?.sql ?? "").trim();
    if (!sql) {
      setResults(tab.id, { ...emptyResult(), error: "La consulta está vacía." });
      return;
    }
    showExplainPlan(sql, tab.kind === "query" ? tab.connDefId : undefined);
  };

  // EXPLAIN an arbitrary statement (e.g. a slow query, issue #180) as a visual plan.
  const explainSql = (sql: string) => showExplainPlan(sql);

  // --- Object tree actions (issues #19, #20) -----------------------------
  // Open a table's data: a fresh tab with a SELECT, executed immediately. The
  // table is qualified with its db/schema context so the query is correct on
  // engines (or attached databases) where the bare name would be ambiguous.
  const openData = (node: TreeNode) => {
    recordRecent(node);
    syncWorkingDb(node.db);
    // The capped preview query in the engine's own surface: a qualified SELECT
    // for relational engines (Informix uses db:owner.table + FIRST), or
    // db.<collection>.find().limit() for MongoDB (see objectPreviewQuery).
    const sql = objectPreviewQuery(
      { db: node.db, schema: node.schema, name: node.label },
      activeDialect(),
      PAGE_LIMIT,
    );
    let newId = 0;
    setTabs((s) => {
      const added = addTab(s, "Consulta", focusedDefId() ?? undefined);
      newId = added.activeId;
      return updateTabSql(added, newId, sql);
    });
    void (async () => {
      await run(sql);
      const conn = active();
      if (!conn) return;
      // Fetch the table's primary key so the grid knows if it can be edited.
      try {
        const desc = await schemaDescribe(conn.connId, node.label, node.db, node.schema);
        // Feed this table's columns into the autocomplete cache (lazy schema).
        setColumnCache((c) => ({ ...c, [node.label]: describeColumnNames(desc) }));
        const source: EditSource = {
          table: node.label,
          db: node.db,
          schema: node.schema,
          pk: describePkColumns(desc),
        };
        if (results[newId]) {
          setResults(newId, "source", source);
        }
      } catch {
        /* describe failed: the tab stays read-only (no source). */
      }
    })();
  };

  // --- Data editing (issues #26/#27/#28/#29) -----------------------------
  const errMsg = (e: unknown) => errorText(e);

  const patchEdit = (id: number, patch: Partial<EditSessionState>) =>
    setEdits(id, (e) => ({ ...(e ?? emptyEdit()), ...patch }));

  const mutatePending = (id: number, fn: (p: PendingChanges) => PendingChanges) =>
    setEdits(id, (e) => {
      const s = e ?? emptyEdit();
      return { ...s, pending: fn(s.pending) };
    });

  // Grid change hooks (record into the pending set of the active tab).
  const onEditCell = (rowIndex: number, column: string, value: string) => {
    const t = current();
    if (t) mutatePending(t.id, (p) => setCell(p, rowIndex, column, value));
  };
  const onToggleDelete = (rowIndex: number) => {
    const t = current();
    if (t) mutatePending(t.id, (p) => toggleDelete(p, rowIndex));
  };
  const onInsertCell = (insertIndex: number, column: string, value: string) => {
    const t = current();
    if (t) mutatePending(t.id, (p) => setInsertCell(p, insertIndex, column, value));
  };
  const onRemoveInsert = (insertIndex: number) => {
    const t = current();
    if (t) mutatePending(t.id, (p) => removeInsert(p, insertIndex));
  };
  const onAddInsert = () => {
    const t = current();
    if (t) mutatePending(t.id, (p) => addInsert(p));
  };

  const beginEdit = async () => {
    const t = current();
    const conn = tabConn(t);
    if (!t || !conn || !currentEditable()) return;
    patchEdit(t.id, { busy: true, error: null });
    try {
      await txBegin(conn.connId);
      patchEdit(t.id, { editing: true, pending: emptyPending(), busy: false });
    } catch (err) {
      patchEdit(t.id, { busy: false, error: errMsg(err) });
    }
  };

  const reloadCurrent = (id: number) => {
    const sql = tabs().tabs.find((x) => x.id === id)?.sql;
    if (sql) void run(sql);
  };

  const discardEdit = async () => {
    const t = current();
    const conn = tabConn(t);
    if (!t || !conn) return;
    patchEdit(t.id, { busy: true });
    try {
      await txRollback(conn.connId);
    } catch {
      /* best-effort rollback */
    }
    setEdits(t.id, emptyEdit());
    reloadCurrent(t.id);
  };

  // Confirmar: gather the generated SQL for every pending change (preview only)
  // and show it for confirmation before anything is executed (issue #29).
  const confirmEdit = async () => {
    const t = current();
    const conn = tabConn(t);
    const res = currentResult();
    if (!t || !conn || !res.result || !res.source) return;
    const plan = buildPlan(res.source, res.result.columns, res.result.rows,
                           currentEdit().pending);
    if (plan.length === 0) {
      patchEdit(t.id, { error: "No hay cambios para aplicar." });
      return;
    }
    const target = { table: res.source.table, db: res.source.db, schema: res.source.schema };
    patchEdit(t.id, { busy: true, error: null });
    try {
      const sqls: string[] = [];
      for (const item of plan) {
        const r = await runPlanItem(conn.connId, target, item, true);
        sqls.push(r.sql);
      }
      patchEdit(t.id, { busy: false, preview: sqls });
    } catch (err) {
      patchEdit(t.id, { busy: false, error: errMsg(err) });
    }
  };

  // Aplicar: execute the plan for real, then commit and reload.
  const applyEdit = async () => {
    const t = current();
    const conn = tabConn(t);
    const res = currentResult();
    if (!t || !conn || !res.result || !res.source) return;
    const plan = buildPlan(res.source, res.result.columns, res.result.rows,
                           currentEdit().pending);
    const target = { table: res.source.table, db: res.source.db, schema: res.source.schema };
    patchEdit(t.id, { busy: true, error: null });
    try {
      for (const item of plan) {
        await runPlanItem(conn.connId, target, item, false);
      }
      await txCommit(conn.connId);
      setEdits(t.id, emptyEdit());
      reloadCurrent(t.id);
    } catch (err) {
      // Leave the transaction open so the user can fix and retry or discard.
      patchEdit(t.id, { busy: false, preview: null, error: `Error al aplicar: ${errMsg(err)}` });
    }
  };

  const cancelPreview = () => {
    const t = current();
    if (t) patchEdit(t.id, { preview: null });
  };

  const openImport = () => {
    const src = currentResult().source;
    const t = currentQuery();
    if (src && active()) {
      showTool("import", `Importar · ${src.table}`, {
        key: `import:${src.table}`,
        params: { target: { table: src.table, db: src.db, schema: src.schema } },
        sourceId: t?.id,
      });
    }
  };

  // Open the test-data generator for the current table tab (issue #147).
  const openGen = () => {
    const src = currentResult().source;
    const t = currentQuery();
    if (src && active()) {
      showTool("generator", `Generar · ${src.table}`, {
        key: `gen:${src.table}`,
        params: { target: { table: src.table, db: src.db, schema: src.schema } },
        sourceId: t?.id,
      });
    }
  };

  // Wizards launched from the result toolbar act on the current result; snapshot
  // what they need into the tool tab's params at open time.
  const openSchemaSync = () =>
    showTool("schemaSync", "Sincronizar esquema", {
      key: "schemaSync",
      params: { sourceDb: currentResult().source?.db },
    });
  const openDataSync = () => {
    const res = currentResult();
    if (!res.result || !res.source) return;
    showTool("dataDiff", "Sincronizar datos", {
      key: "dataDiff",
      params: {
        sourceResult: res.result,
        source: { table: res.source.table, db: res.source.db, schema: res.source.schema },
        pk: res.source.pk,
      },
    });
  };
  const openTransfer = () => {
    const res = currentResult();
    if (!res.result || !res.source) return;
    showTool("transfer", "Transferir", {
      key: "transfer",
      params: { sourceResult: res.result, sourceTable: res.source.table },
    });
  };
  // Chart the current result (issue #149): snapshot it into the tool tab.
  const openChart = () => {
    const res = currentResult().result;
    if (!res || res.columns.length === 0) return;
    showTool("chart", "Gráfico", { key: "chart", params: { result: res } });
  };

  // --- Export (issue #30) ------------------------------------------------
  // Save the result as text. saveText prefers a native "Guardar como" dialog
  // (File System Access API in the webview) and falls back to a browser
  // download where unavailable. Client-side by design; see the M8 decision.
  const doExport = (format: AnyExportFormat) => {
    const res = currentResult().result;
    if (!res || res.columns.length === 0) return;
    const src = currentResult().source;
    const base = src?.table ?? current()?.title ?? "export";
    const table = src?.table ?? "exported";
    if (format === "xlsx") {
      void saveBytes(fileNameFor(base, "xlsx"), buildXlsx(res, table), XLSX_MIME);
      return;
    }
    const text = exportResult(res, format, table);
    void saveText(fileNameFor(base, format), text, mimeFor(format));
  };

  // Right-click on a result cell: copy the cell / row / row-as-JSON, and export
  // the loaded result. Built here because the workspace owns the result + the
  // exporters; the grid just forwards the click position and indices.
  const onCellContext = (e: MouseEvent, rowIndex: number, colIndex: number) => {
    const res = currentResult().result;
    if (!res) return;
    const row = res.rows[rowIndex];
    const items: MenuItem[] = [];
    if (row) {
      items.push({ label: "Ver detalle de fila", action: () => setDetailIndex(rowIndex) });
      items.push({ separator: true });
      const cell = row[colIndex];
      items.push({ label: "Copiar celda", action: () => copyText(cell ?? "") });
      items.push({ label: "Copiar fila", action: () => copyText(rowToTsv(row)) });
      items.push({
        label: "Copiar fila como JSON",
        action: () => copyText(rowToJson(res.columns, row)),
      });
      items.push({ separator: true });
    }
    for (const f of EXPORT_FORMATS) {
      items.push({ label: `Exportar ${f.label}`, action: () => doExport(f.fmt) });
    }
    openContextMenu(e, items);
  };

  // Right-click on a tab.
  const tabMenu = (e: MouseEvent, id: number) => {
    openContextMenu(e, [
      { label: "Cerrar", action: () => setTabs((s) => closeTab(s, id)) },
      {
        label: "Cerrar las demás",
        action: () => setTabs((s) => closeOtherTabs(s, id)),
        disabled: tabs().tabs.length < 2,
      },
      { separator: true },
      { label: "Nueva consulta", action: newTab },
    ]);
  };

  // Open a table's structure (columns + DDL) as a tool tab.
  const openStructure = (node: TreeNode) => {
    if (active()) {
      recordRecent(node);
      syncWorkingDb(node.db);
      showTool("structure", `Estructura · ${node.label}`, {
        key: `struct:${node.db ?? ""}.${node.schema ?? ""}.${node.label}`,
        params: { node },
      });
    }
  };

  // Open the table designer for a db/schema container as a tool tab (create).
  const openTableDesigner = (container?: string) =>
    showTool("tableDesigner", "Nueva tabla", { key: "tableDesigner", params: { container } });

  // Open the index / constraint manager for a table (alter-scoped tool tab).
  const openIndexes = (node: TreeNode) =>
    showTool("indexes", `Índices · ${node.label}`, {
      key: `indexes:${node.db ?? ""}.${node.schema ?? ""}.${node.label}`,
      params: { table: node.label, db: node.db, schema: node.schema },
    });

  // Open the table designer on an existing table (alter mode).
  const openAlterTable = (node: TreeNode) =>
    showTool("tableDesigner", `Modificar · ${node.label}`, {
      key: `alter:${node.db ?? ""}.${node.schema ?? ""}.${node.label}`,
      params: {
        table: node.label,
        db: node.db,
        schema: node.schema,
        container: node.schema ?? node.db,
      },
    });

  // Sidebar drag-to-resize: track the pointer on the document until release.
  const startResize = (e: MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) =>
      setSidebarWidth(clampSidebarWidth(ev.clientX));
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
    };
    document.body.style.cursor = "col-resize";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // --- Command palette command list (issue #174) -------------------------
  // Built from the same handlers each origin uses, so a palette hit behaves
  // exactly like clicking the tool/object/snippet/history/action directly.
  const paletteCommands = createMemo<Command[]>(() => {
    const out: Command[] = [];
    const connected = !!active();

    // Actions (always available).
    out.push({ id: "act:new", category: "action", label: "Nueva consulta", run: () => setTabs((s) => addTab(s, "Consulta", focusedDefId() ?? undefined)) });
    if (connected)
      out.push({ id: "act:reconnect", category: "action", label: "Reconectar", run: reconnect });
    out.push({ id: "act:settings", category: "action", label: "Ajustes", run: () => showTool("settings", "Ajustes", { key: "settings" }) });
    out.push({ id: "act:help", category: "action", label: "Atajos de teclado", run: () => showTool("help", "Atajos de teclado", { key: "help" }) });

    // Tools (need a connection to be useful).
    if (connected)
      for (const t of TOOL_CATALOG)
        out.push({ id: `tool:${t.tool}`, category: "tool", label: t.label, run: () => showTool(t.tool, t.tabTitle, { key: t.key }) });

    // Objects loaded in the tree.
    for (const node of loadedObjects()) {
      const scope = [node.db, node.schema].filter((p): p is string => !!p).join(".");
      out.push({
        id: `obj:${node.key}`,
        category: "object",
        label: node.label,
        hint: scope || (node.kind === "view" ? "vista" : "tabla"),
        run: () => openData(node),
      });
    }

    // Snippets.
    for (const s of snippets())
      out.push({ id: `snip:${s.id}`, category: "snippet", label: s.name, run: () => insertSnippet(s.body) });

    // Recent history (cap so the palette stays snappy; fuzzy filters the rest).
    for (const [i, h] of history().slice(0, 30).entries())
      out.push({ id: `hist:${i}`, category: "history", label: h.sql, hint: h.connName || undefined, run: () => runFromHistory(h.sql) });

    return out;
  });

  // What the palette shows depends on how it was opened: Mod+P scopes it to the
  // connection's objects (a go-to-table/view jump), Mod+K shows everything.
  const visiblePaletteCommands = createMemo<Command[]>(() =>
    paletteMode() === "objects"
      ? paletteCommands().filter((c) => c.category === "object")
      : paletteCommands(),
  );

  return (
    <div class="app">
      <AppToolbar
        active={!!active()}
        hasDb={!!activeDb()}
        onNewQuery={newTab}
        onNewTable={() => openTableDesigner()}
        onObjectList={() => {
          const db = activeDb();
          if (db) showTool("objectList", `Objetos · ${db}`, { key: `objlist:${db}`, params: { db } });
        }}
        onOpenTool={(t) => showTool(t.tool, t.tabTitle, { key: t.key })}
      />
      <div class="main">
        <aside class="sidebar" style={{ width: `${sidebarWidth()}px` }}>
          <div class="sidebar-section-title">Conexiones</div>
          <ConnectionBar
            connections={connections()}
            activeConnId={activeDefId()}
            openIds={openConns().map((o) => o.defId)}
            connectingId={connectingId()}
            onConnect={onConnect}
            onEdit={onEditConnection}
            onDelete={onDeleteConnection}
            onNew={onNewConnection}
            onDisconnect={(defId) => void disconnect(defId)}
            onReconnect={reconnect}
            onExport={exportConns}
            onImport={importConns}
          />
          <Show when={active()}>
            <Show when={databases().length > 0}>
              <div class="sidebar-db">
                <label>
                  <span>Base de datos activa</span>
                  <select
                    class="map-select"
                    value={activeDb() ?? ""}
                    onChange={(e) => selectDb(e.currentTarget.value)}
                  >
                    <For each={databases()}>{(d) => <option value={d}>{d}</option>}</For>
                  </select>
                </label>
              </div>
            </Show>
            <div class="sidebar-tree">
              <ObjectTree
                connId={active()!.connId}
                engine={activeDialect()}
                onOpenData={openData}
                onOpenStructure={openStructure}
                onOpenSql={openSqlInNewTab}
                reloadKey={treeReload()}
                onRefresh={refreshAll}
                onOpenTools={openToolsMenu}
                onObjectsLoaded={setLoadedObjects}
                onSelectDatabase={syncWorkingDb}
                activeDb={activeDb() ?? undefined}
                onImport={(node) =>
                  showTool("import", `Importar · ${node.label}`, {
                    key: `import:${node.label}`,
                    params: {
                      target: { table: node.label, db: node.db, schema: node.schema },
                    },
                  })
                }
                onCreateTable={(node) =>
                  openTableDesigner(node.schema ?? node.db)
                }
                onAlterTable={openAlterTable}
                onManageIndexes={openIndexes}
              />
            </div>
          </Show>
        </aside>

        <div class="resizer" onMouseDown={startResize} />

        <section class="workspace">
          <Show when={tabConn(current())?.color}>
            <div
              class="workspace-accent"
              style={{ background: tabConn(current())!.color }}
              title="Conexión de la pestaña activa"
            />
          </Show>
          <div class="tabbar">
            <For each={tabs().tabs}>
              {(tab) => (
                <div
                  class={`tab ${tab.id === tabs().activeId ? "active" : ""} ${
                    tab.kind === "tool" ? "tab-tool" : ""
                  }`}
                  style={tabColor(tab) ? { "border-top": `2px solid ${tabColor(tab)}` } : undefined}
                  onClick={() => selectTab(tab.id)}
                  onContextMenu={(e) => tabMenu(e, tab.id)}
                >
                  <Show when={tabColor(tab)}>
                    <span class="conn-color tab-conn-color" style={{ background: tabColor(tab) }} />
                  </Show>
                  <span class="tab-title">{tab.title}</span>
                  <button
                    class="tab-close"
                    title="Cerrar pestaña"
                    aria-label="Cerrar pestaña"
                    onClick={(e) => removeTab(tab.id, e)}
                  >
                    ×
                  </button>
                </div>
              )}
            </For>
            <button
              class="tab-new"
              title="Nueva consulta"
              aria-label="Nueva consulta"
              onClick={newTab}
            >
              +
            </button>
          </div>

          <div class="workspace-main">
          <Show when={currentQuery()}>
            {(tab) => (
              <div class="panes">
                <div class="editor-pane">
                  <SqlEditor
                    activeId={tab().id}
                    sqlFor={(id) =>
                      tabs().tabs.find((t) => t.id === id)?.sql ?? ""
                    }
                    onChange={onEditorChange}
                    onRun={run}
                    onExplain={explainActive}
                    dialect={activeDialect()}
                    formatTick={formatTick()}
                    searchTick={findTick()}
                    insertRequest={snippetInsert()}
                    schema={sqlSchema()}
                  />
                  <div class="editor-hint">
                    <button
                      class="status-btn"
                      title="Formatear SQL (Ctrl/Cmd+Shift+F)"
                      onClick={() => setFormatTick((t) => t + 1)}
                    >
                      Formatear
                    </button>
                    <button
                      class="status-btn"
                      title="Ver plan de ejecución — EXPLAIN (Ctrl/Cmd+Shift+E)"
                      onClick={explainActive}
                    >
                      Plan
                    </button>
                    <button
                      class="status-btn"
                      title="Historial de consultas"
                      onClick={() => showTool("history", "Historial", { key: "history" })}
                    >
                      Historial
                    </button>
                    <button
                      class="status-btn"
                      title="Favoritos y snippets"
                      onClick={() => showTool("snippets", "Snippets", { key: "snippets" })}
                    >
                      Snippets
                    </button>
                    <span class="editor-hint-spacer" />
                    <span>Ctrl/Cmd + Enter para ejecutar</span>
                  </div>
                </div>
                <div class="result-pane">
                  <Show
                    when={
                      currentResult().source ||
                      (currentResult().result?.columns.length ?? 0) > 0
                    }
                  >
                    <ObjectToolbar
                      isTable={!!currentResult().source}
                      hasColumns={
                        (currentResult().result?.columns.length ?? 0) > 0
                      }
                      editing={currentEdit().editing}
                      editable={currentEditable()}
                      busy={currentEdit().busy}
                      error={currentEdit().error}
                      changeCount={changeCount(currentEdit().pending)}
                      hasChanges={hasChanges(currentEdit().pending)}
                      exportFormats={EXPORT_FORMATS}
                      onEdit={beginEdit}
                      onImport={openImport}
                      onGenerate={openGen}
                      onSchemaSync={openSchemaSync}
                      onDataSync={openDataSync}
                      onTransfer={openTransfer}
                      onAddRow={onAddInsert}
                      onConfirm={confirmEdit}
                      onDiscard={discardEdit}
                      onChart={openChart}
                      onExport={(fmt) => doExport(fmt as AnyExportFormat)}
                    />
                  </Show>
                  <Show when={currentEdit().preview}>
                    {(sqls) => (
                      <div class="edit-preview">
                        <div class="edit-preview-head">
                          <strong>Confirmar cambios</strong>
                          <span>
                            Se ejecutarán {sqls().length} sentencia(s) en la transacción abierta.
                          </span>
                        </div>
                        <pre class="ddl-text preview-sql">{sqls().join(";\n")}</pre>
                        <div class="modal-actions">
                          <button disabled={currentEdit().busy} onClick={cancelPreview}>
                            Cancelar
                          </button>
                          <button
                            class="primary"
                            disabled={currentEdit().busy}
                            onClick={applyEdit}
                          >
                            Aplicar y confirmar
                          </button>
                        </div>
                      </div>
                    )}
                  </Show>
                  <div class="result-body">
                    <div class="result-grid-wrap">
                      <ResultGrid
                        result={currentResult().result}
                        loading={currentResult().loading}
                        error={currentResult().error}
                        rowHeight={rowHeightFor(settings().gridDensity)}
                        emptyState={
                          <EmptyState
                            recentTables={recentTables()}
                            history={history()}
                            snippets={snippets()}
                            isMac={isMac()}
                            onOpenTable={openData}
                            onRunHistory={runFromHistory}
                            onInsertSnippet={insertSnippet}
                          />
                        }
                        onCellContext={onCellContext}
                        edit={
                          currentEditable()
                            ? {
                                active: currentEdit().editing,
                                pending: currentEdit().pending,
                                onEditCell,
                                onToggleDelete,
                                onInsertCell,
                                onRemoveInsert,
                              }
                            : undefined
                        }
                      />
                    </div>
                    <Show when={detailData()}>
                      {(d) => (
                        <RowDetail
                          columns={d().res.columns}
                          row={d().res.rows[d().idx]}
                          rowIndex={d().idx}
                          total={d().res.rows.length}
                          editing={currentEdit().editing}
                          editable={currentEditable()}
                          deleted={currentEdit().pending.deletes.includes(d().idx)}
                          edits={currentEdit().pending.edits[d().idx]}
                          onEditCell={(col, val) => onEditCell(d().idx, col, val)}
                          onToggleDelete={() => onToggleDelete(d().idx)}
                          onBeginEdit={beginEdit}
                          onPrev={() =>
                            setDetailIndex((i) => stepRowIndex(i ?? 0, -1, d().res.rows.length))
                          }
                          onNext={() =>
                            setDetailIndex((i) => stepRowIndex(i ?? 0, 1, d().res.rows.length))
                          }
                          onClose={() => setDetailIndex(null)}
                        />
                      )}
                    </Show>
                  </div>
                  <Show
                    when={
                      currentResult().pageSql &&
                      (currentResult().result?.columns.length ?? 0) > 0
                    }
                  >
                    <div class="page-bar">
                      <button
                        class="edit-btn"
                        disabled={(currentResult().offset ?? 0) === 0 || currentEdit().editing}
                        onClick={() => pageBy(-1)}
                      >
                        ‹ Anterior
                      </button>
                      <span class="page-info">
                        Filas {(currentResult().offset ?? 0) +
                          ((currentResult().result?.rows.length ?? 0) > 0 ? 1 : 0)}
                        –{(currentResult().offset ?? 0) + (currentResult().result?.rows.length ?? 0)}
                        <Show when={currentEdit().editing}>
                          {" "}· paginación en pausa durante la edición
                        </Show>
                      </span>
                      <button
                        class="edit-btn"
                        disabled={!currentResult().result?.truncated || currentEdit().editing}
                        onClick={() => pageBy(1)}
                      >
                        Siguiente ›
                      </button>
                    </div>
                  </Show>
                </div>
              </div>
            )}
          </Show>

          <Show when={currentTool()}>
            {(tt) => (
              <Switch>
                <Match when={tt().tool === "objectList"}>
                  <ObjectListView
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    db={(tt().params as { db: string }).db}
                    onOpenData={(name, type) =>
                      openData({
                        key: `db:${(tt().params as { db: string }).db}/obj:${name}`,
                        label: name,
                        kind: type === "view" ? "view" : "table",
                        db: (tt().params as { db: string }).db,
                      })
                    }
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "monitor"}>
                  <ServerMonitor
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "users"}>
                  <UserManager
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "generator"}>
                  <DataGenerator
                    connId={toolConn()?.connId ?? ""}
                    target={(tt().params as { target: EditTarget }).target}
                    onClose={() => closeTool(tt().id)}
                    onGenerated={() => {
                      const s = tt().sourceId;
                      if (s !== undefined) reloadCurrent(s);
                    }}
                  />
                </Match>
                <Match when={tt().tool === "import"}>
                  <ImportWizard
                    connId={toolConn()?.connId ?? ""}
                    target={(tt().params as { target: EditTarget }).target}
                    onClose={() => closeTool(tt().id)}
                    onImported={() => {
                      const s = tt().sourceId;
                      if (s !== undefined) reloadCurrent(s);
                    }}
                  />
                </Match>
                <Match when={tt().tool === "tableDesigner"}>
                  <TableDesigner
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    table={(tt().params as { table?: string }).table}
                    container={(tt().params as { container?: string }).container}
                    db={(tt().params as { db?: string }).db}
                    schema={(tt().params as { schema?: string }).schema}
                    onClose={() => closeTool(tt().id)}
                    onApplied={() => setTreeReload((n) => n + 1)}
                  />
                </Match>
                <Match when={tt().tool === "indexes"}>
                  <IndexManager
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    table={(tt().params as { table: string }).table}
                    db={(tt().params as { db?: string }).db}
                    schema={(tt().params as { schema?: string }).schema}
                    onClose={() => closeTool(tt().id)}
                    onChanged={() => setTreeReload((n) => n + 1)}
                  />
                </Match>
                <Match when={tt().tool === "structure"}>
                  <StructureView
                    connId={toolConn()?.connId ?? ""}
                    table={(tt().params as { node: TreeNode }).node.label}
                    db={(tt().params as { node: TreeNode }).node.db}
                    schema={(tt().params as { node: TreeNode }).node.schema}
                    kind={(tt().params as { node: TreeNode }).node.kind}
                    engine={activeDialect()}
                    onClose={() => closeTool(tt().id)}
                    onApplied={() => setTreeReload((n) => n + 1)}
                  />
                </Match>
                <Match when={tt().tool === "schemaSync"}>
                  <SchemaSyncWizard
                    sourceConnId={toolConn()?.connId ?? ""}
                    sourceDb={(tt().params as { sourceDb?: string }).sourceDb}
                    connections={connections()}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "dataDiff"}>
                  <DataDiffWizard
                    sourceResult={(tt().params as { sourceResult: ResultSet }).sourceResult}
                    source={(tt().params as { source: EditTarget }).source}
                    pk={(tt().params as { pk: string[] }).pk}
                    connections={connections()}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "transfer"}>
                  <TransferWizard
                    sourceResult={(tt().params as { sourceResult: ResultSet }).sourceResult}
                    sourceTable={(tt().params as { sourceTable: string }).sourceTable}
                    connections={connections()}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "history"}>
                  <HistoryPanel
                    entries={history()}
                    slowThresholdMs={settings().slowThresholdMs}
                    onRun={runFromHistory}
                    onClear={clearHistory}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "snippets"}>
                  <SnippetsPanel
                    entries={snippets()}
                    currentSql={lastQuerySql()}
                    onSave={saveSnippet}
                    onInsert={insertSnippet}
                    onRename={renameSnip}
                    onRemove={removeSnip}
                    onExport={exportSnippets}
                    onImport={importSnippets}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "connectionForm"}>
                  <ConnectionForm
                    initial={(tt().params as { draft: Connection }).draft}
                    onSave={onSaveConnection}
                    onCancel={() => closeTool(tt().id)}
                    onTest={(c) => testConnection(c.driver, buildDsn(c))}
                  />
                </Match>
                <Match when={tt().tool === "chart"}>
                  <ChartView
                    result={(tt().params as { result: ResultSet }).result}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "erDiagram"}>
                  <ErDiagram
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    db={activeDb() ?? undefined}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "queryBuilder"}>
                  <QueryBuilder
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    db={activeDb() ?? undefined}
                    onRun={(sql) => {
                      closeTool(tt().id);
                      runFromHistory(sql);
                    }}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "routines"}>
                  <RoutineExplorer
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    db={activeDb() ?? undefined}
                    onOpenSql={(sql) => {
                      closeTool(tt().id);
                      openSqlInNewTab(sql);
                    }}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "triggers"}>
                  <TriggersExplorer
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    db={activeDb() ?? undefined}
                    onOpenSql={(sql) => {
                      closeTool(tt().id);
                      openSqlInNewTab(sql);
                    }}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "explainPlan"}>
                  <ExplainPlan
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    sql={(tt().params as { sql: string }).sql}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "slowQueries"}>
                  <SlowQueries
                    connId={toolConn()?.connId ?? ""}
                    engine={activeDialect()}
                    onOpenSql={(sql) => {
                      closeTool(tt().id);
                      openSqlInNewTab(sql);
                    }}
                    onExplain={(sql) => {
                      closeTool(tt().id);
                      explainSql(sql);
                    }}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "settings"}>
                  <SettingsPanel
                    theme={theme()}
                    onSetTheme={applyThemePref}
                    skin={skin()}
                    onSetSkin={applySkinPref}
                    historyLimit={historyLimit()}
                    onSetHistoryLimit={changeHistoryLimit}
                    settings={settings()}
                    onSetSettings={patchSettings}
                    onClose={() => closeTool(tt().id)}
                  />
                </Match>
                <Match when={tt().tool === "help"}>
                  <ShortcutsHelp isMac={isMac()} onClose={() => closeTool(tt().id)} />
                </Match>
              </Switch>
            )}
          </Show>

          <Show when={!current()}>
            <div class="workspace-welcome">
              <BrandWordmark height={56} />
              <p class="welcome-tagline">Ligero, local y libre.</p>
              <p class="welcome-hint">
                Abre una conexión desde la barra lateral o crea una pestaña de consulta para empezar.
              </p>
            </div>
          </Show>
          </div>
          <Show when={currentQuery()}>
            <InfoPane
              info={{
                loading: currentResult().loading,
                error: currentResult().error,
                columns: currentResult().result?.columns.length ?? 0,
                rows: currentResult().result?.rows.length ?? 0,
                truncated: currentResult().result?.truncated ?? false,
                elapsedMs: currentResult().elapsedMs,
                source: currentResult().source ?? null,
              }}
            />
          </Show>
        </section>
      </div>

      <StatusBar
        connection={active()?.name ?? null}
        rowCount={currentResult().result?.rows.length ?? null}
        truncated={currentResult().result?.truncated ?? false}
        elapsedMs={currentResult().elapsedMs}
        ranScope={currentResult().ranScope ?? null}
        theme={theme()}
        onToggleTheme={toggleTheme}
        onShowHelp={() => showTool("help", "Atajos de teclado", { key: "help" })}
        onShowSettings={() => showTool("settings", "Ajustes", { key: "settings" })}
      />

      <CommandPalette
        open={paletteOpen()}
        commands={visiblePaletteCommands()}
        placeholder={
          paletteMode() === "objects"
            ? "Buscar tablas, vistas… (Enter para abrir)"
            : undefined
        }
        onClose={() => setPaletteOpen(false)}
      />

      <UpdateModal
        update={update()}
        currentVersion={APP_VERSION}
        onClose={() => setUpdate(null)}
        onSkip={(v) => {
          saveSkippedVersion(v);
          setUpdate(null);
        }}
        onDownload={(url) => {
          openExternal(url);
          setUpdate(null);
        }}
        onInstall={canInstall() ? installUpdate : undefined}
      />

      <ContextMenu />
    </div>
  );
}
