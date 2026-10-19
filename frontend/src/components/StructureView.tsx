import { For, Show, createSignal, onMount, type JSX } from "solid-js";
import { ObjectViewSwitch, type ObjectView } from "./ObjectToolbar";
import { withWriteConsent } from "../utils/transport";
import { schemaDescribe, schemaDdl, qualifiedName } from "../utils/schema";
import { runQuery, type ResultSet } from "../utils/query";
import { txBegin, txCommit, txRollback } from "../utils/edit";
import { buildViewApply, runnableViewDdl } from "../utils/viewEdit";
import { formatSql } from "../utils/sqlFormat";
import { errorText } from "../utils/errors";
import { indexListFor } from "../utils/indexes";
import { foreignKeysFor, groupForeignKeys, parseForeignKeys, type ForeignKeyRelation } from "../utils/foreignKeys";
import { objectsFor } from "../utils/triggers";
import { rowCountSql, parseRowCounts } from "../utils/rowCounts";
import { engineFamily } from "../utils/engineFamily";
import { saveText, sqlFileName } from "../utils/download";
import { openContextMenu, type MenuItem } from "../utils/contextMenu";
import {
  columnKeys,
  structColumns,
  structIndexes,
  triggersOn,
  type KeyNote,
  type StructIndex,
  type StructTrigger,
} from "../utils/structure";
import { Panel } from "./Panel";
import { SqlHighlight } from "./SqlHighlight";
import { Icon } from "./icons";
import type { TreeNodeKind } from "../utils/tree";
import { t } from "../utils/i18n";
import { countText } from "../utils/confirmText";
import { currentOs, orderActions } from "../utils/dialog";

// Panel showing a table/view structure (audit A-28): a summary line, then
// folding sections — Columnas with readable headers and the keys each column
// takes part in, Índices, Claves foráneas, Referenciada por and Triggers — and
// the engine's CREATE statement as the second face (DDL), highlighted, with
// Copiar / Abrir en el editor / Guardar .sql. Each section loads on its own and
// says so when the engine cannot answer it, rather than one failing catalog
// hiding the rest. For a view the definition can be edited and applied (#108):
// CREATE OR REPLACE where supported, else DROP + CREATE, inside a transaction.
//
// The two faces are SECTIONS, not a stack (issue #408). A view opens on its
// definition, since that is what a view is; a table opens on its columns.

/** A section's answer: still loading, the data, unsupported here, or failed. */
type Part<T> =
  | { s: "loading" }
  | { s: "ok"; data: T }
  | { s: "na"; reason: string }
  | { s: "error"; error: string };

export function StructureView(props: {
  connId: string;
  table: string;
  db?: string;
  schema?: string;
  /** Object kind, as the tree spells it; only a view can have its definition
      edited, and every other kind simply is not one. */
  kind?: TreeNodeKind;
  /** Active engine name, selects how the edited view is applied. */
  engine?: string;
  onClose: () => void;
  /** Called after a successful view apply, so the tree/data can refresh. */
  onApplied?: () => void;
  /** The section to open on; absent → a view's definition, else its columns. */
  initialSection?: "structure" | "definition";
  /**
   * Datos · Estructura · Índices · DDL (issue #688). Given, the panel shows the
   * shared object switch instead of its own two-way toggle, and hands the
   * views it does not hold (data, indexes) to this.
   */
  onView?: (view: ObjectView) => void;
  /** «Modificar tabla»: the table designer on this table. Absent → no button. */
  onModify?: () => void;
  /** Opens SQL in a new editor tab without running it. */
  onOpenSql?: (sql: string) => void;
  /** Opens another object of the same container (a referenced table). */
  onOpenObject?: (name: string) => void;
}) {
  const [columns, setColumns] = createSignal<ResultSet | null>(null);
  const [ddl, setDdl] = createSignal("");
  const [error, setError] = createSignal<string | null>(null);
  const [ddlError, setDdlError] = createSignal<string | null>(null);
  const [copied, setCopied] = createSignal(false);
  const [indexes, setIndexes] = createSignal<Part<StructIndex[]>>({ s: "loading" });
  const [outbound, setOutbound] = createSignal<Part<ForeignKeyRelation[]>>({ s: "loading" });
  const [inbound, setInbound] = createSignal<Part<ForeignKeyRelation[]>>({ s: "loading" });
  const [triggers, setTriggers] = createSignal<Part<StructTrigger[]>>({ s: "loading" });
  const [rowCount, setRowCount] = createSignal<number | null>(null);
  const [loading, setLoading] = createSignal(0);

  // View-editing state (issue #108).
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal("");
  const [busy, setBusy] = createSignal(false);
  const [applyError, setApplyError] = createSignal<string | null>(null);
  const [applied, setApplied] = createSignal(false);

  const isView = () => props.kind === "view";
  const engine = () => props.engine ?? "";
  // The catalog scope the FK and trigger listings take: the schema where there
  // are schemas (PostgreSQL), else the database.
  const scope = () => props.schema ?? props.db;

  // Which section is on screen. A view lands on its definition: the columns of
  // a view are derived from it, and reaching the query was the whole complaint.
  const [section, setSection] = createSignal<"structure" | "definition">(
    props.initialSection ?? (props.kind === "view" ? "definition" : "structure"),
  );
  const pickView = (view: ObjectView) => {
    if (view === "ddl") setSection("definition");
    // Leaving mid-edit would drop the draft silently.
    else if (view === "structure") !editing() && setSection("structure");
    else props.onView?.(view);
  };
  const defLabel = () => (isView() ? t("struct.definition") : t("struct.ddl"));

  const loadDdl = async () => {
    const raw = await schemaDdl(props.connId, props.table, props.db, props.schema);
    // A view is shown in the form that can actually be run (issue #454): what
    // the engine returns is a plain CREATE, and running it against the view that
    // already exists answers "1050 already exists". A table's DDL is left as it
    // came — it is there to be read, not re-executed.
    const sql = isView() ? runnableViewDdl(engine(), raw, fallbackName()) : raw;
    setDdl(sql);
    return sql;
  };

  /** Runs one load, counted so the bar's refresh shows while any is out. */
  const track = async (job: () => Promise<void>) => {
    setLoading((n) => n + 1);
    try {
      await job();
    } finally {
      setLoading((n) => n - 1);
    }
  };
  /** Fills a section from a catalog query, or marks it unsupported/failed. */
  const fill = <T,>(set: (p: Part<T>) => void, sql: string | null, reason: string | null, read: (rs: ResultSet) => T | null) =>
    track(async () => {
      set({ s: "loading" });
      if (!sql) {
        set({ s: "na", reason: reason ?? t("struct.na") });
        return;
      }
      try {
        const data = read(await runQuery(props.connId, sql));
        set(data === null ? { s: "na", reason: t("struct.na") } : { s: "ok", data });
      } catch (err) {
        set({ s: "error", error: errorText(err) });
      }
    });

  const loadAll = () => {
    // Load each part INDEPENDENTLY: an engine that cannot produce a CREATE
    // statement (no get_ddl) must still show the columns, rather than one
    // failing call hiding the whole structure (issue: Informix DDL).
    void track(async () => {
      try {
        setError(null);
        setColumns(await schemaDescribe(props.connId, props.table, props.db, props.schema));
      } catch (err) {
        setError(errorText(err));
      }
    });
    void track(async () => {
      try {
        setDdlError(null);
        await loadDdl();
      } catch (err) {
        setDdlError(errorText(err));
      }
    });
    // A view has no indexes, keys or rows worth a COUNT(*): columns and the
    // definition are what it is.
    if (isView()) return;
    const idx = indexListFor(engine(), props.table, props.db, props.schema);
    void fill(setIndexes, idx.sql, idx.reason, structIndexes);
    const fkRead = (rs: ResultSet) => groupForeignKeys(parseForeignKeys(rs.columns, rs.rows));
    const out = foreignKeysFor(engine(), scope(), { table: props.table, direction: "from" });
    void fill(setOutbound, out.bulkSql, out.reason, fkRead);
    const into = foreignKeysFor(engine(), scope(), { table: props.table, direction: "to" });
    void fill(setInbound, into.bulkSql, into.reason, fkRead);
    const trg = objectsFor(engine(), "trigger", scope());
    void fill(setTriggers, trg.listSql, null, (rs) => triggersOn(props.table, rs, trg));
    // The catalog's statistic, never a COUNT(*): opening a structure must not
    // scan the table. Engines without one (SQLite, MongoDB) leave it out.
    const count = rowCountSql(engine(), props.db, props.schema);
    setRowCount(null);
    if (count) {
      void track(async () => {
        try {
          const r = await runQuery(props.connId, count);
          const byName = parseRowCounts(r.columns, r.rows);
          const key = Object.keys(byName).find((k) => k.toLowerCase() === props.table.toLowerCase());
          setRowCount(key === undefined ? null : byName[key]);
        } catch {
          setRowCount(null); // the summary simply leaves the count out
        }
      });
    }
  };
  onMount(loadAll);

  const copyDdl = async () => {
    try {
      await navigator.clipboard.writeText(ddl());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; the DDL stays visible to copy manually */
    }
  };
  const saveDdl = () => void saveText(sqlFileName(props.table), ddl(), "application/sql");

  const startEdit = () => {
    setDraft(ddl());
    setApplyError(null);
    setApplied(false);
    setEditing(true);
    setSection("definition");
  };

  // Beautify the view definition in place, reusing the same formatter as the SQL
  // editor (a no-op when the text can't be parsed — see sqlFormat.ts).
  const formatDraft = () => setDraft(formatSql(draft(), props.engine));

  // Qualified name used only as a fallback if the view name can't be read from
  // the DDL (see viewEdit.ts). Same quoting as generated SELECTs.
  const fallbackName = () =>
    qualifiedName({ db: props.db, schema: props.schema, name: props.table }, props.engine);

  const applyEdit = async () => {
    const plan = buildViewApply(engine(), draft(), fallbackName());
    if (!plan.ok) {
      setApplyError(plan.error);
      return;
    }
    setBusy(true);
    setApplyError(null);
    try {
      await withWriteConsent(props.connId, plan.statements, async () => {
        await txBegin(props.connId);
        try {
          for (const sql of plan.statements) {
            await runQuery(props.connId, sql);
          }
          await txCommit(props.connId);
        } catch (err) {
          try {
            await txRollback(props.connId);
          } catch {
            /* best-effort rollback */
          }
          throw err;
        }
      });
      await loadDdl();
      setEditing(false);
      setApplied(true);
      props.onApplied?.();
    } catch (err) {
      setApplyError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  // --- The columns, read --------------------------------------------------
  const cols = () => {
    const rs = columns();
    return rs ? structColumns(rs) : null;
  };
  const pkColumns = () => (cols() ?? []).filter((c) => c.pk).map((c) => c.name);
  const okData = <T,>(p: Part<T>): T | null => (p.s === "ok" ? p.data : null);
  const keyText = (n: KeyNote): string => {
    if (n.kind === "pk") return t("struct.key.pk");
    if (n.kind === "fk") return t("struct.key.fk", { target: `${n.table}.${n.column}` });
    return t(n.kind === "unique" ? "struct.key.unique" : "struct.key.index", { name: n.name });
  };

  const summary = () => {
    const parts = [isView() ? t("struct.kindView") : t("struct.kindTable")];
    for (const c of [props.db, props.schema]) if (c) parts.push(c);
    const c = cols();
    if (c) parts.push(countText("struct.nColumns", c.length));
    // SQL Server's partition counts are exact; the other catalogs estimate.
    if (rowCount() !== null)
      parts.push(countText(engineFamily(engine()) === "mssql" ? "struct.nRows" : "struct.nRowsApprox", rowCount()!));
    const ix = okData(indexes());
    if (ix) parts.push(countText("struct.nIndexes", ix.length));
    const into = okData(inbound());
    if (into) {
      const n = new Set(into.map((r) => r.fromTable)).size;
      parts.push(n ? countText("struct.referencedBy", n) : t("struct.notReferenced"));
    }
    return parts.join(" · ");
  };

  const moreMenu = (e: MouseEvent) => {
    const items: MenuItem[] = [
      { label: t("struct.copyName"), action: () => void navigator.clipboard?.writeText(props.table) },
      { label: t("struct.copyDdl"), action: () => void copyDdl(), disabled: !ddl() },
      { label: t("struct.saveSql"), action: saveDdl, disabled: !ddl() },
    ];
    if (props.onOpenSql) {
      items.push({ label: t("struct.openInEditor"), action: () => props.onOpenSql!(ddl()), disabled: !ddl() });
    }
    if (props.onView && !isView()) {
      items.push({ separator: true }, { label: t("struct.manageIndexes"), action: () => props.onView!("indexes") });
    }
    openContextMenu(e, items);
  };

  /** One folding section: title, count and its body (or why there is none). */
  const Section = <T,>(p: {
    title: string;
    part: Part<T[]>;
    empty: string;
    extra?: JSX.Element;
    children: (data: T[]) => JSX.Element;
  }) => (
    <details class="struct-sec" open>
      <summary>
        <Icon name="chevron-right" size={12} class="struct-sec-caret" />
        <h2>{p.title}</h2>
        <Show when={p.part.s === "ok"}>
          <span class="struct-sec-ct">{(p.part as { data: T[] }).data.length}</span>
        </Show>
        <span class="struct-sec-spacer" />
        {p.extra}
      </summary>
      <div class="struct-sec-body">
        {(() => {
          const part = p.part;
          if (part.s === "loading") return <p class="struct-note">{t("struct.loading")}</p>;
          if (part.s === "na") return <p class="struct-note">{t("struct.unavailable", { reason: part.reason })}</p>;
          if (part.s === "error") return <p class="test-error">{part.error}</p>;
          return part.data.length ? p.children(part.data) : <p class="struct-note">{p.empty}</p>;
        })()}
      </div>
    </details>
  );

  const fkLink = (table: string, label: string) => (
    <Show when={props.onOpenObject} fallback={<span>{label}</span>}>
      <button class="link-btn" onClick={() => props.onOpenObject!(table)}>
        {label}
      </button>
    </Show>
  );

  return (
    <Panel
      title={t("tab.structure", { name: props.table })}
      class="struct-view"
      wide
      onClose={props.onClose}
      onRefresh={editing() ? undefined : loadAll}
      refreshing={loading() > 0}
      actions={
        <>
          {/* Same section switch the routine and trigger explorers use, so a
              panel with two faces looks the same wherever it appears (#372). */}
          <Show when={props.onView}>
            <ObjectViewSwitch
              current={section() === "structure" ? "structure" : "ddl"}
              noIndexes={isView()}
              onPick={pickView}
            />
            <span class="toolbar-sep" aria-hidden="true" />
          </Show>
          <div class="obj-kind-toggle" role="tablist" hidden={!!props.onView}>
            <button
              class={`edit-btn ${section() === "structure" ? "active" : ""}`}
              role="tab"
              aria-selected={section() === "structure"}
              /* Leaving mid-edit would drop the draft silently. */
              disabled={editing()}
              onClick={() => setSection("structure")}
            >
              {t("struct.structure")}
            </button>
            <button
              class={`edit-btn ${section() === "definition" ? "active" : ""}`}
              role="tab"
              aria-selected={section() === "definition"}
              onClick={() => setSection("definition")}
            >
              {defLabel()}
            </button>
          </div>
          <Show when={section() === "structure" && props.onModify && !isView()}>
            <button class="edit-btn" onClick={() => props.onModify!()}>
              <Icon name="edit" size={14} class="eb-ic" /> {t("struct.modify")}
            </button>
          </Show>
          <Show when={section() === "definition"}>
            <Show when={isView() && !editing()}>
              <button class="edit-btn" onClick={startEdit} disabled={!ddl()}>
                {t("struct.editDef")}
              </button>
            </Show>
            <Show when={editing()}>
              <button class="edit-btn" onClick={formatDraft} disabled={!draft()}>
                {t("struct.format")}
              </button>
            </Show>
            <button class="edit-btn" onClick={copyDdl} disabled={!ddl() || editing()}>
              {copied() ? t("struct.copied") : t("struct.copyDdl")}
            </button>
            <Show when={props.onOpenSql && !editing()}>
              <button class="edit-btn" onClick={() => props.onOpenSql!(ddl())} disabled={!ddl()}>
                {t("struct.openInEditor")}
              </button>
            </Show>
            <Show when={!editing()}>
              <button class="edit-btn" onClick={saveDdl} disabled={!ddl()}>
                {t("struct.saveSql")}
              </button>
            </Show>
          </Show>
        </>
      }
      status={
        <>
          <Show when={applied()}>
            <span class="test-ok">{t("struct.viewUpdated")}</span>
          </Show>
          <button
            class="edit-btn edit-btn-icon"
            aria-haspopup="menu"
            aria-label={t("struct.more")}
            title={t("struct.more")}
            onClick={moreMenu}
          >
            <Icon name="more" size={14} />
          </button>
        </>
      }
    >
        <Show when={section() === "structure"}>
          <div class="struct-scroll">
            <p class="struct-summary">{summary()}</p>
            <Show when={error()}>
              <p class="test-error">{error()}</p>
            </Show>
            <Show when={columns()}>
              {(rs) => (
                <details class="struct-sec" open>
                  <summary>
                    <Icon name="chevron-right" size={12} class="struct-sec-caret" />
                    <h2>{t("struct.columns")}</h2>
                    <span class="struct-sec-ct">{rs().rows.length}</span>
                  </summary>
                  <div class="struct-sec-body">
                    <Show
                      when={cols()}
                      fallback={
                        // Not the neutral describe shape: shown as it came.
                        <table class="struct-table">
                          <thead>
                            <tr>
                              <For each={rs().columns}>{(c) => <th scope="col">{c.name}</th>}</For>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={rs().rows}>
                              {(row) => (
                                <tr>
                                  <For each={row}>
                                    {(cell) => <td>{cell ?? <span class="cell-null">NULL</span>}</td>}
                                  </For>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      }
                    >
                      {(list) => (
                        <table class="struct-table" aria-label={t("struct.columnsOf", { name: props.table })}>
                          <thead>
                            <tr>
                              <th scope="col" class="num">#</th>
                              <th scope="col">{t("struct.col.name")}</th>
                              <th scope="col">{t("struct.col.type")}</th>
                              <th scope="col">{t("struct.col.nullable")}</th>
                              <th scope="col">{t("struct.col.default")}</th>
                              <th scope="col">{t("struct.col.keys")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            <For each={list()}>
                              {(c, i) => (
                                <tr>
                                  <td class="num struct-dim">{i() + 1}</td>
                                  <td classList={{ "struct-pk": c.pk }}>{c.name}</td>
                                  <td class="struct-type">{c.type}</td>
                                  <td>
                                    <Show when={c.nullable} fallback={<span class="struct-dim" aria-label={t("struct.no")}>—</span>}>
                                      <Icon name="check" size={14} label={t("struct.yes")} />
                                    </Show>
                                  </td>
                                  <td>
                                    <Show when={c.defaultValue} fallback={<span class="struct-dim" aria-label={t("struct.noDefault")}>—</span>}>
                                      {c.defaultValue}
                                    </Show>
                                  </td>
                                  <td class="struct-keys">
                                    {columnKeys(c.name, pkColumns(), okData(indexes()) ?? [], okData(outbound()) ?? [])
                                      .map(keyText)
                                      .join(" · ")}
                                  </td>
                                </tr>
                              )}
                            </For>
                          </tbody>
                        </table>
                      )}
                    </Show>
                  </div>
                </details>
              )}
            </Show>

            <Show when={!isView()}>
              <Section
                title={t("struct.indexes")}
                part={indexes()}
                empty={t("struct.noIndexes")}
                extra={
                  <Show when={props.onView}>
                    <button class="link-btn" onClick={() => props.onView!("indexes")}>
                      {t("struct.manageIndexes")}
                    </button>
                  </Show>
                }
              >
                {(list: StructIndex[]) => (
                  <table class="struct-table" aria-label={t("struct.indexesOf", { name: props.table })}>
                    <thead>
                      <tr>
                        <th scope="col">{t("struct.col.name")}</th>
                        <th scope="col">{t("struct.col.columns")}</th>
                        <th scope="col">{t("struct.col.unique")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={list}>
                        {(ix) => (
                          <tr>
                            <td>{ix.name}</td>
                            <td>{ix.columns ? ix.columns.join(", ") : <span class="struct-dim">{t("struct.unknown")}</span>}</td>
                            <td>
                              <Show when={ix.unique !== null} fallback={<span class="struct-dim">{t("struct.unknown")}</span>}>
                                <Show when={ix.unique} fallback={<span class="struct-dim" aria-label={t("struct.no")}>—</span>}>
                                  <Icon name="check" size={14} label={t("struct.yes")} />
                                </Show>
                              </Show>
                            </td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                )}
              </Section>

              <Section
                title={t("struct.foreignKeys")}
                part={outbound()}
                empty={t("struct.noForeignKeys", { name: props.table })}
              >
                {(list: ForeignKeyRelation[]) => (
                  <table class="struct-table" aria-label={t("struct.foreignKeysOf", { name: props.table })}>
                    <thead>
                      <tr>
                        <th scope="col">{t("struct.col.from")}</th>
                        <th scope="col">{t("struct.col.to")}</th>
                        <th scope="col">{t("struct.col.constraint")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={list}>
                        {(fk) => (
                          <tr>
                            <td>{fk.columns.map((c) => c.from).join(", ")}</td>
                            <td>{fkLink(fk.toTable, `${fk.toTable}.${fk.columns.map((c) => c.to).join(", ")}`)}</td>
                            <td class="struct-dim">{fk.constraint}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                )}
              </Section>

              <Section
                title={t("struct.referencedByTitle")}
                part={inbound()}
                empty={t("struct.noReferences", { name: props.table })}
              >
                {(list: ForeignKeyRelation[]) => (
                  <table class="struct-table" aria-label={t("struct.referencesTo", { name: props.table })}>
                    <thead>
                      <tr>
                        <th scope="col">{t("struct.col.from")}</th>
                        <th scope="col">{t("struct.col.to")}</th>
                        <th scope="col">{t("struct.col.constraint")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={list}>
                        {(fk) => (
                          <tr>
                            <td>{fkLink(fk.fromTable, `${fk.fromTable}.${fk.columns.map((c) => c.from).join(", ")}`)}</td>
                            <td>{`${fk.toTable}.${fk.columns.map((c) => c.to).join(", ")}`}</td>
                            <td class="struct-dim">{fk.constraint}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                )}
              </Section>

              <Section title={t("struct.triggers")} part={triggers()} empty={t("struct.noTriggers")}>
                {(list: StructTrigger[]) => (
                  <table class="struct-table" aria-label={t("struct.triggersOf", { name: props.table })}>
                    <thead>
                      <tr>
                        <th scope="col">{t("struct.col.name")}</th>
                        <th scope="col">{t("struct.col.when")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={list}>
                        {(tr) => (
                          <tr>
                            <td>{tr.name}</td>
                            <td>{tr.when ?? <span class="struct-dim">{t("struct.unknown")}</span>}</td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                )}
              </Section>
            </Show>
          </div>
        </Show>

        <Show when={section() === "definition"}>
          <Show
            when={editing()}
            fallback={
              <Show
                when={ddlError()}
                fallback={
                  <>
                    <SqlHighlight
                      class="ddl-text"
                      sql={ddl() || "—"}
                      engine={props.engine}
                      label={t("struct.ddlOf", { name: props.table })}
                    />
                    <p class="struct-note">{t("struct.readOnlyDdl")}</p>
                  </>
                }
              >
                <p class="test-error">{t("struct.ddlUnavailable", { reason: ddlError()! })}</p>
              </Show>
            }
          >
            <textarea
              class="ddl-edit"
              value={draft()}
              onInput={(e) => setDraft(e.currentTarget.value)}
              onKeyDown={(e) => {
                // Same key the SQL editor uses to format (see SqlEditor.tsx); this
                // is a plain textarea, so it needs its own binding.
                if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
                  e.preventDefault();
                  formatDraft();
                }
              }}
              spellcheck={false}
            />
            <Show when={applyError()}>
              <p class="test-error">{applyError()}</p>
            </Show>
          </Show>
        </Show>

        {/* No «Cerrar» here: the view is a tab with its own close (audit A-21).
            While editing, the action row in the OS order (#692). */}
        <Show when={editing()}>
          <div class="panel-foot">
            <span class="dlg-actions">
              {orderActions(currentOs(), [
                <button class="btn-primary" disabled={busy()} onClick={applyEdit}>
                  {busy() ? t("struct.applying") : t("struct.apply")}
                </button>,
                <button class="btn" disabled={busy()} onClick={() => setEditing(false)}>
                  {t("common.cancel")}
                </button>,
              ])}
            </span>
          </div>
        </Show>
    </Panel>
  );
}
