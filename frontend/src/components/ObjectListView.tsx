import { For, Show, createMemo, createSignal, createEffect } from "solid-js";
import { runQuery, type ResultSet } from "../utils/query";
import { errorText } from "../utils/errors";
import {
  objectListFor,
  formatBytes,
  listedObjects,
  listedTriggers,
  filterObjects,
  objectCounts,
  type ListedKind,
  type ListedObject,
} from "../utils/objectList";
import { objectsFor, definitionFor } from "../utils/triggers";
import { readDefinitionText } from "../utils/treeObjects";
import { stepIndex } from "../utils/listNav";
import { openContextMenu } from "../utils/contextMenu";
import { Icon, ObjectIcon } from "./icons";
import { Panel } from "./Panel";
import { t, tn } from "../utils/i18n";

// Object-list view (UI design proposal, phase 3): opening a database shows its
// objects as a metadata grid (name, type, and per-engine row/column/index count,
// size and comment) the way a desktop database tool does, with its toolbar
// (Nueva tabla, type tabs with Triggers, a name filter, Refrescar, Más) and a
// footer that counts what is listed. Intro or a double click opens the data
// (a trigger's definition), F12 the structure. All via query.run over the
// per-engine SQL from utils/objectList.ts and utils/triggers.ts.
export function ObjectListView(props: {
  connId: string;
  engine: string;
  db: string;
  onOpenData: (name: string, type: string) => void;
  /** F12: the object's structure. Absent → not offered. */
  onOpenStructure?: (name: string, type: string) => void;
  /** «Nueva tabla» in this database. Absent → no button. */
  onNewTable?: () => void;
  /** Opens SQL in a new editor tab without running it (a trigger's definition). */
  onOpenSql?: (sql: string) => void;
  onClose: () => void;
}) {
  const support = createMemo(() => objectListFor(props.engine, props.db));
  const trgSupport = createMemo(() => objectsFor(props.engine, "trigger", props.db));
  const [result, setResult] = createSignal<ResultSet | null>(null);
  const [triggers, setTriggers] = createSignal<ListedObject[]>([]);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [filter, setFilter] = createSignal<ListedKind | "all">("all");
  const [text, setText] = createSignal("");
  const [sel, setSel] = createSignal(0);
  const [reload, setReload] = createSignal(0);
  let body: HTMLTableSectionElement | undefined;

  // Reload whenever the connection/engine/db changes. Monotonic token guards
  // against a slow earlier query overwriting a newer one; clear before awaiting
  // so a stale result never bleeds across connections.
  let token = 0;
  createEffect(() => {
    const s = support();
    const trg = trgSupport();
    const connId = props.connId;
    void props.db;
    void reload();
    const my = ++token;
    setResult(null);
    setTriggers([]);
    setError(null);
    if (!s.supported || !s.sql) return;
    setLoading(true);
    // The triggers have their own listing; one that fails leaves them out, it
    // does not take the tables down with it.
    const trgLoad = trg.supported && trg.listSql
      ? runQuery(connId, trg.listSql)
          .then((r) => (my === token ? setTriggers(listedTriggers(r.columns, r.rows, trg)) : undefined))
          .catch(() => {})
      : Promise.resolve();
    Promise.all([
      runQuery(connId, s.sql).then((r) => {
        if (my === token) setResult(r);
      }),
      trgLoad,
    ])
      .catch((err) => {
        if (my === token) setError(errorText(err));
      })
      .finally(() => {
        if (my === token) setLoading(false);
      });
  });

  const all = createMemo<ListedObject[]>(() => {
    const r = result();
    const objs = r ? listedObjects(r.columns, r.rows, support()) : [];
    return [...objs, ...triggers()];
  });
  const view = createMemo(() => filterObjects(all(), filter(), text()));
  const counts = createMemo(() => objectCounts(all()));
  const shownCounts = createMemo(() => objectCounts(view()));

  const colIndex = (key: string) =>
    (result()?.columns ?? []).findIndex((c) => c.name.toLowerCase() === key);
  const cell = (o: ListedObject, key: string) => {
    const ci = colIndex(key);
    const raw = ci >= 0 ? (o.row[ci] ?? null) : null;
    if (key === "tamano") return formatBytes(raw);
    return raw === null ? "" : String(raw);
  };

  const openTrigger = async (o: ListedObject) => {
    const q = definitionFor(props.engine, "trigger", { name: o.name, table: o.on });
    if (!q || !props.onOpenSql) return;
    try {
      const r = await runQuery(props.connId, q.sql);
      props.onOpenSql(readDefinitionText(r.columns.map((c) => c.name), r.rows, q.column, q.concatRows));
    } catch (err) {
      setError(errorText(err));
    }
  };
  const open = (o: ListedObject) => (o.kind === "trigger" ? void openTrigger(o) : props.onOpenData(o.name, o.kind));
  const openStructure = (o: ListedObject) => {
    if (o.kind !== "trigger") props.onOpenStructure?.(o.name, o.kind);
  };
  const selected = () => view()[sel()];

  const focusRow = (i: number) => {
    setSel(i);
    (body?.querySelectorAll<HTMLElement>("tr")[i])?.focus();
  };
  const onKey = (e: KeyboardEvent) => {
    const o = selected();
    if (e.key === "Enter" && o) {
      e.preventDefault();
      open(o);
    } else if (e.key === "F12" && o) {
      e.preventDefault();
      openStructure(o);
    } else {
      const next = stepIndex(view().length, sel(), e.key);
      if (next !== sel() && next >= 0) {
        e.preventDefault();
        focusRow(next);
      }
    }
  };

  const moreMenu = (e: MouseEvent) => {
    const o = selected();
    openContextMenu(e, [
      { label: t("objlist.openData"), action: () => o && open(o), disabled: !o },
      {
        label: t("objlist.openStructure"),
        action: () => o && openStructure(o),
        disabled: !o || o.kind === "trigger" || !props.onOpenStructure,
      },
      { label: t("objlist.copyName"), action: () => o && void navigator.clipboard?.writeText(o.name), disabled: !o },
    ]);
  };

  const TABS: { id: ListedKind | "all"; label: string; mark?: string }[] = [
    { id: "all", label: "objlist.all" },
    { id: "table", label: "tree.tables", mark: "var(--obj-table)" },
    { id: "view", label: "tree.views", mark: "var(--obj-view)" },
    { id: "trigger", label: "objlist.triggers", mark: "var(--obj-trigger)" },
  ];

  const footer = () => {
    const c = shownCounts();
    const parts = [tn("objlist.nObjects", c.all), tn("objlist.nTables", c.table), tn("objlist.nViews", c.view)];
    if (trgSupport().supported) parts.push(tn("objlist.nTriggers", c.trigger));
    return parts.join(" · ");
  };

  return (
    <Panel
      title={t("tab.objectList", { db: props.db })}
      onClose={props.onClose}
      class="objlist"
      onRefresh={support().supported ? () => setReload((n) => n + 1) : undefined}
      refreshing={loading()}
      actions={
        <Show when={support().supported}>
          <Show when={props.onNewTable}>
            <button class="edit-btn" onClick={() => props.onNewTable!()}>
              <Icon name="plus" size={14} class="eb-ic" /> {t("objlist.newTable")}
            </button>
            <span class="toolbar-sep" aria-hidden="true" />
          </Show>
          <div class="objlist-tabs" role="tablist" aria-label={t("objlist.typeAria")}>
            <For each={TABS.filter((tab) => tab.id !== "trigger" || trgSupport().supported)}>
              {(tab) => (
                <button
                  class={`otab ${filter() === tab.id ? "on" : ""}`}
                  role="tab"
                  aria-selected={filter() === tab.id}
                  onClick={() => {
                    setFilter(tab.id);
                    setSel(0);
                  }}
                >
                  <Show when={tab.mark}>
                    <span class="otab-mk" style={{ background: tab.mark }} aria-hidden="true" />
                  </Show>
                  {t(tab.label)} <span class="otab-ct">{counts()[tab.id]}</span>
                </button>
              )}
            </For>
          </div>
          <input
            class="objlist-filter"
            type="search"
            placeholder={t("objlist.filter")}
            aria-label={t("objlist.filter")}
            value={text()}
            onInput={(e) => {
              setText(e.currentTarget.value);
              setSel(0);
            }}
          />
        </Show>
      }
      status={
        <Show when={support().supported}>
          <button
            class="edit-btn edit-btn-icon"
            aria-haspopup="menu"
            aria-label={t("objlist.more")}
            title={t("objlist.more")}
            onClick={moreMenu}
          >
            <Icon name="more" size={14} />
          </button>
        </Show>
      }
    >
      <Show
        when={support().supported}
        fallback={<p class="objlist-empty">{t(support().reason ?? "")}</p>}
      >
        <Show when={error()}>
          <p class="objlist-error">{error()}</p>
        </Show>
        <Show when={loading()}>
          <p class="objlist-empty">{t("objlist.loading")}</p>
        </Show>

        <Show when={result() && !loading()}>
          <div class="objlist-scroll">
            {/* ponytail: every row is rendered; a database with tens of
                thousands of objects wants the grid's virtual window here. */}
            <table class="objlist-grid" aria-label={t("objlist.gridAria", { db: props.db })}>
              <thead>
                <tr>
                  <For each={support().columns}>
                    {(c) => (
                      <th scope="col" class={c.numeric ? "num" : ""}>{t(c.label)}</th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody ref={body} onKeyDown={onKey}>
                <For
                  each={view()}
                  fallback={
                    <tr>
                      <td colspan={support().columns.length} class="objlist-empty">
                        {t("tree.noObjects")}
                      </td>
                    </tr>
                  }
                >
                  {(o, i) => (
                    <tr
                      class="objlist-row"
                      classList={{ sel: i() === sel() }}
                      tabindex={i() === sel() ? 0 : -1}
                      aria-selected={i() === sel()}
                      onClick={() => setSel(i())}
                      onDblClick={() => open(o)}
                      title={o.kind === "trigger" ? t("objlist.openTriggerTitle") : t("objlist.dblClickOpen")}
                    >
                      <For each={support().columns}>
                        {(c, ci) => (
                          <td class={c.numeric ? "num" : ""}>
                            <Show
                              when={ci() === 0}
                              fallback={
                                ci() === 1
                                  ? // MongoDB's own types (collection, timeseries) say more than «Tabla».
                                    o.kind !== "trigger" && support().typeKey
                                    ? cell(o, c.key)
                                    : t(`objlist.kind.${o.kind}`)
                                  : o.kind === "trigger"
                                    ? ""
                                    : cell(o, c.key)
                              }
                            >
                              <span class="objlist-name">
                                <ObjectIcon kind={o.kind} size={14} />
                                {o.name}
                                <Show when={o.on}>
                                  <span class="objlist-on">{t("objlist.on", { table: o.on! })}</span>
                                </Show>
                              </span>
                            </Show>
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>
          <div class="objlist-foot">
            <span>{footer()}</span>
            <span class="panel-bar-spacer" />
            <span class="objlist-hint">{t("objlist.keysHint")}</span>
          </div>
        </Show>
      </Show>
    </Panel>
  );
}
