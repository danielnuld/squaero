import { Show } from "solid-js";
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
      <Show when={props.isTable}>
        <Show
          when={props.editing}
          fallback={
            <>
              <Show
                when={props.editable}
                fallback={
                  <span class="edit-hint-ro">
                    {t("objbar.readOnlyNoPk")}
                  </span>
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
              <button class="edit-btn" onClick={props.onImport}>
                <span class="eb-ic" aria-hidden="true">↧</span> {t("objbar.import")}
              </button>
              <button class="edit-btn" onClick={props.onGenerate}>
                <span class="eb-ic" aria-hidden="true">✦</span> {t("objbar.generate")}
              </button>
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

      <Show when={props.hasColumns}>
        <span class="toolbar-spacer" />
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
