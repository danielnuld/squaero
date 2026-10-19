import { keyLabel } from "../utils/shortcuts";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { withWriteConsent } from "../utils/transport";
import { createStore, produce, reconcile } from "solid-js/store";
import { runQuery } from "../utils/query";
import { txBegin, txCommit, txRollback } from "../utils/edit";
import { errorText } from "../utils/errors";
import { schemaDescribe } from "../utils/schema";
import { describePkColumns } from "../utils/edit";
import {
  buildAlterTable,
  buildCreateTable,
  columnState,
  columnsFromDescribe,
  emptyColumn,
  typeSuggestions,
  type AlterColumn,
  type AlterTableDef,
  type OriginalTable,
  type TableDef,
} from "../utils/tableDesign";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";
import { Icon } from "./icons";
import { countText, dropColumnsConfirm } from "../utils/confirmText";
import { ConfirmDialog } from "./ConfirmDialog";
import { copyText } from "../utils/rowCopy";
import { engineFamily } from "../utils/engineFamily";


// Table designer (issue #136). Two modes selected by the `table` prop:
//  • create — a blank form → CREATE TABLE (phase 1);
//  • alter  — loads an existing table's columns (schema.describe) → diffs the
//    edits into ALTER statements (phase 2). Column identity is tracked by
//    `origName` so a rename is not a drop+add. PK / auto-increment are read-only
//    while altering (constraint management is out of scope for this phase).
// Both preview the generated SQL and apply inside a transaction.
export function TableDesigner(props: {
  connId: string;
  engine: string;
  /** When set, edit this existing table (alter mode); otherwise create a new one. */
  table?: string;
  /** Database/schema qualifier (create) and describe container (alter). */
  container?: string;
  /** Describe container split (alter mode); `container` also carries whichever
      the tree node had, but describe wants db/schema separately. */
  db?: string;
  schema?: string;
  onClose: () => void;
  onApplied?: () => void;
  /** Open the SQL preview in a query tab; absent hides «Abrir en el editor». */
  onOpenSql?: (sql: string) => void;
}) {
  const alter = () => !!props.table;

  // A fresh create-mode form: one auto-increment id column.
  const defaultCreateColumns = (): AlterColumn[] => [
    { ...emptyColumn(), name: "id", type: "INT", nullable: false, primaryKey: true, autoIncrement: true },
  ];

  const [name, setName] = createSignal(props.table ?? "");
  const [columns, setColumns] = createStore<AlterColumn[]>(
    props.table ? [] : defaultCreateColumns(),
  );
  const [original, setOriginal] = createSignal<OriginalTable | null>(null);
  /** The rows as loaded, for «Descartar». */
  const [loaded, setLoaded] = createSignal<AlterColumn[]>([]);
  let tableEl: HTMLTableElement | undefined;
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // App renders a SINGLE <TableDesigner> shared by every designer tab (the
  // create tab and every per-table alter tab), so switching tabs only changes
  // props — the component is not remounted. This effect therefore resets ALL
  // state synchronously on every target change before loading, so a previous
  // table's name/columns can never bleed into another tab (the stale-tab bug
  // class already fixed in RoutineExplorer/TriggersExplorer). Uses an effect,
  // not onMount, for the same reason.
  createEffect(() => {
    const t = props.table;
    const connId = props.connId;
    const db = props.db;
    const schema = props.schema;
    setLoadError(null);
    setError(null);
    setOriginal(null);
    if (!t) {
      // Create mode: blank form.
      setName("");
      setColumns(reconcile(defaultCreateColumns()));
      return;
    }
    // Alter mode: show the table name immediately, clear rows until describe
    // resolves (the preview reads "Cargando…" while original() is null).
    setName(t);
    setColumns(reconcile([]));
    if (!connId) return;
    let superseded = false;
    void (async () => {
      try {
        const desc = await schemaDescribe(connId, t, db, schema);
        if (superseded) return;
        const originals = columnsFromDescribe(desc);
        const pk = new Set(describePkColumns(desc));
        setOriginal({ name: t, columns: originals });
        const rows = originals.map((o) => ({
          origName: o.name,
          name: o.name,
          type: o.type,
          nullable: o.nullable,
          primaryKey: pk.has(o.name),
          autoIncrement: false,
          defaultValue: o.defaultValue,
        }));
        setLoaded(rows);
        setColumns(reconcile(rows.map((r) => ({ ...r }))));
      } catch (err) {
        if (!superseded) setLoadError(errorText(err));
      }
    })();
    return () => {
      superseded = true;
    };
  });

  const createDef = (): TableDef => ({ name: name(), columns: [...columns], container: props.container });
  const alterDef = (): AlterTableDef => ({ name: name(), columns: [...columns], container: props.container });

  // The built SQL: a single CREATE (create mode) or a list of ALTERs (alter
  // mode, once the original structure has loaded).
  const built = createMemo(() => {
    if (!alter()) return buildCreateTable(props.engine, createDef());
    const orig = original();
    if (!orig) return null;
    const res = buildAlterTable(props.engine, orig, alterDef());
    return res;
  });

  // Preview text: the CREATE statement, the joined ALTERs, or a "no changes"
  // placeholder. Empty statements mean the edited form matches the original.
  const preview = createMemo(() => {
    const b = built();
    if (!b) return t("panel.loading");
    if (!b.ok) return "—";
    if ("sql" in b) return b.sql;
    if (b.statements.length === 0) return t("td.noChanges");
    return b.statements.map((s) => s + ";").join("\n");
  });

  const validationError = createMemo(() => {
    const b = built();
    return b && !b.ok ? b.error : null;
  });

  // Alter mode with a loaded original but no diff → nothing to apply.
  const noChanges = () => {
    const b = built();
    return !!b && b.ok && "statements" in b && b.statements.length === 0;
  };

  // The original columns the edit leaves out: applying drops them and their data,
  // so the button turns red and asks first, naming each one.
  const dropped = createMemo(() => {
    const orig = original();
    if (!alter() || !orig) return [];
    const kept = new Set(columns.map((c) => c.origName));
    return orig.columns.filter((o) => !kept.has(o.name)).map((o) => o.name);
  });
  const [confirmDrop, setConfirmDrop] = createSignal(false);
  const dropText = () => dropColumnsConfirm(props.table ?? name(), dropped());

  const addColumn = () => setColumns(columns.length, { ...emptyColumn() });
  /** Ctrl+Intro anywhere in the grid adds a column and puts the cursor in its name. */
  const onGridKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    addColumn();
    queueMicrotask(() => tableEl?.querySelector<HTMLInputElement>("tbody tr:last-child input.td-in")?.focus());
  };
  const discard = () => {
    setName(props.table ?? "");
    setColumns(reconcile(loaded().map((r) => ({ ...r }))));
    setError(null);
  };
  const statementCount = () => {
    const b = built();
    return b && b.ok ? ("sql" in b ? 1 : b.statements.length) : 0;
  };
  const states = () => (alter() ? columns.map((c) => columnState(c, original())) : []);
  const hint = () => {
    const s = states();
    const added = s.filter((x) => x === "added").length;
    const changed = s.filter((x) => x === "changed").length;
    const parts = [
      ...(added ? [countText("td.addedN", added)] : []),
      ...(changed ? [countText("td.changedN", changed)] : []),
    ];
    return parts.length ? [...parts, t("td.txNote")].join(" · ") : "";
  };
  const sqlText = () => {
    const b = built();
    return b && b.ok ? ("sql" in b ? b.sql : b.statements.map((s) => s + ";").join("\n")) : "";
  };
  const removeColumn = (i: number) => setColumns(produce((cs) => cs.splice(i, 1)));
  const patch = (i: number, key: keyof AlterColumn, value: string | boolean) =>
    setColumns(i, key as keyof AlterColumn, value as never);

  const suggestions = typeSuggestions(props.engine);

  const apply = async () => {
    const b = built();
    if (!b || !b.ok) {
      if (b && !b.ok) setError(b.error);
      return;
    }
    const statements = "sql" in b ? [b.sql] : b.statements;
    if (statements.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await withWriteConsent(props.connId, statements, async () => {
        await txBegin(props.connId);
        try {
          for (const sql of statements) {
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
      props.onApplied?.();
      props.onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const title = () =>
    alter() ? t("td.titleAlter", { name: props.table ?? "" }) : t("td.titleNew");

  return (
    <Panel title={title()} wide onClose={props.onClose}>
      {/* The toolbar carries the verb with its count (#692): «Aplicar 2 cambios»
          beside Descartar, or «Crear tabla proveedores» beside Cancelar. */}
      <div class="edit-toolbar td-toolbar" role="toolbar" aria-label={title()}>
        <h2>
          {alter() ? t("td.headingAlter") : t("td.titleNew")}
          {alter() ? ` · ${props.table}` : ""}
        </h2>
        <Show when={props.container}>
          <span class="help">{props.container}</span>
        </Show>
        <span class="toolbar-spacer" />
        <button
          type="button"
          class={dropped().length > 0 ? "btn btn-danger" : "btn btn-primary"}
          disabled={busy() || !built()?.ok || noChanges()}
          onClick={() => (dropped().length > 0 ? setConfirmDrop(true) : void apply())}
        >
          {busy()
            ? alter()
              ? t("td.applying")
              : t("td.creating")
            : dropped().length > 0
              ? countText("td.applyDropping", dropped().length)
              : alter()
              ? statementCount() > 0
                ? countText("td.applyN", statementCount())
                : t("td.applyChanges")
              : name().trim()
                ? t("td.createNamed", { name: name().trim() })
                : t("td.create")}
        </button>
        <Show
          when={alter()}
          fallback={
            <button type="button" class="btn" disabled={busy()} onClick={props.onClose}>
              {t("common.cancel")}
            </button>
          }
        >
          <button type="button" class="btn" disabled={busy() || noChanges()} onClick={discard}>
            {t("td.discard")}
          </button>
        </Show>
      </div>

      <Show when={loadError()}>
        <p class="test-error">{loadError()}</p>
      </Show>

      <label class="field">
        <span>{t("td.tableName")}</span>
        <input
          type="text"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          placeholder={t("td.tableNamePlaceholder")}
        />
      </label>

      <datalist id="td-types">
        <For each={suggestions}>{(type) => <option value={type} />}</For>
      </datalist>

      <table class="td-table" ref={tableEl} onKeyDown={onGridKey}>
        <thead>
          <tr>
            <th>{t("td.colColumn")}</th>
            <th>{t("td.colType")}</th>
            <th title={t("td.colNullTitle")}>{t("td.colNull")}</th>
            <th title={t("td.colPkTitle")}>{t("td.colPk")}</th>
            <th title={t("td.colAiTitle")}>{t("td.colAi")}</th>
            <th>{t("td.colDefault")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <For each={columns}>
            {(c, i) => {
              // Each row's controls named for a screen reader: the header they
              // sit under and the column they edit (audit P4).
              const colName = () => c.name.trim() || t("td.rowN", { n: i() + 1 });
              const aria = (field: string) => t("td.cellAria", { field, column: colName() });
              return (
              <tr class={states()[i()] ? `td-row is-${states()[i()]}` : "td-row"}>
                <td>
                  <input
                    class="td-in"
                    value={c.name}
                    onInput={(e) => patch(i(), "name", e.currentTarget.value)}
                    aria-label={t("td.nameAria", { n: i() + 1 })}
                    placeholder={t("td.namePlaceholder")}
                  />
                </td>
                <td>
                  <input
                    class="td-in"
                    list="td-types"
                    value={c.type}
                    onInput={(e) => patch(i(), "type", e.currentTarget.value)}
                    aria-label={aria(t("td.colType"))}
                    placeholder="INT"
                  />
                </td>
                <td class="td-c">
                  <input
                    type="checkbox"
                    checked={c.nullable}
                    aria-label={aria(t("td.colNullTitle"))}
                    onChange={(e) => patch(i(), "nullable", e.currentTarget.checked)}
                  />
                </td>
                <td class="td-c">
                  <input
                    type="checkbox"
                    checked={c.primaryKey}
                    aria-label={aria(t("td.colPkTitle"))}
                    disabled={alter()}
                    title={alter() ? t("td.pkLocked") : undefined}
                    onChange={(e) => patch(i(), "primaryKey", e.currentTarget.checked)}
                  />
                </td>
                <td class="td-c">
                  <input
                    type="checkbox"
                    checked={c.autoIncrement}
                    aria-label={aria(t("td.colAiTitle"))}
                    disabled={alter()}
                    title={alter() ? t("td.aiLocked") : undefined}
                    onChange={(e) => patch(i(), "autoIncrement", e.currentTarget.checked)}
                  />
                </td>
                <td>
                  <input
                    class="td-in"
                    value={c.defaultValue}
                    onInput={(e) => patch(i(), "defaultValue", e.currentTarget.value)}
                    aria-label={aria(t("td.colDefault"))}
                    placeholder={t("td.noDefault")}
                  />
                </td>
                <td class="td-c">
                  <button
                    class="grid-action danger"
                    title={t("td.removeColumnOf", { column: colName() })}
                    aria-label={t("td.removeColumnOf", { column: colName() })}
                    disabled={columns.length <= 1}
                    onClick={() => removeColumn(i())}
                  >
                    <Icon name="close" size={12} />
                  </button>
                </td>
              </tr>
              );
            }}
          </For>
        </tbody>
      </table>

      <div class="td-under">
        <button type="button" class="btn" onClick={addColumn}>
          <Icon name="plus" size={14} />
          {t("td.addColumn")}
          <kbd class="tab-kbd">{keyLabel("Mod+Enter")}</kbd>
        </button>
        <Show when={hint()}>
          <span class="help" role="status">
            {hint()}
          </span>
        </Show>
      </div>

      <div class="ddl-header">
        <span>
          {t("td.preview")}
          {statementCount() > 0 ? ` · ${countText("td.statementsN", statementCount())}` : ""}
        </span>
        <span class="td-preview-actions">
          <button type="button" disabled={!sqlText()} onClick={() => copyText(sqlText())}>
            {t("ssync.copyScript")}
          </button>
          <Show when={props.onOpenSql}>
            <button type="button" disabled={!sqlText()} onClick={() => props.onOpenSql?.(sqlText())}>
              {t("ssync.openInEditor")}
            </button>
          </Show>
        </span>
      </div>
      <pre class="ddl-text">{preview()}</pre>
      <Show when={alter() && engineFamily(props.engine) === "sqlite"}>
        <p class="help">{t("td.sqliteNote")}</p>
      </Show>

      {/* Live validation error (why it can't be applied yet) or an apply failure. */}
      <Show when={error() || validationError()}>
        <p class="test-error">{error() ?? validationError()}</p>
      </Show>

      <Show when={confirmDrop()}>
        <ConfirmDialog
          title={dropText().title}
          message={dropText().message}
          confirmLabel={dropText().confirm}
          sql={preview()}
          onConfirm={() => {
            setConfirmDrop(false);
            void apply();
          }}
          onCancel={() => setConfirmDrop(false)}
        />
      </Show>
    </Panel>
  );
}
