import { For, Show, createSignal, createMemo } from "solid-js";
import { createStore } from "solid-js/store";
import { Panel } from "./Panel";
import { ResultGrid } from "./ResultGrid";
import { runQuery, type ResultSet } from "../utils/query";
import { errorText } from "../utils/errors";
import { renderMarkdown } from "../utils/markdown";
import { saveText } from "../utils/download";
import { loadNotebooks, saveNotebooks } from "../utils/notebookStore";
import { notebookToMarkdown, notebookToHtml } from "../utils/notebookExport";
import {
  newNotebook,
  newCell,
  insertCellAfter,
  removeCell as removeCellPure,
  updateCellSource,
  setCellKind,
  moveCell,
  applyParams,
  upsertNotebook,
  removeNotebook,
  nextNotebookId,
  type Notebook as NotebookModel,
  type Cell,
  type CellKind,
} from "../utils/notebook";
import { t } from "../utils/i18n";

interface CellResult {
  loading: boolean;
  error: string | null;
  result: ResultSet | null;
}

// SQL notebook (issue #262): a document of ordered SQL + Markdown cells that
// share parameters. SQL cells run through runQuery and show their grid inline;
// Markdown cells render (safely) for narration; a result can be charted (opens
// the chart tool). Notebooks persist to localStorage. All model/parse logic is
// the pure module utils/notebook.ts; this is the binding + per-cell run state.
export function Notebook(props: {
  /** Connection SQL cells run against (empty when none is focused). */
  connId: string;
  /** Notebook to open; when unknown, the first saved (or a new) one is shown. */
  notebookId?: string;
  /** Chart a cell's result by opening the chart tool. */
  onChart: (result: ResultSet) => void;
  onClose: () => void;
}) {
  const boot = (): NotebookModel[] => {
    const loaded = loadNotebooks();
    return loaded.length > 0 ? loaded : [newNotebook("nb-1", "Notebook 1")];
  };
  const [list, setList] = createSignal<NotebookModel[]>(boot());
  const [currentId, setCurrentId] = createSignal(
    props.notebookId && list().some((n) => n.id === props.notebookId)
      ? props.notebookId
      : list()[0].id,
  );
  const current = createMemo(() => list().find((n) => n.id === currentId()) ?? list()[0]);

  const [results, setResults] = createStore<Record<string, CellResult>>({});
  // Which Markdown cells are in edit mode (rendered otherwise).
  const [editing, setEditing] = createStore<Record<string, boolean>>({});

  const persist = (next: NotebookModel[]) => {
    setList(next);
    saveNotebooks(next);
  };
  const mutate = (fn: (nb: NotebookModel) => NotebookModel) => {
    const cur = current();
    if (cur) persist(upsertNotebook(list(), fn(cur)));
  };

  // --- notebook-level ---
  const createNotebook = () => {
    const id = nextNotebookId(list());
    persist([...list(), newNotebook(id, `Notebook ${list().length + 1}`)]);
    setCurrentId(id);
  };
  const deleteNotebook = () => {
    if (list().length <= 1) return;
    const id = currentId();
    const next = removeNotebook(list(), id);
    persist(next);
    setCurrentId(next[0].id);
  };

  // --- cells ---
  const addCell = (afterId: string, kind: CellKind) => {
    let newId = "";
    mutate((nb) => {
      const cell = newCell(nb.cells, kind);
      newId = cell.id;
      return { ...nb, cells: insertCellAfter(nb.cells, afterId, cell) };
    });
    if (kind === "markdown" && newId) setEditing(newId, true);
  };
  const deleteCell = (id: string) => {
    mutate((nb) => ({ ...nb, cells: removeCellPure(nb.cells, id) }));
    setResults(id, undefined as unknown as CellResult);
  };
  const editSource = (id: string, source: string) =>
    mutate((nb) => ({ ...nb, cells: updateCellSource(nb.cells, id, source) }));
  const switchKind = (id: string, kind: CellKind) =>
    mutate((nb) => ({ ...nb, cells: setCellKind(nb.cells, id, kind) }));
  const move = (id: string, dir: -1 | 1) =>
    mutate((nb) => ({ ...nb, cells: moveCell(nb.cells, id, dir) }));

  // --- params ---
  const addParam = () =>
    mutate((nb) => ({ ...nb, params: [...nb.params, { name: "", value: "" }] }));
  const setParam = (i: number, key: "name" | "value", v: string) =>
    mutate((nb) => ({
      ...nb,
      params: nb.params.map((p, j) => (j === i ? { ...p, [key]: v } : p)),
    }));
  const removeParam = (i: number) =>
    mutate((nb) => ({ ...nb, params: nb.params.filter((_, j) => j !== i) }));

  // --- run ---
  const runCell = async (cell: Cell) => {
    if (cell.kind !== "sql") return;
    const sql = applyParams(cell.source, current().params).trim();
    if (sql === "") return;
    if (!props.connId) {
      setResults(cell.id, { loading: false, error: t("nb.noConnErr"), result: null });
      return;
    }
    setResults(cell.id, { loading: true, error: null, result: null });
    try {
      const result = await runQuery(props.connId, sql);
      setResults(cell.id, { loading: false, error: null, result });
    } catch (err) {
      setResults(cell.id, { loading: false, error: errorText(err), result: null });
    }
  };
  const runAll = async () => {
    for (const cell of current().cells) {
      // eslint-disable-next-line no-await-in-loop -- cells run in document order
      if (cell.kind === "sql") await runCell(cell);
    }
  };

  // --- export ---
  const resultsMap = () => {
    const m = new Map<string, ResultSet>();
    for (const [id, r] of Object.entries(results)) {
      if (r && r.result) m.set(id, r.result);
    }
    return m;
  };
  const exportMd = () =>
    void saveText(`${current().name}.md`, notebookToMarkdown(current(), resultsMap()), "text/markdown");
  const exportHtml = () =>
    void saveText(`${current().name}.html`, notebookToHtml(current(), resultsMap()), "text/html");

  return (
    <Panel title={t("tool.notebook.tab")} onClose={props.onClose}>
      <div class="nb-header">
        <input
          class="nb-name"
          value={current().name}
          onInput={(e) => mutate((nb) => ({ ...nb, name: e.currentTarget.value }))}
          aria-label={t("nb.nameAria")}
        />
        <select
          class="nb-open"
          title={t("nb.open")}
          value={currentId()}
          onChange={(e) => setCurrentId(e.currentTarget.value)}
        >
          <For each={list()}>{(n) => <option value={n.id}>{n.name}</option>}</For>
        </select>
        <button class="status-btn" title={t("nb.newTitle")} onClick={createNotebook}>
          {t("nb.new")}
        </button>
        <button
          class="status-btn"
          title={t("nb.deleteTitle")}
          disabled={list().length <= 1}
          onClick={deleteNotebook}
        >
          {t("common.delete")}
        </button>
        <span class="editor-hint-spacer" />
        <button class="status-btn run-btn" title={t("nb.runAllTitle")} onClick={runAll}>
          {t("nb.runAll")}
        </button>
        <button class="status-btn" title={t("nb.exportMd")} onClick={exportMd}>
          .md
        </button>
        <button class="status-btn" title={t("nb.exportHtml")} onClick={exportHtml}>
          .html
        </button>
      </div>

      <Show when={!props.connId}>
        <p class="nb-hint">{t("nb.connHint")}</p>
      </Show>

      <details class="nb-params">
        <summary>{t("nb.params", { n: current().params.length })}</summary>
        <p class="nb-params-hint">
          {t("nb.paramsHintPre")}<code>{t("nb.paramCode")}</code>{t("nb.paramsHintPost")}
        </p>
        <For each={current().params}>
          {(p, i) => (
            <div class="nb-param-row">
              <input
                placeholder={t("nb.paramName")}
                value={p.name}
                onInput={(e) => setParam(i(), "name", e.currentTarget.value)}
              />
              <input
                placeholder={t("nb.paramValue")}
                value={p.value}
                onInput={(e) => setParam(i(), "value", e.currentTarget.value)}
              />
              <button class="status-btn" title={t("nb.remove")} onClick={() => removeParam(i())}>
                ✕
              </button>
            </div>
          )}
        </For>
        <button class="status-btn" onClick={addParam}>
          {t("nb.addParam")}
        </button>
      </details>

      <div class="nb-cells">
        <For each={current().cells}>
          {(cell, idx) => (
            <div class={`nb-cell nb-cell-${cell.kind}`}>
              <div class="nb-cell-bar">
                <span class="nb-cell-kind">{cell.kind === "sql" ? "SQL" : "Markdown"}</span>
                <Show when={cell.kind === "sql"}>
                  <button
                    class="status-btn run-btn"
                    title={t("nb.runCellTitle")}
                    onClick={() => void runCell(cell)}
                  >
                    {t("nb.runCell")}
                  </button>
                </Show>
                <span class="editor-hint-spacer" />
                <button
                  class="status-btn"
                  title={cell.kind === "sql" ? t("nb.toMd") : t("nb.toSql")}
                  onClick={() => switchKind(cell.id, cell.kind === "sql" ? "markdown" : "sql")}
                >
                  {cell.kind === "sql" ? "→ MD" : "→ SQL"}
                </button>
                <button class="status-btn" title={t("nb.moveUp")} disabled={idx() === 0} onClick={() => move(cell.id, -1)}>
                  ↑
                </button>
                <button
                  class="status-btn"
                  title={t("nb.moveDown")}
                  disabled={idx() === current().cells.length - 1}
                  onClick={() => move(cell.id, 1)}
                >
                  ↓
                </button>
                <button class="status-btn" title={t("nb.addSqlBelow")} onClick={() => addCell(cell.id, "sql")}>
                  +SQL
                </button>
                <button class="status-btn" title={t("nb.addMdBelow")} onClick={() => addCell(cell.id, "markdown")}>
                  +MD
                </button>
                <button
                  class="status-btn"
                  title={t("nb.deleteCell")}
                  disabled={current().cells.length <= 1}
                  onClick={() => deleteCell(cell.id)}
                >
                  🗑
                </button>
              </div>

              <Show
                when={cell.kind === "sql" || editing[cell.id] || cell.source.trim() === ""}
                fallback={
                  <div
                    class="nb-md"
                    onDblClick={() => setEditing(cell.id, true)}
                    title={t("nb.dblClickEdit")}
                    // eslint-disable-next-line solid/no-innerhtml -- renderMarkdown escapes all HTML
                    innerHTML={renderMarkdown(cell.source)}
                  />
                }
              >
                <textarea
                  class={cell.kind === "sql" ? "nb-src nb-src-sql" : "nb-src"}
                  value={cell.source}
                  spellcheck={cell.kind === "markdown"}
                  placeholder={cell.kind === "sql" ? "SELECT …" : t("nb.mdPlaceholder")}
                  onInput={(e) => editSource(cell.id, e.currentTarget.value)}
                  onBlur={() => cell.kind === "markdown" && setEditing(cell.id, false)}
                />
              </Show>

              <Show when={cell.kind === "sql" && results[cell.id]}>
                {(r) => (
                  <div class="nb-result">
                    <Show when={r().result && (r().result!.columns.length > 0)}>
                      <div class="nb-result-bar">
                        <span class="nb-result-info">
                          {t("nb.rows", { n: r().result!.rows.length })}
                          {r().result!.truncated ? t("nb.truncatedSuffix") : ""}
                        </span>
                        <button
                          class="status-btn"
                          title={t("nb.chartTitle")}
                          onClick={() => props.onChart(r().result!)}
                        >
                          {t("nb.chart")}
                        </button>
                      </div>
                    </Show>
                    <ResultGrid
                      result={r().result}
                      loading={r().loading}
                      error={r().error}
                      rowHeight={26}
                    />
                  </div>
                )}
              </Show>
            </div>
          )}
        </For>
      </div>
    </Panel>
  );
}
