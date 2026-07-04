import { For, Show, createMemo } from "solid-js";
import { Modal } from "./Modal";
import { NULL_LABEL } from "../utils/format";
import { buildRowFields, canStep } from "../utils/rowDetail";
import type { ResultColumn } from "../utils/query";

// Row form/detail view (issue #133): shows a single row as a field-by-field form,
// which reads far better than a wide grid row for many columns or long / JSON
// cells. It reuses the tab's transactional edit session: when `editing` is on the
// fields become textareas that write into the same PendingChanges via onEditCell,
// so confirming/applying from the toolbar picks the changes up unchanged. Prev/
// next walk the loaded rows in their original order (edit hooks are keyed by that
// index). Pure field/navigation logic lives in utils/rowDetail.ts.
export function RowDetail(props: {
  columns: ResultColumn[];
  /** The row's cells (SQL NULL => null). */
  row: (string | null)[];
  /** Original index of this row in the loaded result (edit hooks key off it). */
  rowIndex: number;
  /** Total loaded rows, for the position readout and navigation bounds. */
  total: number;
  /** True while the tab's edit session is active — fields become editable. */
  editing: boolean;
  /** True when the tab is editable (table has a projected primary key). */
  editable: boolean;
  /** True when this row is marked for deletion in the pending set. */
  deleted: boolean;
  /** Pending edits for this row, column -> new value. */
  edits?: Record<string, string | null>;
  onEditCell: (column: string, value: string) => void;
  onToggleDelete: () => void;
  /** Start the edit session (only offered when editable and not yet editing). */
  onBeginEdit: () => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const fields = createMemo(() =>
    buildRowFields(props.columns, props.row, props.editing ? props.edits : undefined),
  );
  const canPrev = () => canStep(props.rowIndex, -1, props.total);
  const canNext = () => canStep(props.rowIndex, 1, props.total);

  return (
    <Modal title="Detalle de fila" wide class="row-detail" onClose={props.onClose}>
      <div class="rd-head">
        <h2>Detalle de fila</h2>
        <div class="rd-nav">
          <button class="rd-nav-btn" disabled={!canPrev()} title="Fila anterior" onClick={props.onPrev}>
            ‹
          </button>
          <span class="rd-pos">
            Fila {props.rowIndex + 1} de {props.total}
          </span>
          <button class="rd-nav-btn" disabled={!canNext()} title="Fila siguiente" onClick={props.onNext}>
            ›
          </button>
        </div>
      </div>

      <Show when={props.deleted}>
        <div class="rd-deleted-banner">Esta fila está marcada para eliminación.</div>
      </Show>

      <div class="rd-fields">
        <For each={fields()}>
          {(f) => (
            <div class={`rd-field ${f.edited ? "rd-edited" : ""}`}>
              <label class="rd-label" title={f.type}>
                <span class="rd-name">{f.name}</span>
                <span class="rd-type">{f.type}</span>
                <Show when={f.edited}>
                  <span class="rd-edited-tag">editado</span>
                </Show>
              </label>
              <Show
                when={props.editing && !props.deleted}
                fallback={
                  <div class={`rd-value ${f.value === null ? "rd-null" : ""}`}>
                    {f.value === null ? NULL_LABEL : f.value}
                  </div>
                }
              >
                <textarea
                  class="rd-input"
                  rows={f.value && f.value.length > 60 ? 4 : 1}
                  value={f.value ?? ""}
                  onInput={(e) => props.onEditCell(f.name, e.currentTarget.value)}
                />
              </Show>
            </div>
          )}
        </For>
      </div>

      <div class="modal-actions rd-actions">
        <Show when={props.editable && !props.editing}>
          <button onClick={props.onBeginEdit}>Editar</button>
        </Show>
        <Show when={props.editing}>
          <button class={props.deleted ? "" : "danger"} onClick={props.onToggleDelete}>
            {props.deleted ? "Deshacer borrado" : "Borrar fila"}
          </button>
        </Show>
        <span class="toolbar-spacer" />
        <button class="primary" onClick={props.onClose}>
          Cerrar
        </button>
      </div>
    </Modal>
  );
}
