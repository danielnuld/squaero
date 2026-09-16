import { t } from "../utils/i18n";

// Floating bar over the grid while rows are marked (#517). Marking used to lead
// only to the right-click menu, and only from two rows up; this puts the same
// actions where the marked rows are. Presentational: the workspace owns the
// rows, the clipboard and whether the table can take new rows.
export function RowActionBar(props: {
  /** How many rows are marked (at least one while the bar shows). */
  count: number;
  /** Rows in the app's own copy; 0 means there is nothing to paste. */
  pasteCount: number;
  /** Why new rows cannot be added to this table, or null when they can. */
  addBlocked: string | null;
  onCopy: () => void;
  onCopyInsert: () => void;
  onDuplicate: () => void;
  onPaste: () => void;
  onClear: () => void;
}) {
  const pasteBlocked = () =>
    props.addBlocked ?? (props.pasteCount === 0 ? t("rowbar.nothingToPaste") : null);

  return (
    <div class="row-action-bar" role="toolbar" aria-label={t("rowbar.label")}>
      <span class="row-action-count">
        {props.count === 1 ? t("rowbar.markedOne") : t("rowbar.markedN", { n: props.count })}
      </span>
      <span class="toolbar-sep" aria-hidden="true" />
      <button class="edit-btn" onClick={() => props.onCopy()}>
        {t("rowbar.copy")} <kbd class="tab-kbd">Ctrl+C</kbd>
      </button>
      <button class="edit-btn" onClick={() => props.onCopyInsert()}>
        {t("rowbar.copyInsert")}
      </button>
      <button
        class="edit-btn"
        disabled={props.addBlocked !== null}
        title={props.addBlocked ?? t("rowbar.duplicateTitle")}
        onClick={() => props.onDuplicate()}
      >
        {t("rowbar.duplicate")} <kbd class="tab-kbd">Ctrl+D</kbd>
      </button>
      <button
        class="edit-btn"
        disabled={pasteBlocked() !== null}
        title={pasteBlocked() ?? t("rowbar.pasteTitle")}
        onClick={() => props.onPaste()}
      >
        {props.pasteCount > 0 ? t("rowbar.pasteN", { n: props.pasteCount }) : t("rowbar.paste")}
      </button>
      <span class="toolbar-sep" aria-hidden="true" />
      <button
        class="panel-icon-btn"
        aria-label={t("rowbar.clear")}
        title={t("rowbar.clear")}
        onClick={() => props.onClear()}
      >
        ✕
      </button>
    </div>
  );
}
