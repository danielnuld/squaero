import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { runQuery, type ResultSet } from "../utils/query";
import { errorText } from "../utils/errors";
import {
  objectsFor,
  definitionFor,
  unsupportedReason,
  type ObjectKind,
  type ObjectRef,
} from "../utils/triggers";
import { readDefinitionText } from "../utils/treeObjects";
import { Panel } from "./Panel";

// Triggers / events explorer (issue #138): lists a database's triggers (and, on
// engines that have them, scheduled events) and shows each one's definition (DDL)
// — all via query.run over catalogs (utils/triggers.ts), no core/driver change.
// "Abrir en editor" opens the DDL in a new query tab so the user can edit/recreate
// it in the transactional session (honest to what each engine allows). Reloads on
// connection/engine/db/kind change; refresh is manual.
export function TriggersExplorer(props: {
  connId: string;
  engine: string;
  db?: string;
  onOpenSql: (sql: string) => void;
  onClose: () => void;
}) {
  const [kind, setKind] = createSignal<ObjectKind>("trigger");
  const support = createMemo(() => objectsFor(props.engine, kind(), props.db));
  const eventsSupported = createMemo(() => objectsFor(props.engine, "event", props.db).supported);

  // If the current engine/db stops supporting events while the "Eventos" view is
  // active, the toggle hides — fall back to "Triggers" so the user isn't stranded
  // on the unsupported fallback with no visible control to switch back.
  createEffect(() => {
    if (kind() === "event" && !eventsSupported()) setKind("trigger");
  });

  const [list, setList] = createSignal<ResultSet | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<ObjectRef | null>(null);
  const [definition, setDefinition] = createSignal<string | null>(null);
  const [defLoading, setDefLoading] = createSignal(false);

  const colIndex = (name: string | null) => {
    if (!name) return -1;
    return (list()?.columns ?? []).findIndex(
      (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
  };

  const load = async () => {
    const s = support();
    if (!s.supported || !s.listSql) return;
    const connId = props.connId;
    const db = props.db;
    const k = kind();
    setLoading(true);
    setError(null);
    setSelected(null);
    setDefinition(null);
    setList(null);
    try {
      const res = await runQuery(connId, s.listSql);
      if (props.connId !== connId || props.db !== db || kind() !== k) return; // superseded
      setList(res);
    } catch (err) {
      if (props.connId !== connId || props.db !== db || kind() !== k) return;
      setError(errorText(err));
    } finally {
      if (props.connId === connId && props.db === db && kind() === k) setLoading(false);
    }
  };

  // (Re)load whenever the connection, engine, working database or object kind
  // changes — the tool lives as a persistent tab, so these props/state can change
  // under it without a remount.
  createEffect(() => {
    void props.connId;
    void props.engine;
    void props.db;
    void kind();
    void load();
  });

  const refFromRow = (row: (string | null)[]): ObjectRef | null => {
    const s = support();
    const ni = colIndex(s.nameCol);
    if (ni < 0) return null;
    const name = row[ni];
    if (!name) return null;
    const ti = colIndex(s.tableCol);
    const table = ti >= 0 ? (row[ti] ?? undefined) : undefined;
    const ii = colIndex(s.idCol);
    const id = ii >= 0 ? (row[ii] ?? undefined) : undefined;
    return { name, table, id };
  };

  // Monotonic token so a slower earlier fetch can't overwrite a newer selection.
  let defToken = 0;

  const select = async (row: (string | null)[], ref: ObjectRef) => {
    setSelected(ref);
    setDefinition(null);
    // SQLite carries the DDL inline in the list row — no second query.
    const inlineCol = support().inlineDefCol;
    if (inlineCol) {
      const ci = colIndex(inlineCol);
      setDefinition(ci >= 0 ? (row[ci] ?? "") : "");
      return;
    }
    const query = definitionFor(props.engine, kind(), ref);
    if (!query) return;
    const token = ++defToken;
    const connId = props.connId;
    setDefLoading(true);
    setError(null);
    try {
      const res = await runQuery(connId, query.sql);
      if (token !== defToken || props.connId !== connId) return; // superseded
      setDefinition(
        readDefinitionText(res.columns.map((c) => c.name), res.rows, query.column, query.concatRows),
      );
    } catch (err) {
      if (token !== defToken || props.connId !== connId) return;
      setError(errorText(err));
    } finally {
      if (token === defToken) setDefLoading(false);
    }
  };

  const rows = () => list()?.rows ?? [];
  const nameIdx = createMemo(() => colIndex(support().nameCol));

  const sameRef = (a: ObjectRef | null, b: ObjectRef) =>
    !!a && a.name === b.name && a.table === b.table && a.id === b.id;

  const emptyLabel = () =>
    kind() === "event" ? "No hay eventos programados." : "No hay triggers.";

  return (
    <Panel title="Triggers y eventos" class="routine-explorer" onClose={props.onClose}>
      <div class="sm-head">
        <h2>Triggers y eventos</h2>
        <div class="sm-actions">
          <Show when={eventsSupported()}>
            <div class="obj-kind-toggle" role="tablist">
              <button
                class={`edit-btn ${kind() === "trigger" ? "active" : ""}`}
                role="tab"
                aria-selected={kind() === "trigger"}
                onClick={() => setKind("trigger")}
              >
                Triggers
              </button>
              <button
                class={`edit-btn ${kind() === "event" ? "active" : ""}`}
                role="tab"
                aria-selected={kind() === "event"}
                onClick={() => setKind("event")}
              >
                Eventos
              </button>
            </div>
          </Show>
          <Show when={support().supported}>
            <span class="sm-count">{rows().length} objeto(s)</span>
            <button class="edit-btn" disabled={loading()} onClick={load}>
              {loading() ? "Actualizando…" : "⟳ Refrescar"}
            </button>
          </Show>
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

      <Show
        when={support().supported}
        fallback={<p class="grid-empty">{unsupportedReason(props.engine, kind())}</p>}
      >
        <div class="routine-body">
          <div class="routine-list">
            <Show
              when={rows().length > 0}
              fallback={<p class="grid-empty">{loading() ? "Cargando…" : emptyLabel()}</p>}
            >
              <ul>
                <For each={rows()}>
                  {(row) => {
                    const ref = refFromRow(row);
                    return (
                      <Show when={ref}>
                        {(r) => (
                          <li>
                            <button
                              class={`routine-item ${sameRef(selected(), r()) ? "active" : ""}`}
                              onClick={() => select(row, r())}
                            >
                              <span class="routine-badge">
                                {kind() === "event" ? "⏱" : "⚡"}
                              </span>
                              <span class="routine-name">
                                {nameIdx() >= 0 ? row[nameIdx()] : r().name}
                                <Show when={r().table}>
                                  <span class="routine-sub"> · {r().table}</span>
                                </Show>
                              </span>
                            </button>
                          </li>
                        )}
                      </Show>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </div>

          <div class="routine-detail">
            <Show
              when={selected()}
              fallback={<p class="grid-empty">Selecciona un objeto para ver su definición.</p>}
            >
              {(ref) => (
                <>
                  <div class="routine-detail-head">
                    <strong>{ref().name}</strong>
                    <span class="routine-type">
                      {kind() === "event" ? "EVENT" : "TRIGGER"}
                    </span>
                    <Show when={definition()}>
                      <button
                        class="edit-btn"
                        title="Abrir la definición en una nueva consulta para editar/recrear"
                        onClick={() => props.onOpenSql(definition()!)}
                      >
                        Abrir en editor
                      </button>
                    </Show>
                  </div>
                  <Show
                    when={!defLoading()}
                    fallback={<p class="grid-empty">Cargando definición…</p>}
                  >
                    <Show
                      when={definition()}
                      fallback={<p class="grid-empty">Sin definición disponible.</p>}
                    >
                      <pre class="routine-ddl">{definition()}</pre>
                    </Show>
                  </Show>
                </>
              )}
            </Show>
          </div>
        </div>
      </Show>
    </Panel>
  );
}
