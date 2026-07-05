import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { createStore, produce, reconcile } from "solid-js/store";
import { runQuery } from "../utils/query";
import { txBegin, txCommit, txRollback } from "../utils/edit";
import { errorText } from "../utils/errors";
import { schemaDescribe } from "../utils/schema";
import { describePkColumns } from "../utils/edit";
import {
  buildAlterTable,
  buildCreateTable,
  columnsFromDescribe,
  emptyColumn,
  typeSuggestions,
  type AlterColumn,
  type AlterTableDef,
  type OriginalTable,
  type TableDef,
} from "../utils/tableDesign";
import { Panel } from "./Panel";

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
        setColumns(
          reconcile(
            originals.map((o) => ({
              origName: o.name,
              name: o.name,
              type: o.type,
              nullable: o.nullable,
              primaryKey: pk.has(o.name),
              autoIncrement: false,
              defaultValue: o.defaultValue,
            })),
          ),
        );
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
    if (!b) return "Cargando…";
    if (!b.ok) return "—";
    if ("sql" in b) return b.sql;
    if (b.statements.length === 0) return "Sin cambios.";
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

  const addColumn = () => setColumns(columns.length, { ...emptyColumn() });
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
      props.onApplied?.();
      props.onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  const title = () => (alter() ? `Modificar tabla · ${props.table}` : "Nueva tabla");

  return (
    <Panel title={title()} wide onClose={props.onClose}>
      <h2>
        {alter() ? "Modificar tabla" : "Nueva tabla"}
        {props.container ? ` · ${props.container}` : ""}
      </h2>

      <Show when={loadError()}>
        <p class="test-error">{loadError()}</p>
      </Show>

      <label class="field">
        <span>Nombre de la tabla</span>
        <input
          type="text"
          value={name()}
          onInput={(e) => setName(e.currentTarget.value)}
          placeholder="mi_tabla"
        />
      </label>

      <datalist id="td-types">
        <For each={suggestions}>{(t) => <option value={t} />}</For>
      </datalist>

      <table class="td-table">
        <thead>
          <tr>
            <th>Columna</th>
            <th>Tipo</th>
            <th title="Permite NULL">Nulo</th>
            <th title="Clave primaria">PK</th>
            <th title="Autoincremental">AI</th>
            <th>Default</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <For each={columns}>
            {(c, i) => (
              <tr>
                <td>
                  <input
                    class="td-in"
                    value={c.name}
                    onInput={(e) => patch(i(), "name", e.currentTarget.value)}
                    placeholder="nombre"
                  />
                </td>
                <td>
                  <input
                    class="td-in"
                    list="td-types"
                    value={c.type}
                    onInput={(e) => patch(i(), "type", e.currentTarget.value)}
                    placeholder="INT"
                  />
                </td>
                <td class="td-c">
                  <input
                    type="checkbox"
                    checked={c.nullable}
                    onChange={(e) => patch(i(), "nullable", e.currentTarget.checked)}
                  />
                </td>
                <td class="td-c">
                  <input
                    type="checkbox"
                    checked={c.primaryKey}
                    disabled={alter()}
                    title={alter() ? "La clave primaria no se modifica al alterar" : undefined}
                    onChange={(e) => patch(i(), "primaryKey", e.currentTarget.checked)}
                  />
                </td>
                <td class="td-c">
                  <input
                    type="checkbox"
                    checked={c.autoIncrement}
                    disabled={alter()}
                    title={alter() ? "El autoincremental no se modifica al alterar" : undefined}
                    onChange={(e) => patch(i(), "autoIncrement", e.currentTarget.checked)}
                  />
                </td>
                <td>
                  <input
                    class="td-in"
                    value={c.defaultValue}
                    onInput={(e) => patch(i(), "defaultValue", e.currentTarget.value)}
                    placeholder="—"
                  />
                </td>
                <td class="td-c">
                  <button
                    class="grid-action danger"
                    title="Quitar columna"
                    disabled={columns.length <= 1}
                    onClick={() => removeColumn(i())}
                  >
                    ✕
                  </button>
                </td>
              </tr>
            )}
          </For>
        </tbody>
      </table>

      <button class="edit-btn" onClick={addColumn}>
        ＋ Columna
      </button>

      <div class="ddl-header" style={{ "margin-top": "1rem" }}>
        <span>Vista previa</span>
      </div>
      <pre class="ddl-text">{preview()}</pre>

      {/* Live validation error (why it can't be applied yet) or an apply failure. */}
      <Show when={error() || validationError()}>
        <p class="test-error">{error() ?? validationError()}</p>
      </Show>

      <div class="modal-actions">
        <span class="status-spacer" />
        <button disabled={busy()} onClick={props.onClose}>
          Cancelar
        </button>
        <button
          class="primary"
          disabled={busy() || !built()?.ok || noChanges()}
          onClick={apply}
        >
          {busy()
            ? alter()
              ? "Aplicando…"
              : "Creando…"
            : alter()
              ? "Aplicar cambios"
              : "Crear tabla"}
        </button>
      </div>
    </Panel>
  );
}
