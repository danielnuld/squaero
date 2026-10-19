import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { Panel } from "./Panel";
import { ResultGrid } from "./ResultGrid";
import { Segmented } from "./Segmented";
import { SqlHighlight } from "./SqlHighlight";
import { EmptyNote } from "./EmptyNote";
import { runQuery, type ResultSet } from "../utils/query";
import { cancelQuery } from "../utils/transport";
import { countText } from "../utils/confirmText";
import { schemaTree, schemaDescribe, parseTreeRows } from "../utils/schema";
import { errorText } from "../utils/errors";
import { copyText } from "../utils/rowCopy";
import {
  buildSelect,
  isNullaryOp,
  emptyCondition,
  OPERATORS,
  type Condition,
  type Operator,
  type QuerySpec,
} from "../utils/queryBuilder";
import { t } from "../utils/i18n";
import { Icon } from "./icons";
import { Dropdown } from "./Dropdown";

interface TableRef {
  table: string;
  container?: string;
}

// Safety bound on the walk, not a display limit. It used to be 200, which a real
// database blows past: the listing comes back ordered by type then name, so the
// truncation ate every view first and then most of the tables (reported bug).
const MAX_TABLES = 5000;
const keyOf = (t: TableRef) => `${t.container ?? ""}|${t.table}`;

/** Walk the object tree (bounded) into a flat table list with db/schema
    qualifier. When `db` is given the walk is scoped to that database. */
async function loadTableList(connId: string, db: string | undefined, max = MAX_TABLES): Promise<TableRef[]> {
  const out: TableRef[] = [];
  if (db) {
    const level1 = parseTreeRows(await schemaTree(connId, db), "schema");
    for (const n1 of level1) {
      if (out.length >= max) break;
      if (n1.kind === "table" || n1.kind === "view") {
        out.push({ table: n1.name, container: db });
        continue;
      }
      const level2 = parseTreeRows(await schemaTree(connId, db, n1.name), "schema");
      for (const n2 of level2) {
        if (out.length >= max) break;
        out.push({ table: n2.name, container: n1.name });
      }
    }
    return out;
  }
  const level0 = parseTreeRows(await schemaTree(connId), "database");
  for (const n0 of level0) {
    if (out.length >= max) break;
    if (n0.kind === "table" || n0.kind === "view") {
      out.push({ table: n0.name });
      continue;
    }
    const level1 = parseTreeRows(await schemaTree(connId, n0.name), "schema");
    for (const n1 of level1) {
      if (out.length >= max) break;
      if (n1.kind === "table" || n1.kind === "view") {
        out.push({ table: n1.name, container: n0.name });
        continue;
      }
      const level2 = parseTreeRows(await schemaTree(connId, n0.name, n1.name), "schema");
      for (const n2 of level2) {
        if (out.length >= max) break;
        out.push({ table: n2.name, container: n1.name });
      }
    }
  }
  return out;
}

// Visual query builder (issue #146): pick a table, columns, WHERE conditions,
// ORDER BY and LIMIT from a form; a live SQL preview (buildSelect, per engine) is
// runnable in a new query tab. The SQL generation is the pure helper in
// utils/queryBuilder.ts; this component is the form that feeds it.
//
// P6 (prototype QueryBuilder): the bar runs it, stops the preview, opens the
// SQL in the editor WITHOUT running it, copies it and clears the form; AND/OR
// and Asc/Desc are segmented; the SQL is highlighted; and a preview grid
// re-reads up to PREVIEW_ROWS rows a moment after the form stops changing.
const PREVIEW_ROWS = 100;
const PREVIEW_DELAY_MS = 400;
export function QueryBuilder(props: {
  connId: string;
  engine: string;
  db?: string;
  onRun: (sql: string) => void;
  /** Open the SQL in a new query tab without running it. */
  onOpen?: (sql: string) => void;
  onClose: () => void;
}) {
  const [tables, setTables] = createSignal<TableRef[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [truncated, setTruncated] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [tableKey, setTableKey] = createSignal("");
  const [columns, setColumns] = createSignal<string[]>([]);
  const [selCols, setSelCols] = createStore<Record<string, boolean>>({});
  const [conds, setConds] = createStore<Condition[]>([]);
  const [conjunction, setConjunction] = createSignal<"AND" | "OR">("AND");
  const [orderCol, setOrderCol] = createSignal("");
  const [orderDir, setOrderDir] = createSignal<"ASC" | "DESC">("ASC");
  const [limit, setLimit] = createSignal<number | null>(null);

  const currentTable = () => tables().find((t) => keyOf(t) === tableKey());
  const spec = createMemo<QuerySpec>(() => ({
    table: currentTable()?.table ?? "",
    container: currentTable()?.container,
    columns: columns().filter((c) => selCols[c]),
    conditions: [...conds],
    conjunction: conjunction(),
    orderBy: orderCol() ? { column: orderCol(), dir: orderDir() } : null,
    limit: limit(),
  }));
  const sql = createMemo(() => buildSelect(props.engine, spec()));

  // The preview: read a moment after the form settles, capped by the core.
  const [preview, setPreview] = createSignal<ResultSet | null>(null);
  const [previewMs, setPreviewMs] = createSignal<number | null>(null);
  const [previewError, setPreviewError] = createSignal<string | null>(null);
  const [previewing, setPreviewing] = createSignal(false);
  let previewToken = 0;
  createEffect(() => {
    const q = sql();
    const connId = props.connId;
    const my = ++previewToken;
    setPreviewError(null);
    if (!q) {
      setPreview(null);
      return;
    }
    const timer = setTimeout(async () => {
      setPreviewing(true);
      const started = performance.now();
      try {
        const res = await runQuery(connId, q, PREVIEW_ROWS);
        if (my !== previewToken) return;
        setPreview(res);
        setPreviewMs(Math.round(performance.now() - started));
      } catch (err) {
        if (my === previewToken) setPreviewError(errorText(err));
      } finally {
        if (my === previewToken) setPreviewing(false);
      }
    }, PREVIEW_DELAY_MS);
    onCleanup(() => clearTimeout(timer));
  });
  const stopPreview = () => {
    previewToken++;
    setPreviewing(false);
    void cancelQuery(props.connId).catch(() => {});
  };

  const clearForm = () => {
    setSelCols(produce((s) => Object.keys(s).forEach((k) => delete s[k])));
    setConds([]);
    setConjunction("AND");
    setOrderCol("");
    setOrderDir("ASC");
    setLimit(null);
  };

  const selectTable = async (key: string) => {
    setTableKey(key);
    setColumns([]);
    setSelCols(produce((s) => Object.keys(s).forEach((k) => delete s[k])));
    setConds([]);
    setOrderCol("");
    const t = tables().find((x) => keyOf(x) === key);
    if (!t) return;
    try {
      const desc = await schemaDescribe(props.connId, t.table, t.container, undefined);
      const ni = desc.columns.findIndex((c) => c.name === "name");
      setColumns(ni >= 0 ? desc.rows.map((r) => r[ni] ?? "").filter((n) => n) : []);
    } catch (err) {
      setError(errorText(err));
    }
  };

  // (Re)load the table list whenever the connection or working database changes.
  createEffect(() => {
    const connId = props.connId;
    const db = props.db;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const ts = await loadTableList(connId, db);
        if (props.connId !== connId || props.db !== db) return; // superseded
        setTables(ts);
        setTruncated(ts.length >= MAX_TABLES);
        if (ts.length > 0) await selectTable(keyOf(ts[0]));
      } catch (err) {
        setError(errorText(err));
      } finally {
        setLoading(false);
      }
    })();
  });

  const addCond = () => setConds(conds.length, emptyCondition());
  const removeCond = (i: number) => setConds(produce((c) => c.splice(i, 1)));
  const patchCond = (i: number, key: keyof Condition, value: string) =>
    setConds(i, key as keyof Condition, value as never);

  return (
    <Panel
      title={t("tool.qb.label")}
      class="qb"
      onClose={props.onClose}
      actions={
        <Show when={!loading() && tables().length > 0}>
          <button
            type="button"
            class="edit-btn edit-btn-primary"
            disabled={!sql()}
            title={t("qb.runTitle")}
            onClick={() => props.onRun(sql())}
          >
            {t("editor.run")}
          </button>
          <button
            type="button"
            class="edit-btn"
            disabled={!previewing()}
            title={previewing() ? t("qb.stopTitle") : t("qb.stopIdle")}
            onClick={stopPreview}
          >
            {t("qb.stop")}
          </button>
          <Show when={props.onOpen}>
            <button
              type="button"
              class="edit-btn"
              disabled={!sql()}
              title={t("qb.openTitle")}
              onClick={() => props.onOpen!(sql())}
            >
              {t("qb.open")}
            </button>
          </Show>
          <button type="button" class="edit-btn" disabled={!sql()} onClick={() => copyText(sql())}>
            {t("qb.copy")}
          </button>
          <button type="button" class="edit-btn" onClick={clearForm}>
            {t("qb.clear")}
          </button>
        </Show>
      }
      status={
        <Show when={!loading() && tables().length > 0}>
          {countText("qb.tables", tables().length)}
        </Show>
      }
    >
      <Show when={error()}>
        <div class="grid-error" role="alert">
          {error()}
        </div>
      </Show>

      <Show when={!loading()} fallback={<p class="grid-empty">{t("qb.loadingTables")}</p>}>
        <Show
          when={tables().length > 0}
          fallback={<EmptyNote title={t("qb.noTables")} />}
        >
          <div class="qb-layout">
          <div class="qb-form">
          <label class="field">
            <span>{t("qb.table")}</span>
            <Dropdown
              value={tableKey()}
              options={tables().map((tbl) => ({ value: keyOf(tbl), label: tbl.container ? `${tbl.container}.${tbl.table}` : tbl.table }))}
              onChange={(v) => void selectTable(v)}
              class="map-select"
            />
          </label>

          <Show when={truncated()}>
            <p class="grid-empty" role="status">{t("qb.truncated", { n: MAX_TABLES })}</p>
          </Show>

          <div class="qb-section">
            <div class="import-subtitle">
              {t("qb.columnsOf", { n: columns().filter((c) => selCols[c]).length, m: columns().length })}
            </div>
            <div class="qb-cols">
              <For each={columns()}>
                {(c) => (
                  <label class="qb-col">
                    <input
                      type="checkbox"
                      checked={selCols[c] ?? false}
                      onChange={(e) => setSelCols(c, e.currentTarget.checked)}
                    />{" "}
                    {c}
                  </label>
                )}
              </For>
            </div>
          </div>

          <div class="qb-section">
            <div class="import-subtitle">
              {t("qb.conditions")}
              <Segmented
                label={t("qb.combine")}
                value={conjunction()}
                options={[
                  { value: "AND" as const, label: t("qb.and") },
                  { value: "OR" as const, label: t("qb.or") },
                ]}
                onChange={setConjunction}
              />
            </div>
            <For each={conds}>
              {(c, i) => (
                <div class="qb-cond">
                  <Dropdown
                    value={c.column}
                    options={[{ value: "", label: t("qb.columnPlaceholder") }, ...columns().map((col) => ({ value: col, label: col }))]}
                    onChange={(v) => patchCond(i(), "column", v)}
                    class="map-select"
                  />
                  <Dropdown
                    value={c.op}
                    options={OPERATORS.map((op) => ({ value: op, label: op }))}
                    onChange={(v) => patchCond(i(), "op", v as Operator)}
                    class="map-select"
                  />
                  <input
                    class="td-in"
                    placeholder={c.op === "IN" ? "a, b, c" : t("qb.valuePlaceholder")}
                    disabled={isNullaryOp(c.op)}
                    value={c.value}
                    onInput={(e) => patchCond(i(), "value", e.currentTarget.value)}
                  />
                  <button
                    class="grid-action danger"
                    title={t("qb.removeCond")}
                    aria-label={t("qb.removeCond")}
                    onClick={() => removeCond(i())}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </div>
              )}
            </For>
            <button class="edit-btn" onClick={addCond}>
              {t("qb.addCond")}
            </button>
          </div>

          <div class="qb-section qb-order">
            <label class="field">
              <span>{t("qb.orderBy")}</span>
              <Dropdown
                value={orderCol()}
                options={[{ value: "", label: "—" }, ...columns().map((c) => ({ value: c, label: c }))]}
                onChange={(v) => setOrderCol(v)}
                class="map-select"
              />
            </label>
            <Show when={orderCol()}>
              <Segmented
                label={t("qb.direction")}
                value={orderDir()}
                options={[
                  { value: "ASC" as const, label: t("qb.asc") },
                  { value: "DESC" as const, label: t("qb.desc") },
                ]}
                onChange={setOrderDir}
              />
            </Show>
            <label class="field">
              <span>{t("qb.limit")}</span>
              <input
                class="td-in dg-num"
                type="number"
                min="1"
                value={limit() ?? ""}
                onInput={(e) => setLimit(e.currentTarget.value ? Number(e.currentTarget.value) : null)}
              />
            </label>
          </div>

          </div>
          <section class="qb-output" aria-label={t("qb.outputAria")}>
            <div class="ddl-header">
              <span>{t("qb.generatedSql")}</span>
              <span class="help">{t("qb.generatedHint")}</span>
            </div>
            <Show when={sql()} fallback={<pre class="ddl-text qb-preview">—</pre>}>
              <SqlHighlight class="ddl-text qb-preview" sql={sql()} engine={props.engine} label={t("qb.generatedSql")} />
            </Show>
            <div class="ddl-header">
              <span>{t("qb.preview")}</span>
              <span class="help">
                {previewing()
                  ? t("qb.previewing")
                  : preview()
                    ? `${countText("qb.previewRows", preview()!.rows.length)}${previewMs() !== null ? ` · ${previewMs()} ms` : ""} · ${t("qb.previewNote", { n: PREVIEW_ROWS })}`
                    : ""}
              </span>
            </div>
            <Show when={previewError()}>
              <div class="grid-error" role="alert">
                {previewError()}
              </div>
            </Show>
            <div class="qb-grid">
              <ResultGrid result={preview()} loading={previewing() && !preview()} error={null} />
            </div>
          </section>
          </div>
        </Show>
      </Show>
    </Panel>
  );
}
