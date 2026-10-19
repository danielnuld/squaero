import { For, Show, type JSX } from "solid-js";
import { keyLabel } from "../utils/shortcuts";
import { openContextMenu, type MenuItem } from "../utils/contextMenu";
import { toolbarLayout, type ToolbarAction } from "../utils/objectToolbar";
import { t } from "../utils/i18n";
import { Icon, type IconName } from "./icons";

// The result toolbar (issue #688): one primary action, frequent actions with
// icon and text, the result's tools as icons, the rest under «Más». Which
// action goes where is decided by toolbarLayout (utils/objectToolbar.ts); this
// component only draws it. Purely presentational: the workspace owns the state
// and passes plain callbacks, so the transactional edit flow (begin → review →
// apply/commit; discard → rollback) is unchanged.
//
// There is no Editar button any more: a cell is edited in place (double click,
// F2 or typing), which opens the edit session. While one is open the toolbar
// leads with «Guardar (n)» and «Descartar».

/** One export format offered by the workspace (text formats + xlsx). */
export interface ExportFormatItem {
  fmt: string;
  label: string;
}

/** The views of a table that live in the same place on every one of its tabs. */
export type ObjectView = "data" | "structure" | "indexes" | "ddl";

const VIEWS: { id: ObjectView; label: string }[] = [
  { id: "data", label: "objview.data" },
  { id: "structure", label: "objview.structure" },
  { id: "indexes", label: "objview.indexes" },
  { id: "ddl", label: "objview.ddl" },
];

/** Datos · Estructura · Índices · DDL, as a segmented control. A view has no
    indexes of its own, so `noIndexes` leaves that one out. */
export function ObjectViewSwitch(props: {
  current: ObjectView;
  onPick: (v: ObjectView) => void;
  noIndexes?: boolean;
}) {
  return (
    <span class="seg" role="tablist" aria-label={t("objview.aria")}>
      <For each={props.noIndexes ? VIEWS.filter((v) => v.id !== "indexes") : VIEWS}>
        {(v) => (
          <button
            role="tab"
            class="seg-btn"
            classList={{ on: v.id === props.current }}
            aria-selected={v.id === props.current}
            onClick={() => v.id !== props.current && props.onPick(v.id)}
          >
            {t(v.label)}
          </button>
        )}
      </For>
    </span>
  );
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
   * Why the result is not editable, already translated (issue #718). Shown as
   * a read-only note on any tab, so nobody is left guessing why a double click
   * does nothing. Null/absent: nothing to say.
   */
  readOnlyReason?: string | null;
  /** The connection is read-only (issue #666): nothing that writes is offered. */
  readOnly?: boolean;
  /** An edit operation is in flight (disables mutating buttons). */
  busy: boolean;
  /** Current edit-session error, if any. */
  error?: string | null;
  /** Number of pending changes (label of the save button). */
  changeCount: number;
  /** True when there is at least one pending change (enables Guardar). */
  hasChanges: boolean;
  /** Why Guardar cannot run now (the connection is lost, R-05); absent = it can. */
  saveBlocked?: string;
  /** Export formats to offer. */
  exportFormats: ExportFormatItem[];
  /** Re-run what the tab is showing (issue #448). */
  onRefresh: () => void;
  /**
   * Why the refresh is unavailable, already translated; null when it can run.
   * The button is disabled and CARRIES the reason rather than disappearing.
   */
  refreshBlocked?: string | null;
  onImport: () => void;
  onGenerate: () => void;
  onSchemaSync: () => void;
  onDataSync: () => void;
  onTransfer: () => void;
  /** Add a new row (opening the edit session first when needed). */
  onAddRow: () => void;
  onConfirm: () => void;
  onDiscard: () => void;
  onChart: () => void;
  /** Columns as rows (issue #670). Absent → no button. Off while editing. */
  transposed?: boolean;
  onTranspose?: () => void;
  /** Keep this result aside (issue #669). Absent → no button. */
  onPin?: () => void;
  pinBlocked?: string | null;
  /** Open the "compare with…" menu (issue #669). Absent → no button. */
  onCompare?: (e: MouseEvent) => void;
  onExport: (fmt: string) => void;
  /** The page search row of the grid (local to the loaded rows). */
  searchOpen?: boolean;
  onSearch?: () => void;
  /** The table's filter panel (data tabs only). Absent → no Filtrar button. */
  filterOpen?: boolean;
  onFilter?: () => void;
  /** Conditions and sorts applied to the rows on screen: a chip on Filtrar. */
  filterCount?: number;
  /** Open the filter panel on a new sort line (R-22). */
  onSort?: () => void;
  /** Datos · Estructura · Índices · DDL (data tabs only). Absent → no switch. */
  onView?: (v: ObjectView) => void;
  /** The object is a view: the switch offers no «Índices». */
  isView?: boolean;
  /** Tab-level entries appended to «Más» (Plan, Historial, Snippets…). */
  moreItems?: MenuItem[];
  /** Shown while no edit session is open on an editable result. */
  editHint?: string;
}

export function ObjectToolbar(props: ObjectToolbarProps) {
  const layout = () =>
    toolbarLayout({
      isTable: props.isTable,
      hasColumns: props.hasColumns,
      editable: props.editable,
      readOnly: !!props.readOnly,
      canFilter: !!props.onFilter,
      canTranspose: !!props.onTranspose,
      canPin: !!props.onPin,
      canCompare: !!props.onCompare,
    });

  const exportMenu = (e: MouseEvent) =>
    openContextMenu(
      e,
      props.exportFormats.map((f) => ({ label: f.label, action: () => props.onExport(f.fmt) })),
    );

  const MORE: Partial<Record<ToolbarAction, () => MenuItem>> = {
    import: () => ({ label: t("objbar.import"), action: props.onImport, disabled: props.editing }),
    generate: () => ({ label: t("objbar.generate"), action: props.onGenerate, disabled: props.editing }),
    transfer: () => ({ label: t("objbar.transfer"), action: props.onTransfer }),
    syncSchema: () => ({ label: t("objbar.syncSchema"), action: props.onSchemaSync }),
    syncData: () => ({ label: t("objbar.syncData"), action: props.onDataSync }),
  };
  const moreMenu = (e: MouseEvent) => {
    const items = layout().more.map((id) => MORE[id]!());
    if (props.moreItems?.length) {
      if (items.length) items.push({ separator: true });
      items.push(...props.moreItems);
    }
    openContextMenu(e, items);
  };
  const hasMore = () => layout().more.length > 0 || (props.moreItems?.length ?? 0) > 0;

  /** A left-hand action: icon and text. */
  const ghost = (icon: IconName, label: string, extra: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button class="edit-btn" {...extra}>
      <Icon name={icon} size={14} class="eb-ic" /> {label}
    </button>
  );
  /** A right-hand tool: icon only, named. */
  const tool = (icon: IconName, label: string, extra: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button class="edit-btn edit-btn-icon" aria-label={label} title={label} {...extra}>
      <Icon name={icon} size={14} />
    </button>
  );

  const MAIN: Record<string, () => JSX.Element> = {
    refresh: () =>
      ghost("refresh", t("objbar.refresh"), {
        title: props.refreshBlocked ?? t("objbar.refreshTitle"),
        disabled: !!props.refreshBlocked,
        onClick: () => props.onRefresh(),
      }),
    filter: () => (
      <button
        class="edit-btn"
        title={t("objbar.filterTitle")}
        aria-pressed={!!props.filterOpen}
        onClick={() => props.onFilter?.()}
      >
        <Icon name="filter" size={14} class="eb-ic" /> {t("objbar.filter")}
        <Show when={(props.filterCount ?? 0) > 0}>
          <span class="edit-btn-count" title={t("objbar.filterCount", { n: props.filterCount! })}>
            {props.filterCount}
          </span>
        </Show>
      </button>
    ),
    sort: () =>
      ghost("sort", t("objbar.sort"), {
        title: t("objbar.sortTitle"),
        onClick: () => props.onSort?.(),
      }),
    search: () =>
      ghost("search", t("objbar.search"), {
        title: t("objbar.searchTitle", { keys: keyLabel("Mod+F") }),
        "aria-pressed": !!props.searchOpen,
        onClick: () => props.onSearch?.(),
      }),
    addRow: () =>
      ghost("plus", t("objbar.addRow"), {
        title: t("objbar.addRowTitle"),
        disabled: props.busy,
        onClick: () => props.onAddRow(),
      }),
  };
  const SIDE: Record<string, () => JSX.Element> = {
    transpose: () =>
      tool("transpose", t("objbar.transpose"), {
        title: t("objbar.transposeTitle"),
        "aria-pressed": !!props.transposed,
        disabled: props.editing,
        onClick: () => props.onTranspose?.(),
      }),
    pin: () =>
      tool("pin", t("pin.pin"), {
        title: props.pinBlocked ?? t("pin.pinTitle"),
        disabled: !!props.pinBlocked,
        onClick: () => props.onPin?.(),
      }),
    compare: () =>
      tool("compare", t("pin.compare"), {
        title: t("pin.compareTitle"),
        "aria-haspopup": "menu",
        onClick: (e: MouseEvent) => props.onCompare?.(e),
      }),
    chart: () => tool("chart", t("objbar.chart"), { onClick: () => props.onChart() }),
    export: () => (
      <button
        class="edit-btn edit-btn-menu"
        aria-haspopup="menu"
        title={t("objbar.exportTitle")}
        onClick={exportMenu}
      >
        <Icon name="export" size={14} class="eb-ic" /> {t("objbar.export")}{" "}
        <Icon name="chevron-down" size={12} class="eb-caret" />
      </button>
    ),
  };

  return (
    <div class="edit-toolbar" role="toolbar" aria-label={t("objbar.aria")}>
      <Show when={props.onView}>
        <ObjectViewSwitch current="data" noIndexes={props.isView} onPick={(v) => props.onView!(v)} />
        <span class="toolbar-sep" aria-hidden="true" />
      </Show>
      <Show when={props.editing}>
        <button
          class="edit-btn edit-btn-primary"
          disabled={props.busy || !props.hasChanges || !!props.saveBlocked}
          title={props.saveBlocked}
          onClick={() => props.onConfirm()}
        >
          <Icon name="save" size={14} class="eb-ic" /> {t("objbar.save", { n: props.changeCount })}
        </button>
        <button class="edit-btn" disabled={props.busy} onClick={() => props.onDiscard()}>
          {t("objbar.discard")}
        </button>
        <span class="toolbar-sep" aria-hidden="true" />
      </Show>
      <For each={layout().main}>{(id) => MAIN[id]()}</For>
      <Show when={!props.editable && (props.isTable || props.readOnlyReason)}>
        <span class="edit-hint-ro" role="note">
          <Icon name="lock" size={12} />{" "}
          {props.readOnlyReason ??
            t(props.readOnly ? "safe.readOnlyHint" : "objbar.readOnly.noPk")}
        </span>
      </Show>
      <Show when={props.editable && !props.editing && props.editHint}>
        <span class="edit-hint">{props.editHint}</span>
      </Show>
      <Show when={props.error}>
        <span class="edit-error" role="alert">{props.error}</span>
      </Show>
      <span class="toolbar-spacer" />
      <For each={layout().side}>{(id) => SIDE[id]()}</For>
      <Show when={hasMore()}>
        <button
          class="edit-btn edit-btn-icon"
          aria-haspopup="menu"
          aria-label={t("objbar.more")}
          title={t("objbar.more")}
          onClick={moreMenu}
        >
          <Icon name="more" size={14} />
        </button>
      </Show>
    </div>
  );
}
