import { For, Show, createMemo, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { runQuery, QueryError, type ResultSet } from "./utils/query";
import { openConnection, closeConnection, testConnection } from "./utils/conn";
import {
  addTab,
  closeTab,
  updateTabSql,
  activeTab,
  type TabState,
} from "./utils/tabs";
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
import { quoteIdentifier } from "./utils/schema";
import type { TreeNode } from "./utils/tree";
import { SqlEditor } from "./components/SqlEditor";
import { ResultGrid } from "./components/ResultGrid";
import { StatusBar } from "./components/StatusBar";
import { ConnectionManager } from "./components/ConnectionManager";
import { ConnectionForm } from "./components/ConnectionForm";
import { ObjectTree } from "./components/ObjectTree";
import { StructureView } from "./components/StructureView";

// Per-tab execution state, keyed by tab id.
interface TabResult {
  loading: boolean;
  error: string | null;
  result: ResultSet | null;
  elapsedMs: number | null;
}

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
  const [sidebarWidth, setSidebarWidth] = createSignal(SIDEBAR_DEFAULT);

  const [connections, setConnections] = createSignal<Connection[]>(loadConnections());
  const [active, setActive] = createSignal<ActiveConnection | null>(null);
  const [activeDefId, setActiveDefId] = createSignal<string | null>(null);
  const [connectingId, setConnectingId] = createSignal<string | null>(null);
  const [editing, setEditing] = createSignal<Connection | null>(null);
  const [structureTarget, setStructureTarget] = createSignal<TreeNode | null>(null);

  const current = createMemo(() => activeTab(tabs()));
  // A memo so reads in JSX/StatusBar track the per-tab store entry reactively.
  const currentResult = createMemo<TabResult>(() => {
    const t = current();
    return (t && results[t.id]) || emptyResult();
  });

  const newTab = () => setTabs((s) => addTab(s));
  const selectTab = (id: number) => setTabs((s) => ({ ...s, activeId: id }));
  const removeTab = (id: number, e: MouseEvent) => {
    e.stopPropagation();
    setTabs((s) => closeTab(s, id));
  };

  const onEditorChange = (id: number, sql: string) =>
    setTabs((s) => updateTabSql(s, id, sql));

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
      const message = err instanceof QueryError ? err.message : String(err);
      if (tab) {
        setResults(tab.id, {
          ...emptyResult(),
          error: `No se pudo conectar a "${c.name}": ${message}`,
        });
      }
    } finally {
      setConnectingId(null);
    }
  };

  const run = async (sql: string) => {
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
    setResults(id, { ...emptyResult(), loading: true });
    const started = performance.now();
    try {
      const result = await runQuery(conn.connId, trimmed, PAGE_LIMIT);
      setResults(id, {
        loading: false,
        error: null,
        result,
        elapsedMs: performance.now() - started,
      });
    } catch (err) {
      const message = err instanceof QueryError ? err.message : String(err);
      setResults(id, {
        loading: false,
        error: message,
        result: null,
        elapsedMs: performance.now() - started,
      });
    }
  };

  // --- Object tree actions (issues #19, #20) -----------------------------
  // Open a table's data: a fresh tab with a SELECT, executed immediately. The
  // table is qualified with its db/schema context so the query is correct on
  // engines (or attached databases) where the bare name would be ambiguous.
  const openData = (node: TreeNode) => {
    const qualified = [node.db, node.schema, node.label]
      .filter((p): p is string => !!p)
      .map(quoteIdentifier)
      .join(".");
    const sql = `SELECT * FROM ${qualified} LIMIT ${PAGE_LIMIT};`;
    setTabs((s) => {
      const added = addTab(s);
      return updateTabSql(added, added.activeId, sql);
    });
    void run(sql);
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
                >
                  <span class="tab-title">{tab.title}</span>
                  <button
                    class="tab-close"
                    title="Cerrar pestaña"
                    onClick={(e) => removeTab(tab.id, e)}
                  >
                    ×
                  </button>
                </div>
              )}
            </For>
            <button class="tab-new" title="Nueva consulta" onClick={newTab}>
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
                  />
                  <div class="editor-hint">Ctrl/Cmd + Enter para ejecutar</div>
                </div>
                <div class="result-pane">
                  <ResultGrid
                    result={currentResult().result}
                    loading={currentResult().loading}
                    error={currentResult().error}
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
      />

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

      <Show when={structureTarget() && active()}>
        <StructureView
          connId={active()!.connId}
          table={structureTarget()!.label}
          db={structureTarget()!.db}
          schema={structureTarget()!.schema}
          onClose={() => setStructureTarget(null)}
        />
      </Show>
    </div>
  );
}
