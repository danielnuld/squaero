import { Show } from "solid-js";
import type { PkMode } from "../utils/rowPaste";
import { t } from "../utils/i18n";

// Floating bar over the grid while new rows wait to be saved (#517). It says
// how many there are and whether any is already known to collide, and holds the
// choices a paste leaves open: generate or keep the copied key, and whether
// empty cells of pasted text are NULL. Saving goes through the usual SQL
// preview, so there is one "review and save" rather than a separate "see SQL".
// Presentational: the workspace owns the rows and the session.
export function PendingRowsBar(props: {
  count: number;
  /** Pending rows with a cell already known to collide. */
  conflicts: number;
  /** The last paste's key mode; null when the rows were added by hand. */
  pkMode: PkMode | null;
  /** The last paste's empty-cell choice; null unless it was pasted text. */
  emptyAsNull: boolean | null;
  /** Copied columns the table does not have. */
  ignoredColumns: string[];
  busy: boolean;
  /** The last paste can be handed to the import wizard instead. */
  canImport: boolean;
  onTogglePk: () => void;
  onToggleEmptyAsNull: () => void;
  onReview: () => void;
  onDiscard: () => void;
  onImport: () => void;
}) {
  const blocked = () => props.conflicts > 0;

  return (
    <div class="row-action-bar" role="toolbar" aria-label={t("pending.label")}>
      <span class="row-action-count">
        {props.count === 1 ? t("pending.rowsOne") : t("pending.rowsN", { n: props.count })}
      </span>
      <Show when={blocked()}>
        <span class="edit-error">
          {props.conflicts === 1
            ? t("pending.conflictsOne")
            : t("pending.conflictsN", { n: props.conflicts })}
        </span>
      </Show>
      <Show when={props.ignoredColumns.length > 0}>
        <span class="pending-notice">
          {t("pending.ignored", { cols: props.ignoredColumns.join(", ") })}
        </span>
      </Show>
      <Show when={props.pkMode !== null || props.emptyAsNull !== null}>
        <span class="toolbar-sep" aria-hidden="true" />
      </Show>
      <Show when={props.pkMode !== null}>
        <button
          class="chip"
          aria-pressed={props.pkMode === "keep"}
          title={t("pending.keyTitle")}
          onClick={() => props.onTogglePk()}
        >
          {props.pkMode === "generate" ? t("pending.keyGenerate") : t("pending.keyKeep")}
        </button>
      </Show>
      <Show when={props.emptyAsNull !== null}>
        <button
          class="chip"
          aria-pressed={props.emptyAsNull === true}
          onClick={() => props.onToggleEmptyAsNull()}
        >
          {props.emptyAsNull ? t("pending.emptyNullOn") : t("pending.emptyNullOff")}
        </button>
      </Show>
      <span class="toolbar-sep" aria-hidden="true" />
      <Show when={props.canImport}>
        <button class="edit-btn" disabled={props.busy} onClick={() => props.onImport()}>
          {t("pending.import")}
        </button>
      </Show>
      <button class="edit-btn" disabled={props.busy} onClick={() => props.onDiscard()}>
        {t("pending.discard")}
      </button>
      <button
        class="edit-btn edit-btn-primary"
        disabled={props.busy || blocked()}
        title={blocked() ? t("pending.blocked") : undefined}
        onClick={() => props.onReview()}
      >
        {t("pending.review")} <kbd class="tab-kbd">Ctrl+S</kbd>
      </button>
    </div>
  );
}
