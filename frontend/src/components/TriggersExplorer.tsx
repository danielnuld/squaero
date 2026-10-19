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
import { readDefinitionText, filterObjectRows, groupRows, rowMeta } from "../utils/treeObjects";
import { copyText } from "../utils/rowCopy";
import { Segmented } from "./Segmented";
import { EmptyNote } from "./EmptyNote";
import { runnableRoutineDdl } from "../utils/routineDdl";
import { ObjectIcon } from "./icons";
import { Panel } from "./Panel";
import { SqlHighlight } from "./SqlHighlight";
import { t } from "../utils/i18n";
import { countText } from "../utils/confirmText";

// Triggers / events explorer (issue #138): lists a database's triggers (and, on
// engines that have them, scheduled events) and shows each one's definition (DDL)
// — all via query.run over catalogs (utils/triggers.ts), no core/driver change.
// "Abrir en editor" opens the DDL in a new query tab so the user can edit/recreate
// it in the transactional session (honest to what each engine allows). Reloads on
// connection/engine/db/kind change; refresh is manual.
// P6: triggers are grouped by their table; the selected one gets a metadata
// header (table, timing, event, level, status as the catalog has them) and
// «Copiar definición»; «Eventos» stays visible but disabled, with the reason,
// on engines without scheduled events.
export function TriggersExplorer(props: {
  connId: string;
  engine: string;
  db?: string;
  onOpenSql: (sql: string, name?: string) => void;
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
  const [selectedRow, setSelectedRow] = createSignal<(string | null)[] | null>(null);
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

  // Shown in the form that can be run (issue #456), like a routine's or a view's:
  // the catalogs hand back a plain CREATE, which the engine refuses for an object
  // that already exists.
  const runnable = (ddl: string | null, name: string) =>
    ddl === null ? null : runnableRoutineDdl(props.engine, ddl, name);

  // Monotonic token so a slower earlier fetch can't overwrite a newer selection.
  let defToken = 0;

  const select = async (row: (string | null)[], ref: ObjectRef) => {
    setSelected(ref);
    setSelectedRow(row);
    setDefinition(null);
    // SQLite carries the DDL inline in the list row — no second query.
    const inlineCol = support().inlineDefCol;
    if (inlineCol) {
      const ci = colIndex(inlineCol);
      setDefinition(ci >= 0 ? runnable(row[ci] ?? "", ref.name) : "");
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
      setDefinition(runnable(
        readDefinitionText(res.columns.map((c) => c.name), res.rows, query.column, query.concatRows),
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
  const tableIdx = createMemo(() => colIndex(support().tableCol));
  /* Declared after both: an eagerly-run memo cannot read a const below it.
     The table counts as searchable because the row shows it — "which triggers
     does facturas have?" is what this explorer is for. */
  const rows = createMemo(() => filterObjectRows(allRows(), [nameIdx(), tableIdx()], search()));
  const filtering = () => rows().length !== allRows().length;
  const groups = createMemo(() => groupRows(rows(), kind() === "trigger" ? tableIdx() : -1));
  const meta = createMemo(() => {
    const row = selectedRow();
    return row ? rowMeta(list()?.columns ?? [], row, support().detailCols) : [];
  });

  const sameRef = (a: ObjectRef | null, b: ObjectRef) =>
    !!a && a.name === b.name && a.table === b.table && a.id === b.id;

  const emptyLabel = () =>
    filtering() || search().trim()
      ? t("explorer.noMatches")
      : kind() === "event"
        ? t("explorer.noEvents")
        : t("explorer.noTriggers");

  return (
    <Panel
      title={t("tool.triggers.label")}
      class="routine-explorer"
      onClose={props.onClose}
      actions={
        <Show when={objectsFor(props.engine, "trigger", props.db).supported}>
          <Segmented
            label={t("explorer.objectKind")}
            value={kind()}
            options={[
              { value: "trigger" as ObjectKind, label: t("explorer.triggersTab") },
              {
                value: "event" as ObjectKind,
                label: t("explorer.eventsTab"),
                disabled: !eventsSupported(),
                title: eventsSupported() ? undefined : unsupportedReason(props.engine, "event"),
              },
            ]}
            onChange={setKind}
          />
        </Show>
      }
      status={
        <Show when={support().supported}>
          {filtering()
            ? t("explorer.objectsFiltered", { n: rows().length, m: allRows().length })
            : countText(kind() === "event" ? "explorer.events" : "explorer.triggers", rows().length)}
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
        fallback={<EmptyNote title={t("explorer.triggersUnsupported")} text={unsupportedReason(props.engine, kind())} />}
      >
        <div class="routine-body">
          <div class="routine-list">
            <input
              class="panel-search"
              type="search"
              value={search()}
              placeholder={t("explorer.searchPlaceholderTable")}
              aria-label={t("explorer.searchAriaTable")}
              onInput={(e) => setSearch(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setSearch("");
              }}
            />
            <Show
              when={rows().length > 0}
              fallback={<p class="grid-empty">{loading() ? t("panel.loading") : emptyLabel()}</p>}
            >
              <ul>
                <For each={groups()}>
                  {(group) => (
                    <>
                      <Show when={group.key !== null}>
                        <li class="routine-group" role="presentation">
                          {group.key || t("explorer.noTable")}
                        </li>
                      </Show>
                <For each={group.rows}>
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
                              <ObjectIcon kind={kind()} size={14} />
                              <span class="routine-name">
                                {nameIdx() >= 0 ? row[nameIdx()] : r().name}
                                <Show when={r().table && group.key === null}>
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
                    </>
                  )}
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
                    <span class="routine-type">
                      {kind() === "event" ? "EVENT" : "TRIGGER"}
                    </span>
                    <Show when={definition()}>
                      <button
                        class="edit-btn edit-btn-primary"
                        title={t("explorer.openInEditorTitle")}
                        onClick={() => props.onOpenSql(definition()!, ref().name)}
                      >
                        {t("explorer.openInEditor")}
                      </button>
                      <button class="edit-btn" onClick={() => copyText(definition()!)}>
                        {t("explorer.copyDef")}
                      </button>
                    </Show>
                  </div>
                  <Show when={meta().length > 0}>
                    <dl class="routine-meta">
                      <For each={meta()}>
                        {(m) => (
                          <div>
                            <dt>{t(m.label)}</dt>
                            <dd>{m.value}</dd>
                          </div>
                        )}
                      </For>
                    </dl>
                  </Show>
                  <Show
                    when={!defLoading()}
                    fallback={<p class="grid-empty">{t("explorer.loadingDef")}</p>}
                  >
                    <Show
                      when={definition()}
                      fallback={<p class="grid-empty">{t("explorer.noDef")}</p>}
                    >
                      <SqlHighlight class="routine-ddl" sql={definition()!} engine={props.engine} label={t("explorer.defAria", { name: ref().name })} />
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
