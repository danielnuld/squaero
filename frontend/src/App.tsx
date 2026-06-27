import { For, Show, createMemo, createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { hasBridge } from "./utils/transport";
import { runQuery, QueryError, type ResultSet } from "./utils/query";
import {
  addTab,
  closeTab,
  updateTabSql,
  activeTab,
  type TabState,
} from "./utils/tabs";
import { clampSidebarWidth, SIDEBAR_DEFAULT } from "./utils/layout";
import { SqlEditor } from "./components/SqlEditor";
import { ResultGrid } from "./components/ResultGrid";
import { StatusBar } from "./components/StatusBar";

// Per-tab execution state, keyed by tab id.
interface TabResult {
  loading: boolean;
  error: string | null;
  result: ResultSet | null;
  elapsedMs: number | null;
}

// Sent explicitly rather than relying on the core's default so the page size is
// owned by the UI. True page-by-page fetching (offset/cursor) needs protocol
// support and lands with the E2E connection work (issue #17); for now the grid
// virtualizes the returned page and surfaces `truncated` honestly.
const PAGE_LIMIT = 1000;

const emptyResult = (): TabResult => ({
  loading: false,
  error: null,
  result: null,
  elapsedMs: null,
});

// Root layout: resizable sidebar | tabbed workspace (editor over result grid),
// with a status bar across the bottom. The active connection is wired by the
// connection manager (issue #16); until then runs report "no active connection"
// honestly rather than faking success.
export function App() {
  const [tabs, setTabs] = createSignal<TabState>(addTab({ tabs: [], activeId: 0 }));
  const [results, setResults] = createStore<Record<number, TabResult>>({});
  const [sidebarWidth, setSidebarWidth] = createSignal(SIDEBAR_DEFAULT);
  const [activeConnId] = createSignal<string | null>(null);

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

  const run = async (sql: string) => {
    const tab = current();
    if (!tab) return;
    const id = tab.id;
    const trimmed = sql.trim();
    if (!trimmed) {
      setResults(id, { ...emptyResult(), error: "La consulta está vacía." });
      return;
    }
    const connId = activeConnId();
    if (!connId) {
      setResults(id, {
        ...emptyResult(),
        error: "No hay conexión activa. Abre una conexión para ejecutar consultas.",
      });
      return;
    }
    setResults(id, { ...emptyResult(), loading: true });
    const started = performance.now();
    try {
      const result = await runQuery(connId, trimmed, PAGE_LIMIT);
      setResults(id, {
        loading: false,
        error: null,
        result,
        elapsedMs: performance.now() - started,
      });
    } catch (err) {
      const message =
        err instanceof QueryError ? err.message : String(err);
      setResults(id, {
        loading: false,
        error: message,
        result: null,
        elapsedMs: performance.now() - started,
      });
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
            <p class="sidebar-hint">
              {hasBridge()
                ? "El gestor de conexiones llega en el issue #16."
                : "Modo navegador: el núcleo no está disponible fuera de la app."}
            </p>
          </div>
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
        connection={activeConnId()}
        rowCount={currentResult().result?.rows.length ?? null}
        truncated={currentResult().result?.truncated ?? false}
        elapsedMs={currentResult().elapsedMs}
      />
    </div>
  );
}
