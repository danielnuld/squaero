import { For, Show, createMemo, createSignal } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { runQuery } from "../utils/query";
import { txBegin, txCommit, txRollback } from "../utils/edit";
import { errorText } from "../utils/errors";
import {
  buildCreateTable,
  emptyColumn,
  typeSuggestions,
  type ColumnDef,
  type TableDef,
} from "../utils/tableDesign";
import { Panel } from "./Panel";

// Table designer (issue #136, phase 1: create). A form to define a table's name
// and columns (type, nullable, primary key, auto-increment, default), a live
// preview of the generated CREATE TABLE (per engine, via buildCreateTable), and
// apply inside a transaction. ALTER of an existing table is a later phase.
export function TableDesigner(props: {
  connId: string;
  engine: string;
  /** Database/schema to create the table in (qualifies the name). */
  container?: string;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [name, setName] = createSignal("");
  const [columns, setColumns] = createStore<ColumnDef[]>([
    { ...emptyColumn(), name: "id", type: "INT", nullable: false, primaryKey: true, autoIncrement: true },
  ]);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const def = (): TableDef => ({ name: name(), columns: [...columns], container: props.container });
  const built = createMemo(() => buildCreateTable(props.engine, def()));

  const addColumn = () => setColumns(columns.length, emptyColumn());
  const removeColumn = (i: number) =>
    setColumns(produce((cs) => cs.splice(i, 1)));
  const patch = (i: number, key: keyof ColumnDef, value: string | boolean) =>
    setColumns(i, key as keyof ColumnDef, value as never);

  const suggestions = typeSuggestions(props.engine);

  const apply = async () => {
    const b = built();
    if (!b.ok) {
      setError(b.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await txBegin(props.connId);
      try {
        await runQuery(props.connId, b.sql);
        await txCommit(props.connId);
      } catch (err) {
        try {
          await txRollback(props.connId);
        } catch {
          /* best-effort rollback */
        }
        throw err;
      }
      props.onCreated?.();
      props.onClose();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Nueva tabla" wide onClose={props.onClose}>
      <h2>Nueva tabla{props.container ? ` · ${props.container}` : ""}</h2>

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
                    onChange={(e) => patch(i(), "primaryKey", e.currentTarget.checked)}
                  />
                </td>
                <td class="td-c">
                  <input
                    type="checkbox"
                    checked={c.autoIncrement}
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
                    class="grid-action row-del"
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
      <pre class="ddl-text">{built().ok ? (built() as { sql: string }).sql : "—"}</pre>

      {/* Live validation error (why the table can't be created yet) or an apply
          failure. */}
      <Show when={error() || !built().ok}>
        <p class="test-error">
          {error() ?? (built() as { error: string }).error}
        </p>
      </Show>

      <div class="modal-actions">
        <span class="status-spacer" />
        <button disabled={busy()} onClick={props.onClose}>
          Cancelar
        </button>
        <button class="primary" disabled={busy() || !built().ok} onClick={apply}>
          {busy() ? "Creando…" : "Crear tabla"}
        </button>
      </div>
    </Panel>
  );
}
