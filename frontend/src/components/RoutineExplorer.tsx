import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { runQuery, type ResultSet } from "../utils/query";
import { errorText } from "../utils/errors";
import {
  routinesFor,
  definitionFor,
  unsupportedReason,
  type RoutineRef,
  type RoutineType,
} from "../utils/routines";
import { readDefinitionText, filterObjectRows } from "../utils/treeObjects";
import { runnableRoutineDdl } from "../utils/routineDdl";
import { objectBadge, routineKind } from "../utils/objectIcons";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";

// Stored procedures / functions explorer (issue #137): lists the routines of the
// active database and shows each one's definition (DDL) — all via query.run using
// the per-engine catalog SQL from utils/routines.ts, no core/driver change. The
// definition can be opened in a new SQL editor tab. Refresh is manual so the panel
// never polls the server on its own (same discipline as the server monitor).
export function RoutineExplorer(props: {
  connId: string;
  engine: string;
  db?: string;
  onOpenSql: (sql: string, name?: string) => void;
  onClose: () => void;
}) {
  const support = createMemo(() => routinesFor(props.engine, props.db));
  const [list, setList] = createSignal<ResultSet | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<RoutineRef | null>(null);
  const [search, setSearch] = createSignal("");
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
    // Capture the context this load is for; ignore its result if the connection
    // or working database changed while the query was in flight (superseded).
    const connId = props.connId;
    const db = props.db;
    setLoading(true);
    setError(null);
    setSelected(null);
    setDefinition(null);
    setList(null); // drop the previous context's rows while the reload is in flight
    try {
      const res = await runQuery(connId, s.listSql);
      if (props.connId !== connId || props.db !== db) return; // superseded
      setList(res);
    } catch (err) {
      if (props.connId !== connId || props.db !== db) return;
      setError(errorText(err));
    } finally {
      if (props.connId === connId && props.db === db) setLoading(false);
    }
  };

  // (Re)load the routine list whenever the connection, engine or working
  // database changes — this tool lives as a persistent tab, so those props can
  // change under it via the sidebar without it being remounted.
  createEffect(() => {
    void props.connId;
    void props.engine;
    void props.db;
    void load();
  });

  const routineFromRow = (row: (string | null)[]): RoutineRef | null => {
    const s = support();
    const ni = colIndex(s.nameCol);
    if (ni < 0) return null;
    const name = row[ni];
    if (!name) return null;
    const ti = colIndex(s.typeCol);
    const upper = ((ti >= 0 ? row[ti] : "") ?? "").toUpperCase();
    const type: RoutineType = upper.includes("PROCEDURE")
      ? "PROCEDURE"
      : upper.includes("AGGREGATE")
        ? "AGGREGATE"
        : upper.includes("WINDOW")
          ? "WINDOW"
          : "FUNCTION";
    const si = colIndex(s.schemaCol);
    const schema = si >= 0 ? (row[si] ?? undefined) : undefined;
    const ii = colIndex(s.idCol);
    const id = ii >= 0 ? (row[ii] ?? undefined) : undefined;
    return { name, type, schema, id };
  };

  const runnable = (ddl: string | null, name: string) =>
    ddl === null ? null : runnableRoutineDdl(props.engine, ddl, name);

  // Monotonic token so a slower earlier definition fetch can't overwrite the
  // result of a later selection (select A, then B, before A resolves).
  let defToken = 0;

  const select = async (ref: RoutineRef) => {
    setSelected(ref);
    setDefinition(null);
    const q = definitionFor(props.engine, ref);
    if (!q) return;
    const token = ++defToken;
    const connId = props.connId;
    setDefLoading(true);
    setError(null);
    try {
      const res = await runQuery(connId, q.sql);
      if (token !== defToken || props.connId !== connId) return; // superseded
      // Shown in the form that can be run (issue #456): what the catalog returns
      // is a plain CREATE, and the panel's one offer is to open it in the editor.
      setDefinition(runnable(
        readDefinitionText(res.columns.map((c) => c.name), res.rows, q.column, q.concatRows),
        ref.name,
      ));
    } catch (err) {
      if (token !== defToken || props.connId !== connId) return;
      setError(errorText(err));
    } finally {
      if (token === defToken) setDefLoading(false);
    }
  };

  const allRows = () => list()?.rows ?? [];
  const nameIdx = createMemo(() => colIndex(support().nameCol));
  /* Declared after nameIdx: an eagerly-run memo cannot read a const below it. */
  const rows = createMemo(() => filterObjectRows(allRows(), [nameIdx()], search()));
  const filtering = () => rows().length !== allRows().length;

  const sameRef = (a: RoutineRef | null, b: RoutineRef) =>
    !!a &&
    a.name === b.name &&
    a.type === b.type &&
    a.schema === b.schema &&
    a.id === b.id;

  return (
    <Panel
      title={t("tool.routines.label")}
      class="routine-explorer"
      onClose={props.onClose}
      status={
        <Show when={support().supported}>
          {filtering()
            ? t("explorer.objectsFiltered", { n: rows().length, m: allRows().length })
            : t("explorer.objects", { n: rows().length })}
        </Show>
      }
      onRefresh={support().supported ? load : undefined}
      refreshing={loading()}
    >
      <Show when={error()}>
        <div class="grid-error" role="alert">
          {error()}
        </div>
      </Show>

      <Show
        when={support().supported}
        fallback={<p class="grid-empty">{unsupportedReason(props.engine)}</p>}
      >
        <div class="routine-body">
          <div class="routine-list">
            <input
              class="panel-search"
              type="search"
              value={search()}
              placeholder={t("explorer.searchPlaceholder")}
              aria-label={t("explorer.searchAria")}
              onInput={(e) => setSearch(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearch("");
              }}
            />
            <Show
              when={rows().length > 0}
              fallback={
                <p class="grid-empty">
                  {loading()
                    ? t("panel.loading")
                    : filtering() || search().trim()
                      ? t("explorer.noMatches")
                      : t("explorer.noRoutines")}
                </p>
              }
            >
              <ul>
                <For each={rows()}>
                  {(row) => {
                    const ref = routineFromRow(row);
                    return (
                      <Show when={ref}>
                        {(r) => (
                          <li>
                            <button
                              class={`routine-item ${sameRef(selected(), r()) ? "active" : ""}`}
                              onClick={() => select(r())}
                            >
                              <span
                                class={`objtree-badge ${objectBadge(routineKind(r().type)).className}`}
                              >
                                {objectBadge(routineKind(r().type)).text}
                              </span>
                              <span class="routine-name">
                                {nameIdx() >= 0 ? row[nameIdx()] : r().name}
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
              fallback={<p class="grid-empty">{t("explorer.selectHint")}</p>}
            >
              {(ref) => (
                <>
                  <div class="routine-detail-head">
                    <strong>{ref().name}</strong>
                    <span class="routine-type">{ref().type}</span>
                    <Show when={definition()}>
                      <button
                        class="edit-btn"
                        title={t("explorer.openInEditorTitle")}
                        onClick={() => props.onOpenSql(definition()!, ref().name)}
                      >
                        {t("explorer.openInEditor")}
                      </button>
                    </Show>
                  </div>
                  <Show
                    when={!defLoading()}
                    fallback={<p class="grid-empty">{t("explorer.loadingDef")}</p>}
                  >
                    <Show
                      when={definition()}
                      fallback={<p class="grid-empty">{t("explorer.noDef")}</p>}
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
