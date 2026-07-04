import { For, Show, createMemo, createSignal, createEffect, onMount, onCleanup } from "solid-js";
import { createStore } from "solid-js/store";
import { runQuery, type ResultSet } from "./utils/query";
import { errorText, describeError } from "./utils/errors";
import { openConnection, closeConnection, testConnection } from "./utils/conn";
import {
  addTab,
  closeTab,
  closeOtherTabs,
  cycleTab,
  updateTabSql,
  activeTab,
  type TabState,
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
import { matchShortcut } from "./utils/shortcuts";
import { buildExplain } from "./utils/explain";
import { loadCompletionSchema } from "./utils/completion";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { Modal } from "./components/Modal";
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
import { addHistory, clampLimit, type HistoryEntry } from "./utils/history";
import {
  loadHistory,
  saveHistory,
  loadHistoryLimit,
  saveHistoryLimit,
} from "./utils/historyStore";
import { quoteIdentifier, schemaDescribe } from "./utils/schema";
import {
  describePkColumns,
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
import { saveText } from "./utils/download";
import type { TreeNode } from "./utils/tree";
import { SqlEditor } from "./components/SqlEditor";
import { ResultGrid } from "./components/ResultGrid";
import { StatusBar } from "./components/StatusBar";
import { ConnectionManager } from "./components/ConnectionManager";
import { ConnectionForm } from "./components/ConnectionForm";
import { ObjectTree } from "./components/ObjectTree";
import { StructureView } from "./components/StructureView";
import { ImportWizard } from "./components/ImportWizard";
import { ContextMenu } from "./components/ContextMenu";
import { TableDesigner } from "./components/TableDesigner";
import { SchemaSyncWizard } from "./components/SchemaSyncWizard";
import { DataDiffWizard } from "./components/DataDiffWizard";
import { TransferWizard } from "./components/TransferWizard";
import { HistoryPanel } from "./components/HistoryPanel";

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
  connId: string;
  name: string;
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
  const [active, setActive] = createSignal<ActiveConnection | null>(null);
  const [activeDefId, setActiveDefId] = createSignal<string | null>(null);
  const [connectingId, setConnectingId] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<Connection | null>(null);
  const [structureTarget, setStructureTarget] = createSignal<TreeNode | null>(null);
  const [importTarget, setImportTarget] =
    createSignal<{ table: string; db?: string; schema?: string } | null>(null);
  const [schemaSyncOpen, setSchemaSyncOpen] = createSignal(false);
  const [dataSyncOpen, setDataSyncOpen] = createSignal(false);
  const [transferOpen, setTransferOpen] = createSignal(false);
  const [createTable, setCreateTable] = createSignal<{ container?: string } | null>(null);
  const [treeReload, setTreeReload] = createSignal(0);

  // --- Query history (issue #128) ----------------------------------------
  const [history, setHistory] = createSignal<HistoryEntry[]>(loadHistory());
  const [historyLimit, setHistoryLimit] = createSignal(loadHistoryLimit());
  const [historyOpen, setHistoryOpen] = createSignal(false);

  // --- Theme, shortcuts, help (issue #42) --------------------------------
  const safeStorage = (): Storage | undefined => {
    try {
      return typeof localStorage !== "undefined" ? localStorage : undefined;
    } catch {
      return undefined;
    }
  };
  const [theme, setTheme] = createSignal<ThemePref>(loadTheme(safeStorage()));
  const [helpOpen, setHelpOpen] = createSignal(false);

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

  const runShortcut = (action: ReturnType<typeof matchShortcut>) => {
    switch (action) {
      case "new-tab":
        setTabs((s) => addTab(s));
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
        setHelpOpen((v) => !v);
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

  onMount(() => {
    if (typeof document !== "undefined") {
      applyTheme(theme(), document.documentElement, prefersDark());
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

  // SQL autocomplete schema (issue #110): built in the background from the active
  // connection's object tree, rebuilt on connection switch and on refresh (F5).
  const [sqlSchema, setSqlSchema] = createSignal<Record<string, string[]>>({});
  createEffect(() => {
    const conn = active();
    void treeReload(); // rebuild after a refresh too
    if (!conn) {
      setSqlSchema({});
      return;
    }
    const connId = conn.connId;
    void (async () => {
      const schema = await loadCompletionSchema(connId);
      // Ignore a late result if the connection changed meanwhile.
      if (active()?.connId === connId) setSqlSchema(schema);
    })();
  });

  const current = createMemo(() => activeTab(tabs()));
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

  const newTab = () => setTabs((s) => addTab(s));
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
      const added = addTab(s);
      newId = added.activeId;
      return updateTabSql(added, newId, sql);
    });
    void run(sql);
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

  // --- Connection management (issue #16) ---------------------------------
  const persist = (list: Connection[]) => {
    setConnections(list);
    saveConnections(list);
  };

  const onNewConnection = () => {
    const driver = AVAILABLE_DRIVERS[0];
    setEditing({
      id: nextConnectionId(connections()),
      name: "",
      driver,
      params: {},
    });
  };

  const onEditConnection = (c: Connection) =>
    setEditing({ ...c, params: { ...c.params } });

  const onDeleteConnection = (id: string) => {
    persist(removeConnection(connections(), id));
    if (activeDefId() === id) {
      void disconnect();
    }
  };

  const onSaveConnection = (c: Connection) => {
    persist(upsertConnection(connections(), c));
    setEditing(null);
  };

  const disconnect = async () => {
    const a = active();
    if (a) {
      try {
        await closeConnection(a.connId);
      } catch {
        /* best-effort close */
      }
    }
    setActive(null);
    setActiveDefId(null);
  };

  // --- End-to-end connect path (issue #17) -------------------------------
  const onConnect = async (c: Connection) => {
    // Already the live connection, or another connect in flight: do nothing
    // (avoids tearing down a live connection or racing two opens).
    if (connectingId() !== null || (active() && activeDefId() === c.id)) {
      return;
    }
    setConnectingId(c.id);
    try {
      // Close any previously active connection before switching.
      await disconnect();
      const connId = await openConnection(c.driver, buildDsn(c));
      setActive({ connId, name: c.name });
      setActiveDefId(c.id);
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

  // Record an executed query in the client-side history (issue #128), collapsing
  // immediate repeats and purging past the configured limit, then persist.
  const recordHistory = (sql: string, conn: ActiveConnection) => {
    const entry: HistoryEntry = {
      sql,
      ts: Date.now(),
      connId: activeDefId() ?? "",
      connName: conn.name,
    };
    setHistory((list) => {
      const next = addHistory(list, entry, historyLimit());
      saveHistory(next);
      return next;
    });
  };

  const run = async (sql: string, scope: RunScope = "document") => {
    const tab = current();
    if (!tab) return;
    const id = tab.id;
    const trimmed = sql.trim();
    if (!trimmed) {
      setResults(id, { ...emptyResult(), error: "La consulta está vacía." });
      return;
    }
    const conn = active();
    if (!conn) {
      setResults(id, {
        ...emptyResult(),
        error: "No hay conexión activa. Abre una conexión para ejecutar consultas.",
      });
      return;
    }
    recordHistory(trimmed, conn);
    setResults(id, { ...emptyResult(), loading: true, ranScope: scope });
    const started = performance.now();
    try {
      const result = await runQuery(conn.connId, trimmed, PAGE_LIMIT);
      setResults(id, {
        loading: false,
        error: null,
        result,
        elapsedMs: performance.now() - started,
        ranScope: scope,
      });
    } catch (err) {
      setResults(id, {
        loading: false,
        error: errorText(err),
        result: null,
        elapsedMs: performance.now() - started,
        ranScope: scope,
      });
    }
  };

  // Show the execution plan of the active query (issue #131): build the EXPLAIN
  // for the engine and run it as a normal (read-only) result in the grid. The
  // editor text is left untouched. Honest errors for empty SQL, no connection,
  // or an engine without an inline EXPLAIN.
  const explainActive = () => {
    const tab = current();
    if (!tab) return;
    const conn = active();
    const sql = (tabs().tabs.find((t) => t.id === tab.id)?.sql ?? "").trim();
    if (!sql) {
      setResults(tab.id, { ...emptyResult(), error: "La consulta está vacía." });
      return;
    }
    if (!conn) {
      setResults(tab.id, {
        ...emptyResult(),
        error: "No hay conexión activa. Abre una conexión para ver el plan.",
      });
      return;
    }
    const ex = buildExplain(activeDialect(), sql);
    if (!ex) {
      setResults(tab.id, {
        ...emptyResult(),
        error: `EXPLAIN no está disponible para el motor "${activeDialect() || "desconocido"}".`,
      });
      return;
    }
    void run(ex);
  };

  // --- Object tree actions (issues #19, #20) -----------------------------
  // Open a table's data: a fresh tab with a SELECT, executed immediately. The
  // table is qualified with its db/schema context so the query is correct on
  // engines (or attached databases) where the bare name would be ambiguous.
  const openData = (node: TreeNode) => {
    const qualified = [node.db, node.schema, node.label]
      .filter((p): p is string => !!p)
      .map((p) => quoteIdentifier(p, activeDialect()))
      .join(".");
    const sql = `SELECT * FROM ${qualified} LIMIT ${PAGE_LIMIT};`;
    let newId = 0;
    setTabs((s) => {
      const added = addTab(s);
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
    const conn = active();
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
    const conn = active();
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
    const conn = active();
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
    const conn = active();
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
    if (src && active()) {
      setImportTarget({ table: src.table, db: src.db, schema: src.schema });
    }
  };

  // --- Export (issue #30) ------------------------------------------------
  // Save the result as text. saveText prefers a native "Guardar como" dialog
  // (File System Access API in the webview) and falls back to a browser
  // download where unavailable. Client-side by design; see the M8 decision.
  const doExport = (format: ExportFormat) => {
    const res = currentResult().result;
    if (!res || res.columns.length === 0) return;
    const src = currentResult().source;
    const base = src?.table ?? current()?.title ?? "export";
    const text = exportResult(res, format, src?.table ?? "exported");
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
      const cell = row[colIndex];
      items.push({ label: "Copiar celda", action: () => copyText(cell ?? "") });
      items.push({ label: "Copiar fila", action: () => copyText(rowToTsv(row)) });
      items.push({
        label: "Copiar fila como JSON",
        action: () => copyText(rowToJson(res.columns, row)),
      });
      items.push({ separator: true });
    }
    items.push({ label: "Exportar CSV", action: () => doExport("csv") });
    items.push({ label: "Exportar JSON", action: () => doExport("json") });
    items.push({ label: "Exportar SQL", action: () => doExport("sql") });
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

  // Open a table's structure (columns + DDL) in a modal.
  const openStructure = (node: TreeNode) => {
    if (active()) {
      setStructureTarget(node);
    }
  };

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

  return (
    <div class="app">
      <div class="main">
        <aside class="sidebar" style={{ width: `${sidebarWidth()}px` }}>
          <div class="sidebar-header">Conexiones</div>
          <div class="sidebar-body">
            <ConnectionManager
              connections={connections()}
              activeConnId={activeDefId()}
              connectingId={connectingId()}
              onConnect={onConnect}
              onEdit={onEditConnection}
              onDelete={onDeleteConnection}
              onNew={onNewConnection}
            />
          </div>
          <Show when={active()}>
            <div class="sidebar-tree">
              <ObjectTree
                connId={active()!.connId}
                onOpenData={openData}
                onOpenStructure={openStructure}
                reloadKey={treeReload()}
                onRefresh={refreshAll}
                onImport={(node) =>
                  setImportTarget({ table: node.label, db: node.db, schema: node.schema })
                }
                onCreateTable={(node) =>
                  setCreateTable({ container: node.schema ?? node.db })
                }
              />
            </div>
          </Show>
        </aside>

        <div class="resizer" onMouseDown={startResize} />

        <section class="workspace">
          <div class="tabbar">
            <For each={tabs().tabs}>
              {(tab) => (
                <div
                  class={`tab ${tab.id === tabs().activeId ? "active" : ""}`}
                  onClick={() => selectTab(tab.id)}
                  onContextMenu={(e) => tabMenu(e, tab.id)}
                >
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

          <Show
            when={current()}
            fallback={<div class="grid-empty">Abre una pestaña de consulta.</div>}
          >
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
                      onClick={() => setHistoryOpen(true)}
                    >
                      Historial
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
                    <div class="edit-toolbar">
                      <Show when={currentResult().source}>
                        <Show
                          when={currentEdit().editing}
                          fallback={
                            <>
                              <Show
                                when={currentEditable()}
                                fallback={
                                  <span class="edit-hint-ro">
                                    Solo lectura: la tabla no tiene clave primaria.
                                  </span>
                                }
                              >
                                <button
                                  class="edit-btn"
                                  disabled={currentEdit().busy}
                                  onClick={beginEdit}
                                >
                                  Editar
                                </button>
                              </Show>
                              <button class="edit-btn" onClick={openImport}>
                                Importar
                              </button>
                              <button
                                class="edit-btn"
                                onClick={() => setSchemaSyncOpen(true)}
                              >
                                Sincronizar
                              </button>
                              <Show
                                when={
                                  currentEditable() &&
                                  (currentResult().result?.columns.length ?? 0) > 0
                                }
                              >
                                <button
                                  class="edit-btn"
                                  onClick={() => setDataSyncOpen(true)}
                                >
                                  Sincronizar datos
                                </button>
                              </Show>
                              <Show
                                when={(currentResult().result?.columns.length ?? 0) > 0}
                              >
                                <button
                                  class="edit-btn"
                                  onClick={() => setTransferOpen(true)}
                                >
                                  Transferir
                                </button>
                              </Show>
                            </>
                          }
                        >
                          <button class="edit-btn" onClick={onAddInsert}>
                            ＋ Fila
                          </button>
                          <button
                            class="edit-btn edit-btn-primary"
                            disabled={
                              currentEdit().busy || !hasChanges(currentEdit().pending)
                            }
                            onClick={confirmEdit}
                          >
                            Confirmar ({changeCount(currentEdit().pending)})
                          </button>
                          <button
                            class="edit-btn"
                            disabled={currentEdit().busy}
                            onClick={discardEdit}
                          >
                            Descartar
                          </button>
                        </Show>
                        <Show when={currentEdit().error}>
                          <span class="edit-error">{currentEdit().error}</span>
                        </Show>
                      </Show>

                      <Show when={(currentResult().result?.columns.length ?? 0) > 0}>
                        <span class="toolbar-spacer" />
                        <span class="export-label">Exportar:</span>
                        <button class="edit-btn" onClick={() => doExport("csv")}>
                          CSV
                        </button>
                        <button class="edit-btn" onClick={() => doExport("json")}>
                          JSON
                        </button>
                        <button class="edit-btn" onClick={() => doExport("sql")}>
                          SQL
                        </button>
                      </Show>
                    </div>
                  </Show>
                  <ResultGrid
                    result={currentResult().result}
                    loading={currentResult().loading}
                    error={currentResult().error}
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
              </div>
            )}
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
        onShowHelp={() => setHelpOpen(true)}
      />

      <Show when={helpOpen()}>
        <ShortcutsHelp isMac={isMac()} onClose={() => setHelpOpen(false)} />
      </Show>

      <Show when={historyOpen()}>
        <HistoryPanel
          entries={history()}
          limit={historyLimit()}
          onRun={runFromHistory}
          onClear={clearHistory}
          onChangeLimit={changeHistoryLimit}
          onClose={() => setHistoryOpen(false)}
        />
      </Show>

      <Show when={editing()}>
        {(draft) => (
          <ConnectionForm
            initial={draft()}
            onSave={onSaveConnection}
            onCancel={() => setEditing(null)}
            onTest={(c) => testConnection(c.driver, buildDsn(c))}
          />
        )}
      </Show>

      <Show when={currentEdit().preview}>
        {(sqls) => (
          <Modal title="Confirmar cambios" wide onClose={cancelPreview}>
            <h2>Confirmar cambios</h2>
            <p>Se ejecutarán {sqls().length} sentencia(s) en la transacción abierta:</p>
            <pre class="ddl-text preview-sql">{sqls().join(";\n")}</pre>
            <div class="modal-actions">
              <button disabled={currentEdit().busy} onClick={cancelPreview}>
                Cancelar
              </button>
              <button class="primary" disabled={currentEdit().busy} onClick={applyEdit}>
                Aplicar y confirmar
              </button>
            </div>
          </Modal>
        )}
      </Show>

      <Show when={importTarget() && active()}>
        <ImportWizard
          connId={active()!.connId}
          target={importTarget()!}
          onClose={() => setImportTarget(null)}
          onImported={() => {
            const t = current();
            if (t) reloadCurrent(t.id);
          }}
        />
      </Show>

      <Show when={schemaSyncOpen() && active()}>
        <SchemaSyncWizard
          sourceConnId={active()!.connId}
          sourceDb={currentResult().source?.db}
          connections={connections()}
          onClose={() => setSchemaSyncOpen(false)}
        />
      </Show>

      <Show
        when={
          dataSyncOpen() &&
          active() &&
          currentResult().result &&
          currentResult().source
        }
      >
        <DataDiffWizard
          sourceResult={currentResult().result!}
          source={{
            table: currentResult().source!.table,
            db: currentResult().source!.db,
            schema: currentResult().source!.schema,
          }}
          pk={currentResult().source!.pk}
          connections={connections()}
          onClose={() => setDataSyncOpen(false)}
        />
      </Show>

      <Show
        when={
          transferOpen() &&
          active() &&
          currentResult().result &&
          currentResult().source
        }
      >
        <TransferWizard
          sourceResult={currentResult().result!}
          sourceTable={currentResult().source!.table}
          connections={connections()}
          onClose={() => setTransferOpen(false)}
        />
      </Show>

      <Show when={createTable() && active()}>
        <TableDesigner
          connId={active()!.connId}
          engine={activeDialect()}
          container={createTable()!.container}
          onClose={() => setCreateTable(null)}
          onCreated={() => setTreeReload((n) => n + 1)}
        />
      </Show>

      <Show when={structureTarget() && active()}>
        <StructureView
          connId={active()!.connId}
          table={structureTarget()!.label}
          db={structureTarget()!.db}
          schema={structureTarget()!.schema}
          kind={structureTarget()!.kind}
          engine={activeDialect()}
          onClose={() => setStructureTarget(null)}
          onApplied={() => setTreeReload((n) => n + 1)}
        />
      </Show>

      <ContextMenu />
    </div>
  );
}
