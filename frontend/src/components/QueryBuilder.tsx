import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { Panel } from "./Panel";
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

interface TableRef {
  table: string;
  container?: string;
}

const MAX_TABLES = 200;
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
export function QueryBuilder(props: {
  connId: string;
  engine: string;
  db?: string;
  onRun: (sql: string) => void;
  onClose: () => void;
}) {
  const [tables, setTables] = createSignal<TableRef[]>([]);
  const [loading, setLoading] = createSignal(true);
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
    <Panel title="Constructor de consultas" class="qb" onClose={props.onClose}>
      <div class="sm-head">
        <h2>Constructor de consultas</h2>
        <div class="sm-actions">
          <button class="edit-btn" onClick={props.onClose}>
            Cerrar
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="grid-error" role="alert">
          {error()}
        </div>
      </Show>

      <Show when={!loading()} fallback={<p class="grid-empty">Cargando tablas…</p>}>
        <Show
          when={tables().length > 0}
          fallback={<p class="grid-empty">No hay tablas en esta conexión.</p>}
        >
          <label class="field">
            <span>Tabla</span>
            <select
              class="map-select"
              value={tableKey()}
              onChange={(e) => void selectTable(e.currentTarget.value)}
            >
              <For each={tables()}>
                {(t) => (
                  <option value={keyOf(t)}>
                    {t.container ? `${t.container}.${t.table}` : t.table}
                  </option>
                )}
              </For>
            </select>
          </label>

          <div class="qb-section">
            <div class="import-subtitle">Columnas (vacío = todas)</div>
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
              Condiciones
              <select
                class="map-select qb-conj"
                value={conjunction()}
                onChange={(e) => setConjunction(e.currentTarget.value as "AND" | "OR")}
              >
                <option value="AND">Y (AND)</option>
                <option value="OR">O (OR)</option>
              </select>
            </div>
            <For each={conds}>
              {(c, i) => (
                <div class="qb-cond">
                  <select
                    class="map-select"
                    value={c.column}
                    onChange={(e) => patchCond(i(), "column", e.currentTarget.value)}
                  >
                    <option value="">— columna —</option>
                    <For each={columns()}>{(col) => <option value={col}>{col}</option>}</For>
                  </select>
                  <select
                    class="map-select"
                    value={c.op}
                    onChange={(e) => patchCond(i(), "op", e.currentTarget.value as Operator)}
                  >
                    <For each={OPERATORS}>{(op) => <option value={op}>{op}</option>}</For>
                  </select>
                  <input
                    class="td-in"
                    placeholder={c.op === "IN" ? "a, b, c" : "valor"}
                    disabled={isNullaryOp(c.op)}
                    value={c.value}
                    onInput={(e) => patchCond(i(), "value", e.currentTarget.value)}
                  />
                  <button class="grid-action danger" title="Quitar condición" onClick={() => removeCond(i())}>
                    ✕
                  </button>
                </div>
              )}
            </For>
            <button class="edit-btn" onClick={addCond}>
              ＋ Condición
            </button>
          </div>

          <div class="qb-section qb-order">
            <label class="field">
              <span>Ordenar por</span>
              <select class="map-select" value={orderCol()} onChange={(e) => setOrderCol(e.currentTarget.value)}>
                <option value="">—</option>
                <For each={columns()}>{(c) => <option value={c}>{c}</option>}</For>
              </select>
            </label>
            <Show when={orderCol()}>
              <select class="map-select" value={orderDir()} onChange={(e) => setOrderDir(e.currentTarget.value as "ASC" | "DESC")}>
                <option value="ASC">Ascendente</option>
                <option value="DESC">Descendente</option>
              </select>
            </Show>
            <label class="field">
              <span>Límite</span>
              <input
                class="td-in dg-num"
                type="number"
                min="1"
                value={limit() ?? ""}
                onInput={(e) => setLimit(e.currentTarget.value ? Number(e.currentTarget.value) : null)}
              />
            </label>
          </div>

          <div class="ddl-header" style={{ "margin-top": "0.6rem" }}>
            <span>SQL generado</span>
          </div>
          <pre class="ddl-text qb-preview">{sql() || "—"}</pre>

          <div class="modal-actions">
            <button onClick={() => copyText(sql())} disabled={!sql()}>
              Copiar
            </button>
            <span class="status-spacer" />
            <button class="primary" disabled={!sql()} onClick={() => props.onRun(sql())}>
              Ejecutar
            </button>
          </div>
        </Show>
      </Show>
    </Panel>
  );
}
