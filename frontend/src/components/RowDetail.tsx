import { For, Show, createMemo } from "solid-js";
import { NULL_LABEL } from "../utils/format";
import { buildRowFields, canStep } from "../utils/rowDetail";
import type { ResultColumn } from "../utils/query";
import { fkHint, type FkLookup } from "../utils/fkLookup";
import { FkPicker } from "./FkPicker";
import { t } from "../utils/i18n";

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
  /** Foreign-key pickers by column name (see utils/fkLookup): a FK field then
      edits as a single-line input suggesting the referenced table's rows. */
  fk?: Record<string, FkLookup>;
}) {
  const fields = createMemo(() =>
    buildRowFields(props.columns, props.row, props.editing ? props.edits : undefined),
  );
  const canPrev = () => canStep(props.rowIndex, -1, props.total);
  const canNext = () => canStep(props.rowIndex, 1, props.total);
  const fkFor = (col: string): FkLookup | undefined => props.fk?.[col];

  return (
    <div class="row-detail-dock" role="region" aria-label={t("rd.title")}>
      <div class="rd-head">
        <h2>{t("rd.title")}</h2>
        <div class="rd-nav">
          <button class="rd-nav-btn" disabled={!canPrev()} title={t("rd.prev")} onClick={props.onPrev}>
            ‹
          </button>
          <span class="rd-pos">
            {t("rd.position", { i: props.rowIndex + 1, total: props.total })}
          </span>
          <button class="rd-nav-btn" disabled={!canNext()} title={t("rd.next")} onClick={props.onNext}>
            ›
          </button>
          <button class="rd-nav-btn rd-close" title={t("rd.closeTitle")} onClick={props.onClose}>
            ✕
          </button>
        </div>
      </div>

      <Show when={props.deleted}>
        <div class="rd-deleted-banner">{t("rd.deletedBanner")}</div>
      </Show>

      <div class="rd-fields">
        <For each={fields()}>
          {(f) => (
            <div class={`rd-field ${f.edited ? "rd-edited" : ""}`}>
              <label class="rd-label" title={f.type}>
                <span class="rd-name">{f.name}</span>
                <span class="rd-type">{f.type}</span>
                <Show when={fkFor(f.name)}>
                  {(ref) => <span class="rd-fk-ref" title={t("rd.fkTitle")}>{fkHint(ref())}</span>}
                </Show>
                <Show when={f.edited}>
                  <span class="rd-edited-tag">{t("rd.editedTag")}</span>
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
                <Show
                  when={fkFor(f.name)}
                  fallback={
                    <textarea
                      class="rd-input"
                      rows={f.value && f.value.length > 60 ? 4 : 1}
                      value={f.value ?? ""}
                      onInput={(e) => props.onEditCell(f.name, e.currentTarget.value)}
                    />
                  }
                >
                  {(lookup) => (
                    <FkPicker
                      lookup={lookup()}
                      class="rd-input rd-fk-input"
                      value={f.value ?? ""}
                      onChange={(v) => props.onEditCell(f.name, v)}
                    />
                  )}
                </Show>
              </Show>
            </div>
          )}
        </For>
      </div>

      <div class="modal-actions rd-actions">
        <Show when={props.editable && !props.editing}>
          <button onClick={props.onBeginEdit}>{t("common.edit")}</button>
        </Show>
        <Show when={props.editing}>
          <button class={props.deleted ? "" : "danger"} onClick={props.onToggleDelete}>
            {props.deleted ? t("grid.undoDelete") : t("grid.deleteRow")}
          </button>
        </Show>
        <span class="toolbar-spacer" />
        <button class="primary" onClick={props.onClose}>
          {t("panel.close")}
        </button>
      </div>
    </div>
  );
}
