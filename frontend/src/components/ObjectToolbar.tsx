import { For, Show } from "solid-js";

// Contextual object-action toolbar (UI design proposal, phase 2b). It sits above
// the result grid and consolidates, in one place, every action that applies to
// the object currently shown in the tab — edit lifecycle, import/generate/sync,
// transfer, chart and export. It is purely presentational: the workspace owns
// all state and passes plain callbacks, so the transactional-edit flow
// (begin → confirm preview → apply/commit; discard → rollback) is unchanged.
//
// The primary action is highlighted with .edit-btn-primary. It is contextual:
// "Editar" when a keyed table is at rest, "Confirmar" once editing has begun.

/** One export format offered by the workspace (text formats + xlsx). */
export interface ExportFormatItem {
  fmt: string;
  label: string;
}

export interface ObjectToolbarProps {
  /** True when the tab is backed by a table/view object (edit + data actions). */
  isTable: boolean;
  /** True when the current result exposes columns (chart + export). */
  hasColumns: boolean;
  /** Edit-session state. */
  editing: boolean;
  /** True when the object is editable (has a primary key). */
  editable: boolean;
  /** An edit operation is in flight (disables mutating buttons). */
  busy: boolean;
  /** Current edit-session error, if any. */
  error?: string | null;
  /** Number of pending changes (label of the confirm button). */
  changeCount: number;
  /** True when there is at least one pending change (enables Confirmar). */
  hasChanges: boolean;
  /** Export formats to offer. */
  exportFormats: ExportFormatItem[];
  onEdit: () => void;
  onImport: () => void;
  onGenerate: () => void;
  onSchemaSync: () => void;
  onDataSync: () => void;
  onTransfer: () => void;
  onAddRow: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
  onChart: () => void;
  onExport: (fmt: string) => void;
}

export function ObjectToolbar(props: ObjectToolbarProps) {
  return (
    <div class="edit-toolbar" role="toolbar" aria-label="Acciones del objeto">
      <Show when={props.isTable}>
        <Show
          when={props.editing}
          fallback={
            <>
              <Show
                when={props.editable}
                fallback={
                  <span class="edit-hint-ro">
                    Solo lectura: la tabla no tiene clave primaria.
                  </span>
                }
              >
                <button
                  class="edit-btn edit-btn-primary"
                  disabled={props.busy}
                  onClick={props.onEdit}
                >
                  Editar
                </button>
              </Show>
              <button class="edit-btn" onClick={props.onImport}>
                Importar
              </button>
              <button class="edit-btn" onClick={props.onGenerate}>
                Generar datos
              </button>
              <button class="edit-btn" onClick={props.onSchemaSync}>
                Sincronizar
              </button>
              <Show when={props.editable && props.hasColumns}>
                <button class="edit-btn" onClick={props.onDataSync}>
                  Sincronizar datos
                </button>
              </Show>
              <Show when={props.hasColumns}>
                <button class="edit-btn" onClick={props.onTransfer}>
                  Transferir
                </button>
              </Show>
            </>
          }
        >
          <button class="edit-btn" onClick={props.onAddRow}>
            ＋ Fila
          </button>
          <button
            class="edit-btn edit-btn-primary"
            disabled={props.busy || !props.hasChanges}
            onClick={props.onConfirm}
          >
            Confirmar ({props.changeCount})
          </button>
          <button
            class="edit-btn"
            disabled={props.busy}
            onClick={props.onDiscard}
          >
            Descartar
          </button>
        </Show>
        <Show when={props.error}>
          <span class="edit-error">{props.error}</span>
        </Show>
      </Show>

      <Show when={props.hasColumns}>
        <span class="toolbar-spacer" />
        <button class="edit-btn" onClick={props.onChart}>
          Graficar
        </button>
        <span class="export-label">Exportar:</span>
        <For each={props.exportFormats}>
          {(f) => (
            <button class="edit-btn" onClick={() => props.onExport(f.fmt)}>
              {f.label}
            </button>
          )}
        </For>
      </Show>
    </div>
  );
}
