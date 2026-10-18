import { Show, createUniqueId, type JSX } from "solid-js";
import { openContextMenu, type MenuItem } from "../utils/contextMenu";
import { t } from "../utils/i18n";

// Contextual object-action toolbar (design proposal, phases 2b + 8). It sits
// above the result grid and consolidates every action that applies to the
// object shown in the tab — edit lifecycle, import/generate/sync, transfer,
// chart and export. Purely presentational: the workspace owns all state and
// passes plain callbacks, so the transactional-edit flow (begin → confirm
// preview → apply/commit; discard → rollback) is unchanged.
//
// Phase 8 (density + clarity): each button carries a leading glyph, and the two
// families that used to sprawl across the bar collapse into dropdown menus —
// "Sincronizar ▾" (Estructura / Datos, which also kills the old ambiguity
// between "Sincronizar" and "Sincronizar datos") and "Exportar ▾" (every
// format). The dropdowns reuse the app's single context-menu renderer.
//
// The primary action is highlighted with .edit-btn-primary and is contextual:
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
  /**
   * Why the result is not editable, already translated (issue #718). Editar
   * then stays on screen, disabled, and carries the reason — on a query tab
   * too, where hiding it left the user guessing. Null/absent: nothing to say.
   */
  readOnlyReason?: string | null;
  /** The connection is read-only (issue #666): nothing that writes is offered. */
  readOnly?: boolean;
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
  /** Re-run what the tab is showing (issue #448). */
  onRefresh: () => void;
  /**
   * Why the refresh is unavailable, already translated; null when it can run.
   * The button is disabled and CARRIES the reason rather than disappearing —
   * the same rule as the related-data entry (#344).
   */
  refreshBlocked?: string | null;
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
  /** Columns as rows (issue #670): whether it is on, and the toggle. Absent →
      no button. Off while editing: the transposed view is read-only. */
  transposed?: boolean;
  onTranspose?: () => void;
  /** Keep this result aside (issue #669). Absent → no button; `pinBlocked`
      (translated) disables it and says why. */
  onPin?: () => void;
  pinBlocked?: string | null;
  /** Open the "compare with…" menu (issue #669). Absent → no button. */
  onCompare?: (e: MouseEvent) => void;
  onExport: (fmt: string) => void;
  /**
   * Actions that belong to the tab rather than to the object, dropped in the
   * middle of the bar. A data tab has no editor, so its Plan / Historial /
   * Snippets buttons had a 29 px band of their own directly above this one;
   * they ride here instead (issue #386).
   */
  children?: JSX.Element;
}

export function ObjectToolbar(props: ObjectToolbarProps) {
  const reasonId = createUniqueId();
  // Build the "Sincronizar ▾" menu: schema always, data only for an editable
  // table with a result (the old conditional, now spelled out unambiguously).
  const openSyncMenu = (e: MouseEvent) => {
    const items: MenuItem[] = [
      { label: t("objbar.syncSchema"), action: props.onSchemaSync },
    ];
    if (props.editable && props.hasColumns) {
      items.push({ label: t("objbar.syncData"), action: props.onDataSync });
    }
    openContextMenu(e, items);
  };

  const openExportMenu = (e: MouseEvent) =>
    openContextMenu(
      e,
      props.exportFormats.map((f) => ({
        label: f.label,
        action: () => props.onExport(f.fmt),
      })),
    );

  return (
    <div class="edit-toolbar" role="toolbar" aria-label={t("objbar.aria")}>
      {/* First in the bar, and there for every result — a query tab's page is as
          stale as a table's when something else writes to the database. The tree
          has its own refresh; this one re-runs what is on screen (issue #448). */}
      <button
        class="edit-btn"
        title={props.refreshBlocked ?? t("objbar.refreshTitle")}
        disabled={!!props.refreshBlocked}
        onClick={props.onRefresh}
      >
        <span class="eb-ic" aria-hidden="true">⟳</span> {t("objbar.refresh")}
      </button>
      <span class="toolbar-sep" aria-hidden="true" />
      <Show when={props.isTable || props.readOnlyReason}>
        <Show
          when={props.editing}
          fallback={
            <>
              <Show
                when={props.editable}
                fallback={
                  <>
                    <button
                      class="edit-btn edit-btn-primary"
                      disabled
                      aria-describedby={reasonId}
                    >
                      <span class="eb-ic" aria-hidden="true">✎</span> {t("common.edit")}
                    </button>
                    <span id={reasonId} class="edit-hint-ro">
                      {props.readOnlyReason ??
                        t(props.readOnly ? "safe.readOnlyHint" : "objbar.readOnly.noPk")}
                    </span>
                  </>
                }
              >
                <button
                  class="edit-btn edit-btn-primary"
                  disabled={props.busy}
                  onClick={props.onEdit}
                >
                  <span class="eb-ic" aria-hidden="true">✎</span> {t("common.edit")}
                </button>
              </Show>
              <Show when={props.isTable}>
                {/* Import and generate write into this table. */}
                <Show when={!props.readOnly}>
                  <button class="edit-btn" onClick={props.onImport}>
                    <span class="eb-ic" aria-hidden="true">↧</span> {t("objbar.import")}
                  </button>
                  <button class="edit-btn" onClick={props.onGenerate}>
                    <span class="eb-ic" aria-hidden="true">✦</span> {t("objbar.generate")}
                  </button>
                </Show>
                <button
                  class="edit-btn edit-btn-menu"
                  aria-haspopup="menu"
                  title={t("objbar.syncTitle")}
                  onClick={openSyncMenu}
                >
                  <span class="eb-ic" aria-hidden="true">⇅</span> {t("objbar.sync")}{" "}
                  <span class="eb-caret" aria-hidden="true">▾</span>
                </button>
                <Show when={props.hasColumns}>
                  <button class="edit-btn" onClick={props.onTransfer}>
                    <span class="eb-ic" aria-hidden="true">⇄</span> {t("objbar.transfer")}
                  </button>
                </Show>
              </Show>
            </>
          }
        >
          <button class="edit-btn" onClick={props.onAddRow}>
            <span class="eb-ic" aria-hidden="true">＋</span> {t("objbar.addRow")}
          </button>
          <button
            class="edit-btn edit-btn-primary"
            disabled={props.busy || !props.hasChanges}
            onClick={props.onConfirm}
          >
            <span class="eb-ic" aria-hidden="true">✓</span> {t("objbar.confirm", { n: props.changeCount })}
          </button>
          <button
            class="edit-btn"
            disabled={props.busy}
            onClick={props.onDiscard}
          >
            {t("objbar.discard")}
          </button>
        </Show>
        <Show when={props.error}>
          <span class="edit-error">{props.error}</span>
        </Show>
      </Show>

      {props.children}

      <Show when={props.hasColumns}>
        <span class="toolbar-spacer" />
        <Show when={props.onTranspose}>
          <button
            class="edit-btn"
            aria-pressed={!!props.transposed}
            disabled={props.editing}
            title={t("objbar.transposeTitle")}
            onClick={() => props.onTranspose?.()}
          >
            <span class="eb-ic" aria-hidden="true">⇄</span> {t("objbar.transpose")}
          </button>
        </Show>
        <Show when={props.onPin}>
          <button
            class="edit-btn"
            disabled={!!props.pinBlocked}
            title={props.pinBlocked ?? t("pin.pinTitle")}
            onClick={() => props.onPin?.()}
          >
            <span class="eb-ic" aria-hidden="true">📌</span> {t("pin.pin")}
          </button>
        </Show>
        <Show when={props.onCompare}>
          <button
            class="edit-btn edit-btn-menu"
            aria-haspopup="menu"
            title={t("pin.compareTitle")}
            onClick={(e) => props.onCompare?.(e)}
          >
            {t("pin.compare")} <span class="eb-caret" aria-hidden="true">▾</span>
          </button>
        </Show>
        <button class="edit-btn" onClick={props.onChart}>
          <span class="eb-ic" aria-hidden="true">📊</span> {t("objbar.chart")}
        </button>
        <button
          class="edit-btn edit-btn-menu"
          aria-haspopup="menu"
          title={t("objbar.exportTitle")}
          onClick={openExportMenu}
        >
          <span class="eb-ic" aria-hidden="true">↥</span> {t("objbar.export")}{" "}
          <span class="eb-caret" aria-hidden="true">▾</span>
        </button>
      </Show>
    </div>
  );
}
