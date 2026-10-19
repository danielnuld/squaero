import { countText } from "../utils/confirmText";
import { For, Index, Show, createEffect, createMemo, createSignal, on, onCleanup, untrack, type JSX } from "solid-js";
import { keyLabel, keyParams } from "../utils/shortcuts";
import { visibleRange, needsMoreRows } from "../utils/virtualize";
import { cellAlign, boolTo01, classifyType, NULL_LABEL, withScale } from "../utils/format";
import { displayText, type DisplayOptions } from "../utils/gridDisplay";
import type { GridStyle } from "../utils/settings";
import { moveSelection, scrollRowIntoView, isNavKey, type CellPos } from "../utils/gridNav";
import {
  buildViewIndices,
  cycleSort,
  sortIcon,
  type SortState,
  type ColumnFilters,
  searchTerms,
} from "../utils/gridView";
import { computeColumnWidths, resizeColumn, MIN_COL_WIDTH } from "../utils/gridColumns";
import {
  defaultOrder,
  moveColumn,
  displayIndex,
} from "../utils/gridColumnOrder";
import { toggleMark, markRange, orderedMarks, type RowMarks } from "../utils/rowSelection";
import type { ResultSet } from "../utils/query";
import { rowChange, type PendingChanges } from "../utils/editSession";
import { inRange, rangeBetween, rangeCellCount, rangeToTsv } from "../utils/gridRange";
import { copyText } from "../utils/rowCopy";
import type { PkMode } from "../utils/rowPaste";
import type { FkLookup } from "../utils/fkLookup";
import { FkPicker } from "./FkPicker";
import { cellEditorKey, gridEditKey } from "../utils/cellEditKeys";
import { Icon, IconKey, IconRelated, IconSearch } from "./icons";
import { t } from "../utils/i18n";

const DEFAULT_ROW_HEIGHT = 28;
const ACTION_WIDTH = 36;
/** The row-number column that doubles as the mark checkbox. */
const MARK_WIDTH = 44;

/**
 * Edit hooks passed by the workspace when the active tab is in edit mode over an
 * editable (primary-keyed) table. When absent or `active` is false the grid is
 * read-only, exactly as before.
 */
export interface GridEdit {
  active: boolean;
  pending: PendingChanges;
  /** `null` is a SQL NULL, distinct from "" (issue #398). */
  onEditCell: (rowIndex: number, column: string, value: string | null) => void;
  /** Drop one cell's pending edit (Esc in its editor puts the value back).
      Absent → Esc writes the original value back as an edit. */
  onRevertCell?: (rowIndex: number, column: string) => void;
  onToggleDelete: (rowIndex: number) => void;
  /** Delete key on the grid: the marked rows, or the selected cell's row (#644). */
  onToggleDeleteRows?: (rows: number[]) => void;
  onInsertCell: (insertIndex: number, column: string, value: string | null) => void;
  onRemoveInsert: (insertIndex: number) => void;
  /** The table's primary key, so a new row whose key is generated shows it as
      `auto` instead of an input (#517). */
  pkColumns?: string[];
  /** What a new row does with its key; absent → every key is an input. */
  pkModeOf?: (insertIndex: number) => PkMode;
  /** New rows with cells already known to collide: insert index -> columns. */
  conflicts?: Map<number, string[]>;
  /** The new row whose insert failed on the last save, or null. */
  failedInsert?: number | null;
}

// Virtualized result grid: only the rows intersecting the viewport are in the
// DOM (see .rules/frontend.md §2). The spacer carries the full scroll height; a
// translateY offsets the rendered window. Pagination is delegated to onNeedMore
// when the user scrolls near the end of a truncated dataset. Cell formatting is
// driven by each column's neutral type (src/utils/format.ts). In edit mode the
// cells become inputs and a leading action column toggles row deletion;
// newly-inserted rows render in a separate section below the grid.
export function ResultGrid(props: {
  result: ResultSet | null;
  loading: boolean;
  error: string | null;
  /** Called when more rows should be fetched (truncated dataset, near bottom). */
  onNeedMore?: () => void;
  /** Edit hooks; when active, cells are editable. */
  edit?: GridEdit;
  /** Right-click on a data cell; the workspace builds the copy/export menu. */
  onCellContext?: (e: MouseEvent, rowIndex: number, colIndex: number) => void;
  /** Row height in px (grid density, issue #181). Drives both the virtualization
      math and the cell CSS (via the --grid-row-h var) so they never diverge. */
  rowHeight?: number;
  /**
   * How the grid is drawn and read (issue #540). Every visual difference lives
   * in CSS under `:root[data-grid-style]`; what the component takes it for is
   * the text a cell shows, which the "informe" style formats. Absent →
   * "registro", so a panel that does not care keeps the default.
   */
  gridStyle?: GridStyle;
  /** How values read beyond the style (Ajustes › Rejilla): numbers raw or
      regional, NULL's text, the language. Pixels only: copies, filters and
      saves read `result.rows`. Absent → raw numbers and «NULL». */
  display?: DisplayOptions;
  /** The type on a second line under each column name (R-13); on unless false. */
  headerTypes?: boolean;
  /** Rich content for the no-result state (issue #178). When absent a plain
      "run a query" message is shown. Only rendered before the tab has a result. */
  emptyState?: JSX.Element;
  /** Shown under the error message (the engine's code, «¿Querías …?», #691). */
  errorExtra?: JSX.Element;
  /** Ask the workspace to enter edit mode (double-click, F2, Enter or typing on
      a cell of an editable table; Supr and Ctrl+Mayús+N too). The grid waits
      for it and then carries on with what the key asked for. No-op when
      absent → the grid stays read-only. */
  onRequestEdit?: () => void | Promise<void>;
  /** Space on a selected cell: open its row in the row detail. */
  onRowDetail?: (rowIndex: number) => void;
  /**
   * Enter or double-click on a row of a grid that is not edited — a picker's
   * "choose this one" (the FK browser, A-40). Absent → nothing.
   */
  onRowActivate?: (rowIndex: number) => void;
  /** Cancel the running query (op.cancel). When present, a Cancelar button shows
      alongside the "Ejecutando…" state; absent → no cancel affordance. */
  onCancel?: () => void;
  /** Why the engine cannot cancel (#668). When set, the Cancelar button stays
      visible but disabled, with this as its tooltip. */
  cancelDisabledReason?: string;
  /** Foreign-key pickers, by column name: an editable FK cell then suggests the
      referenced table's rows instead of demanding a remembered id. Absent → the
      cells are plain free-text inputs, exactly as before. */
  fk?: Record<string, FkLookup>;
  /** Columns other tables reference (issue #310). Marked in the header, so the
      user can see where "datos relacionados" is available without probing. */
  referencedColumns?: string[];
  /**
   * Open the related data of one cell. Given together with `referencedColumns`,
   * every cell of a referenced column is underlined and grows an arrow on hover
   * or when selected — the feature was only reachable through the right-click
   * menu, which meant nobody found it. The arrow is a MOUSE affordance and stays
   * out of the tab order (a page of rows would otherwise add a tab stop per
   * cell); the keyboard route is the cell menu, which is where it already was.
   */
  onRelated?: (rowIndex: number, colIndex: number) => void;
  /**
   * The row the selection sits on, by index into `result.rows`, or null when
   * nothing is selected (#372). A panel whose rows carry actions — kill this
   * session, explain this query — uses it to act on the selected row from the
   * panel bar, instead of growing a column of buttons the grid has no place
   * for. Fires for keyboard navigation too, since that moves the same selection.
   */
  onSelectedRowChange?: (rowIndex: number | null) => void;
  /**
   * The cells the selection covers (issues #670, #690), for the status-bar
   * summary: the block of cells selected (columns as ORIGINAL indices in the
   * order drawn, rows as indices into `result.rows`), or the focused cell's
   * column over the marked rows when rows are marked and no block is. Null
   * when no cell is selected.
   */
  onSelectedCellsChange?: (cells: { columns: number[]; rows: number[] } | null) => void;
  /**
   * Where each foreign-key column points, by column name ("clientes.id"). The
   * header then says it: an arrow beside the name and "integer → clientes.id"
   * on the type line (issue #690). Absent → no column is shown as a key.
   */
  foreignKeys?: Record<string, string>;
  /**
   * Whether the page search row ("Buscar en la página", per-column and LOCAL to
   * the loaded rows) is open. Hidden by default (issue #690); Ctrl+F on the grid
   * toggles it. Given, the workspace drives it — a toolbar toggle — and hears
   * the grid's own toggles through `onSearchOpenChange`.
   */
  searchOpen?: boolean;
  onSearchOpenChange?: (open: boolean) => void;
  /** How many loaded rows the page search leaves, or null while it hides
      none — for the status bar (A-05). */
  onSearchCountChange?: (shown: number | null) => void;
  /** «Filtrar en la tabla» (R-21): the page search's boxes as server-side
      conditions. Absent → no button (only a table tab has the filter panel). */
  onFilterTable?: (terms: { column: string; value: string }[]) => void;
  /** Print a changed cell's original value struck through beside the new one,
      instead of only in its tooltip (issue #690). Off by default. */
  showOldValues?: boolean;
  /**
   * Sort at the SERVER instead of in the browser (issue #347). Given, a header
   * click hands the column name up rather than reordering the rows already
   * fetched — which over a truncated result reordered an arbitrary sample. The
   * current server sort comes back as `sortedColumn` so the header can show it.
   */
  onSortColumn?: (column: string) => void;
  sortedColumn?: { column: string; dir: "ASC" | "DESC" } | null;
  /**
   * The rows the user marked (issue #382), by index into `result.rows` and in
   * view order. The workspace turns them into copy / transfer actions; the grid
   * only owns the marking. Fires with an empty list when the marks are cleared,
   * including when a new result loads.
   */
  onMarkedRowsChange?: (rows: number[]) => void;
  /** The table's primary key columns. Marked in the header so a grid of rows
      from a table you did not open says which column identifies each one —
      asked for on the related-data modal, where the rows belong to a table the
      user never chose and whose key they have no reason to know. */
  keyColumns?: string[];
  /**
   * The columns' display order (issue #446), as ORIGINAL column indices in the
   * order they are drawn. Emitted whenever the user drags a header, and reset to
   * the engine's own order by every new result. The workspace uses it so that
   * copying a row copies what the user sees; the grid needs nothing back.
   */
  onColumnOrderChange?: (order: number[]) => void;
  /**
   * Ctrl+C on the grid (#517): the marked rows, or else the selected cell's row,
   * by index into `result.rows`. Absent → the key is left to the browser.
   */
  onCopyRows?: (rows: number[], withHeader?: boolean) => void;
  /** Ctrl+D: the same rows, to add again as new pending rows. Absent → no-op. */
  onDuplicateRows?: (rows: number[]) => void;
  /**
   * The neutral type of one cell when it is not its column's (issue #670): in
   * the transposed view each ROW is a source column, so a cell is formatted by
   * its row. Undefined → the column's type, as everywhere else.
   */
  cellType?: (rowIndex: number, colIndex: number) => string | undefined;
  /** Extra classes for one read-only cell (issue #669: a comparison's added,
      removed and changed cells). Undefined → none. */
  cellClass?: (rowIndex: number, colIndex: number) => string | undefined;
  /** Decimal places per column name, from the table's declared types
      (numeric(10,2) → 2): numbers are drawn padded to them (A-39). */
  scales?: Record<string, number>;
  /** Bumped by the workspace to clear the marks (the row bar's ✕). */
  clearMarksTick?: number;
}) {
  const rowHeight = () => props.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const isReferenced = (name: string) =>
    !!props.referencedColumns?.some((c) => c.toLowerCase() === name.toLowerCase());
  const isKey = (name: string) =>
    !!props.keyColumns?.some((c) => c.toLowerCase() === name.toLowerCase());
  const fkFor = (col: string): FkLookup | undefined => props.fk?.[col];
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportH, setViewportH] = createSignal(0);
  let scrollerEl: HTMLDivElement | undefined;

  // Keyboard selection (spreadsheet-style): a selected cell keyed by its VIEW
  // position (r) and column (c). Click selects; arrow keys move; double-click,
  // F2, Enter or typing open the cell's editor.
  const [sel, setSel] = createSignal<CellPos | null>(null);
  // The one cell being edited (R-14): only it is an input, every other cell
  // keeps its type colours and its NULL tag. Keyed by ORIGINAL row and column,
  // so a sort or the page search does not move it to another row. `before` is
  // what Esc puts back: the pending edit the cell had when the editor opened.
  const [editCell, setEditCell] = createSignal<{
    row: number;
    c: number;
    had: boolean;
    before: string | null;
    browse: boolean;
  } | null>(null);

  // Multi-row marking (issue #382): ctrl/cmd+click toggles a row, shift+click
  // and shift+arrows extend from the anchor, ctrl+A takes the whole view. Marks
  // are ORIGINAL row indices so they survive sorting; the anchor is a VIEW
  // position, so it is dropped whenever the view is reordered.
  const [marks, setMarks] = createSignal<RowMarks>(new Set<number>());
  const [anchor, setAnchor] = createSignal<number | null>(null);
  // The fixed corner of the selected block of cells (issue #690): Shift+arrows,
  // Shift+click and dragging move `sel`, the other corner, and leave this one.
  // Same keys as `sel`: a view position and an ORIGINAL column index.
  const [cellAnchor, setCellAnchor] = createSignal<CellPos | null>(null);
  const isMarked = (rowIndex: number) => marks().has(rowIndex);
  const clearSel = () => {
    setSel(null);
    setAnchor(null);
    setCellAnchor(null);
    setMarks(new Set<number>());
  };
  // The workspace clears the marks from outside (the row bar's ✕) by bumping a
  // counter; only a CHANGE clears, so mounting with any value does nothing.
  let lastClearTick = props.clearMarksTick ?? 0;
  createEffect(() => {
    const tick = props.clearMarksTick ?? 0;
    if (tick === lastClearTick) return;
    lastClearTick = tick;
    setMarks(new Set<number>());
  });

  // The scroller is rendered only once a result with columns exists, and it can
  // come and go across queries, so we measure it from a callback ref rather than
  // onMount (which fires once, possibly before any result). This attaches — and
  // re-attaches — a ResizeObserver whenever the scroller element appears.
  let ro: ResizeObserver | undefined;
  const attachScroller = (el: HTMLDivElement) => {
    scrollerEl = el;
    // A remounted scroller starts at the top, but `scrollTop` only ever moves on
    // its onScroll — so without this the virtualized window would keep computing
    // from the position the OLD element had, and render the new result's rows
    // outside the viewport (a blank grid until the user scrolls). The scroller is
    // destroyed and recreated whenever an error replaces the grid, which is how
    // this showed up: query, syntax error, valid query -> nothing (issue #313).
    setScrollTop(el.scrollTop);
    setViewportH(el.clientHeight);
    ro?.disconnect();
    ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
  };
  onCleanup(() => ro?.disconnect());

  // The new-rows section lives OUTSIDE the scroller (so it never scrolls out of
  // view vertically) but shares its column widths, so their horizontal scrolls
  // are kept in lockstep — each pane's onScroll assigns the other's scrollLeft
  // (assigning an equal value fires no event, so this cannot loop).
  let insertsEl: HTMLDivElement | undefined;
  const attachInserts = (el: HTMLDivElement) => {
    insertsEl = el;
    el.scrollLeft = scrollerEl?.scrollLeft ?? 0;
  };

  const cols = () => props.result?.columns ?? [];
  const rows = () => props.result?.rows ?? [];
  const style = () => props.gridStyle ?? "registro";
  const editing = () => props.edit?.active ?? false;
  const typeOf = (rowIndex: number, ci: number, columnType: string) =>
    props.cellType?.(rowIndex, ci) ?? columnType;

  /**
   * The rows as they will be SHOWN, for measuring column widths only.
   *
   * Outside the report style this is `rows()` itself — same array, no copy —
   * so the common case pays nothing.
   */
  /**
   * The columns as the WIDTH MATH should see them: with the marks the header
   * draws beside the name. A key column called "id" sized to two characters is
   * what put the key icon on top of its own name.
   */
  const measuredCols = () =>
    cols().map((col) => ({
      ...col,
      marks: (isKey(col.name) ? 1 : 0) + (isReferenced(col.name) ? 1 : 0),
    }));

  // What the cells show, for sizing the columns: the raw rows unless the
  // style or the display settings change the text.
  const shownRows = () => {
    const d = props.display;
    if (style() !== "informe" && d?.numbers !== "regional" && !d?.nullText) return rows();
    const columns = cols();
    return rows().map((row, ri) =>
      row.map(
        (value, ci) =>
          displayText(value, typeOf(ri, ci, columns[ci]?.type ?? "text"), style(), t, d).text,
      ),
    );
  };

  // Client-side sort + filter over the loaded page (issue #132). The view is a
  // list of ORIGINAL row indices in display order, so edit hooks stay keyed by
  // original index. Both reset whenever a new result loads.
  const [sort, setSort] = createSignal<SortState | null>(null);
  const [filters, setFilters] = createSignal<ColumnFilters>({});
  // Per-column widths (issue: grid visual pass). Seeded content-aware from the
  // new result and then adjustable by dragging the header resize handles.
  const [widths, setWidths] = createSignal<number[]>([]);
  // Column display order (issue #446): ORIGINAL indices in the order drawn. Only
  // the rendering reads it — widths, sort, filters, the edit session and the
  // context menu all stay keyed by the original index, exactly as the row view
  // keeps its original row indices under a sort.
  const [colOrder, setColOrder] = createSignal<number[]>([]);
  // Re-measure when the style changes what a cell shows, WITHOUT the reset
  // below: switching style is not loading a result, so the sort, the filters,
  // the selection and the scroll position all stay where the user left them.
  // Widths the user dragged are lost — the same as any other re-measure.
  createEffect(
    on(
      style,
      () => setWidths(computeColumnWidths(measuredCols(), shownRows())),
      { defer: true },
    ),
  );

  createEffect(() => {
    props.result; // reset on identity change
    setEditCell(null);
    setSort(null);
    setFilters({});
    clearSel();
    // Measured with the text that will be SHOWN: in the report style "1,250.00"
    // and "14 feb 2023" are wider than what the core sent, and a column sized to
    // the raw value would clip them.
    //
    // UNTRACKED, and that is the point: this effect RESETS the view, so it must
    // fire for a new result and for nothing else. Measuring now reads the key
    // and referenced columns, which arrive on their own schedule — tracked, a
    // late-arriving key list would re-run the reset and wipe the user's filters
    // and selection mid-edit. Two Informix tests caught exactly that.
    untrack(() => {
      setWidths(computeColumnWidths(measuredCols(), shownRows()));
    });
    setColOrder(defaultOrder(cols().length));
    // A new result is read from its first row: the scroller survives when one
    // result replaces another, so its position would otherwise carry over into
    // rows that have nothing to do with the old ones (issue #313).
    setScrollTop(0);
    if (scrollerEl) scrollerEl.scrollTop = 0;
  });
  const view = createMemo(() => buildViewIndices(rows(), cols(), sort(), filters()));
  const filtersActive = () => Object.values(filters()).some((q) => q.trim() !== "");
  createEffect(() => props.onSearchCountChange?.(filtersActive() ? view().length : null));

  // The page search row (issue #690): closed by default, since it only ever
  // searches the loaded rows and an always-open row of boxes read as a filter
  // of the whole table. Closing it drops what it was hiding.
  const [searchOn, setSearchOn] = createSignal(false);
  createEffect(() => {
    if (props.searchOpen !== undefined) setSearchOn(props.searchOpen);
  });
  createEffect(
    on(
      searchOn,
      (open) => {
        if (!open && untrack(filtersActive)) {
          setFilters({});
          clearSel();
        }
      },
      { defer: true },
    ),
  );
  const toggleSearch = () => {
    const open = !searchOn();
    setSearchOn(open);
    props.onSearchOpenChange?.(open);
    if (open) {
      queueMicrotask(() =>
        scrollerEl?.querySelector<HTMLInputElement>(".grid-filter-input")?.focus(),
      );
    } else {
      scrollerEl?.focus({ preventScroll: true });
    }
  };
  // Sort/filter reorder or shrink the view, so a view-position selection would
  // point at a different row — clear it (matches the reset on a new result).
  const toggleSort = (col: number) => {
    const server = props.onSortColumn;
    if (server) {
      const name = cols()[col]?.name;
      if (name) server(name);
      clearSel();
      return;
    }
    setSort((s) => cycleSort(s, col));
    clearSel();
  };

  /** How this column is sorted: by the server when it owns the sort, else here. */
  const sortDirOf = (ci: number): "ascending" | "descending" | "none" => {
    if (props.onSortColumn) {
      const s = props.sortedColumn;
      if (!s || s.column.toLowerCase() !== (cols()[ci]?.name ?? "").toLowerCase()) return "none";
      return s.dir === "ASC" ? "ascending" : "descending";
    }
    if (sort()?.col !== ci) return "none";
    return sort()?.dir === "asc" ? "ascending" : "descending";
  };
  const setFilter = (col: number, q: string) => {
    setFilters((f) => ({ ...f, [col]: q }));
    clearSel();
  };
  const colWidth = (ci: number) => widths()[ci] ?? 180;

  // The order actually drawn. Falls back to the engine's own whenever the stored
  // order does not match the current columns — a new result reaches the render
  // before the reset effect runs, and a mismatched order would draw holes.
  const order = () =>
    colOrder().length === cols().length ? colOrder() : defaultOrder(cols().length);
  /** The columns in display order, each carrying its ORIGINAL index. */
  const displayCols = createMemo(() => order().map((ci) => ({ ci, col: cols()[ci] })));
  createEffect(() => props.onColumnOrderChange?.(order()));

  // Dragging a header moves its column (issue #446). HTML5 drag rather than
  // document-level mouse listeners: the platform draws the ghost and delivers
  // the drop, and the resize handle opts out with draggable={false}, so the two
  // gestures on the same header cannot be confused.
  const [dragFrom, setDragFrom] = createSignal<number | null>(null);
  const [dropAt, setDropAt] = createSignal<number | null>(null);
  /** Moves the dragged (or keyboard-moved) column to display position `to`. */
  const moveTo = (from: number, to: number) => {
    setDragFrom(null);
    setDropAt(null);
    // The selection is NOT cleared: it is keyed by the original column index, so
    // reordering moves where the selected cell is drawn, not which cell it is.
    setColOrder((o) => moveColumn(o.length === cols().length ? o : defaultOrder(cols().length), from, to));
  };

  const gridCols = () => {
    const body = order()
      .map((ci) => `${colWidth(ci)}px`)
      .join(" ");
    const lead = [
      markable() ? `${MARK_WIDTH}px` : "",
      editing() ? `${ACTION_WIDTH}px` : "",
    ].filter(Boolean);
    return [...lead, body].join(" ");
  };

  // The mark column (#517 follow-up): a row number that turns into a checkbox,
  // for marking rows without knowing Ctrl/Shift+click. Only where the marks go
  // somewhere — a panel that does nothing with them gets no column. It counts
  // as a column for assistive tech, so the data cells' indices shift by one.
  const markable = () => !!props.onMarkedRowsChange;
  const colOffset = () => (markable() ? 1 : 0);
  const allMarked = () => view().length > 0 && view().every((r) => marks().has(r));
  const someMarked = () => marks().size > 0 && !allMarked();
  const toggleAllMarks = () => setMarks(allMarked() ? new Set<number>() : new Set(view()));
  // A checkbox click toggles its row; with Shift it takes everything back to
  // the last row touched, adding to what is already marked.
  const onMarkClick = (viewPos: number, e: MouseEvent) => {
    const rowIndex = view()[viewPos];
    if (rowIndex === undefined) return;
    if (e.shiftKey && anchor() !== null) {
      setMarks((m) => markRange(m, view(), anchor()!, viewPos, true));
    } else {
      setMarks((m) => toggleMark(m, rowIndex));
    }
    setAnchor(viewPos);
  };

  // Drag a header resize handle: capture the start geometry, then set the dragged
  // column to an absolute target width (start width + pointer delta) on each move
  // until release. Absolute (not incremental) so intermediate rounding can't drift.
  // Document-level listeners keep tracking even when the pointer leaves the header.
  const startResize = (ci: number, e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation(); // never let the handle trigger the column sort
    const startX = e.clientX;
    const startW = colWidth(ci);
    const onMove = (ev: MouseEvent) =>
      setWidths((w) => resizeColumn(w, ci, startW + (ev.clientX - startX) - (w[ci] ?? 180), MIN_COL_WIDTH));
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const isDeleted = (rowIndex: number) =>
    props.edit?.pending.deletes.includes(rowIndex) ?? false;

  /** A changed cell of an existing row (issue #690). */
  const isDirty = (rowIndex: number, colName: string) => {
    const pending = props.edit?.pending.edits[rowIndex];
    return !!pending && colName in pending;
  };
  const fkTarget = (name: string): string | undefined => {
    const fks = props.foreignKeys;
    if (!fks) return undefined;
    const key = Object.keys(fks).find((k) => k.toLowerCase() === name.toLowerCase());
    return key === undefined ? undefined : fks[key];
  };

  // The value to show in an existing-row cell: the pending edit if any, else the
  // original value.
  const cellValue = (rowIndex: number, colName: string, original: string | null) => {
    const pending = props.edit?.pending.edits[rowIndex];
    if (pending && colName in pending) {
      return pending[colName];
    }
    return original;
  };

  const range = () =>
    visibleRange({
      scrollTop: scrollTop(),
      viewportHeight: viewportH(),
      rowHeight: rowHeight(),
      rowCount: view().length,
    });

  createEffect(() => {
    const r = props.result;
    // Trigger fetch off the actual loaded-row count, not the (possibly filtered)
    // view length, so a heavy filter doesn't look like "end of the loaded page".
    if (props.onNeedMore && r && needsMoreRows(range().end, rows().length, r.truncated)) {
      props.onNeedMore();
    }
  });

  // Height taken by the sticky header + filter rows (so scroll-into-view leaves
  // the selected row below them, not hidden underneath).
  const chromeHeight = () => {
    if (!scrollerEl) return 0;
    const h = scrollerEl.querySelector(".grid-header") as HTMLElement | null;
    const f = scrollerEl.querySelector(".grid-filter") as HTMLElement | null;
    return (h?.clientHeight ?? 0) + (f?.clientHeight ?? 0);
  };

  // Keep the selected row visible when the SELECTION changes (keyboard nav).
  // Keyed on `sel` only (via `on`, so the body is untracked): reading scrollTop()
  // as a live dependency would re-fire on every manual scroll and snap the view
  // back, trapping the user on the selected row.
  createEffect(
    on(sel, (s) => {
      if (!s || !scrollerEl) return;
      const target = scrollRowIntoView(s.r, rowHeight(), scrollTop(), viewportH() - chromeHeight());
      if (target !== null) {
        scrollerEl.scrollTop = target;
        setScrollTop(target);
      }
    }),
  );

  // Leaving the edit session closes the editor.
  createEffect(() => {
    if (!editing()) setEditCell(null);
  });
  const isEditingCell = (rowIndex: number, ci: number) => {
    const ed = editCell();
    return !!ed && ed.row === rowIndex && ed.c === ci;
  };

  /** Runs `fn` inside the edit session, opening it first when the table is
      editable but not being edited (Supr, Ctrl+Mayús+N, typing: R-14). */
  const withEdit = async (fn: () => void) => {
    if (!props.edit) return;
    if (!editing()) {
      if (!props.onRequestEdit) return;
      await props.onRequestEdit();
      if (!editing()) return;
    }
    fn();
  };

  /** Focus the open editor's input: all of it selected for F2/Enter, the caret
      at the end when a typed character opened it. data-cell is on the cell
      wrapper, or on the input itself for a foreign-key picker. */
  const focusEditor = (selectAll: boolean) => {
    const ed = editCell();
    if (!ed || !scrollerEl) return;
    const el = scrollerEl.querySelector(`[data-cell="${view().indexOf(ed.row)}-${ed.c}"]`);
    const input = (el?.tagName === "INPUT" ? el : el?.querySelector("input")) as
      | HTMLInputElement
      | null
      | undefined;
    if (!input) return;
    input.focus();
    if (selectAll) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  };

  /** Open the editor on a cell, optionally with a first character typed. */
  const openEditor = (pos: CellPos, opts: { seed?: string; browse?: boolean } = {}) =>
    withEdit(() => {
      const row = view()[pos.r];
      const name = cols()[pos.c]?.name;
      if (row === undefined || name === undefined || isDeleted(row)) return;
      const pend = props.edit!.pending.edits[row];
      setEditCell({
        row,
        c: pos.c,
        had: !!pend && name in pend,
        before: pend?.[name] ?? null,
        browse: !!opts.browse,
      });
      if (opts.seed !== undefined) props.edit!.onEditCell(row, name, opts.seed);
      queueMicrotask(() => focusEditor(opts.seed === undefined));
    });

  /** Close the editor — its value is already in the pending changes — moving
      the selection the way Enter and Tab ask. */
  const closeEditor = (move?: string) => {
    setEditCell(null);
    if (move) moveSel(move, false);
    scrollerEl?.focus({ preventScroll: true });
  };

  /** Esc in the editor: back to the value the cell had when it opened. */
  const revertEditor = () => {
    const ed = editCell();
    const name = ed ? cols()[ed.c]?.name : undefined;
    if (ed && name !== undefined && props.edit) {
      if (ed.had) props.edit.onEditCell(ed.row, name, ed.before);
      else if (props.edit.onRevertCell) props.edit.onRevertCell(ed.row, name);
      else props.edit.onEditCell(ed.row, name, rows()[ed.row]?.[ed.c] ?? null);
    }
    closeEditor();
  };

  const onEditorKeyDown = (e: KeyboardEvent, rowIndex: number, name: string) => {
    const action = cellEditorKey(e);
    if (!action) return;
    e.preventDefault();
    e.stopPropagation();
    if (action.kind === "revert") return revertEditor();
    if (action.kind === "null") {
      props.edit?.onEditCell(rowIndex, name, null);
      return closeEditor();
    }
    closeEditor(action.move);
  };

  // Click selects one cell; the modifiers mark rows instead of moving on their
  // own (ctrl toggles this row, shift takes everything back to the anchor).
  // Shift extends the block of cells from its anchor (issue #690); Ctrl/Cmd
  // toggles the row's mark, or on a cell with related data follows the link.
  const selectCell = (viewPos: number, c: number, e?: MouseEvent) => {
    const rowIndex = view()[viewPos];
    if (rowIndex === undefined || !isEditingCell(rowIndex, c)) setEditCell(null);
    const additive = !!(e?.ctrlKey || e?.metaKey);
    if (additive && !e?.shiftKey && rowIndex !== undefined && hasRelated(c)) {
      setSel({ r: viewPos, c });
      props.onRelated?.(rowIndex, c);
      return;
    }
    if (e?.shiftKey && (cellAnchor() ?? sel()) !== null) {
      setCellAnchor((a) => a ?? sel());
    } else if (additive && rowIndex !== undefined) {
      setMarks((m) => toggleMark(m, rowIndex));
      setAnchor(viewPos);
      setCellAnchor({ r: viewPos, c });
    } else {
      setMarks(new Set<number>());
      setAnchor(viewPos);
      setCellAnchor({ r: viewPos, c });
    }
    setSel({ r: viewPos, c });
    scrollerEl?.focus({ preventScroll: true });
  };

  // Dragging over the cells selects the block under the pointer. The press
  // only starts it: a click on the same cell still goes through selectCell.
  let dragging = false;
  const stopDrag = () => {
    dragging = false;
    document.removeEventListener("mouseup", stopDrag);
  };
  onCleanup(stopDrag);
  const onCellMouseDown = (viewPos: number, c: number, e: MouseEvent) => {
    if (e.button !== 0 || e.ctrlKey || e.metaKey) return;
    const rowIndex = view()[viewPos];
    if (rowIndex === undefined || !isEditingCell(rowIndex, c)) setEditCell(null);
    // No text selection across cells: the block IS the selection.
    e.preventDefault();
    if (e.shiftKey) setCellAnchor((a) => a ?? sel() ?? { r: viewPos, c });
    else setCellAnchor({ r: viewPos, c });
    setSel({ r: viewPos, c });
    scrollerEl?.focus({ preventScroll: true });
    dragging = true;
    document.addEventListener("mouseup", stopDrag);
  };
  const onCellMouseEnter = (viewPos: number, c: number) => {
    if (dragging) setSel({ r: viewPos, c });
  };

  /** The selected block in DISPLAY space (view position, drawn column), or
      null with no selection. One cell when nothing was extended. */
  const cellRange = createMemo(() => {
    const s = sel();
    if (!s) return null;
    const a = cellAnchor() ?? s;
    const o = order();
    return rangeBetween({ r: a.r, c: displayIndex(o, a.c) }, { r: s.r, c: displayIndex(o, s.c) });
  });
  const rangeSize = () => rangeCellCount(cellRange());

  /** Whether a column offers related data (and so the cell link). */
  const hasRelated = (ci: number) => {
    const name = cols()[ci]?.name;
    return !!props.onRelated && !!name && (isReferenced(name) || !!fkTarget(name));
  };

  const onGridKeyDown = (e: KeyboardEvent) => {
    // Only act when focus is on the grid surface itself: inputs (edit cells,
    // filter boxes) and the focusable sort-header cells own their own keys. A
    // row's mark checkbox is not a text box: in edit mode it is how rows get
    // marked, and the row keys (Delete, #644) must still reach the grid.
    const target = e.target as HTMLElement | null;
    const textInput =
      target?.tagName === "INPUT" && (target as HTMLInputElement).type !== "checkbox";
    if (target && (textInput || target.closest(".grid-head-sort"))) return;
    const s0 = sel();
    const action = s0 ? gridEditKey(e) : null;
    const row0 = s0 ? view()[s0.r] : undefined;
    if (s0 && action && row0 !== undefined) {
      if (action.kind === "detail") {
        if (!props.onRowDetail) return;
        e.preventDefault();
        props.onRowDetail(row0);
        return;
      }
      if (props.onRowActivate && !props.edit && action.kind === "edit") {
        e.preventDefault();
        props.onRowActivate(row0);
        return;
      }
      if (!props.edit || (!editing() && !props.onRequestEdit)) return;
      if (action.kind === "fk" && !fkFor(cols()[s0.c]?.name ?? "")) return;
      e.preventDefault();
      if (action.kind === "null") {
        const name = cols()[s0.c]?.name;
        if (name !== undefined) void withEdit(() => props.edit!.onEditCell(row0, name, null));
        return;
      }
      void openEditor(s0, {
        seed: action.kind === "type" ? action.text : undefined,
        browse: action.kind === "fk",
      });
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const letter = e.key.toLowerCase();
    if (mod && letter === "f" && !e.shiftKey && !e.altKey) {
      // The page search, not the app's find (issue #690).
      e.preventDefault();
      e.stopPropagation();
      toggleSearch();
      return;
    }
    if (mod && letter === "b") {
      // Follow the focused cell's foreign key (issue #690).
      const s = sel();
      const row = s === null ? undefined : view()[s.r];
      if (s && row !== undefined && hasRelated(s.c)) {
        e.preventDefault();
        props.onRelated?.(row, s.c);
      }
      return;
    }
    if (mod && e.shiftKey && !e.altKey && letter === "c") {
      // The rows with the column names as the first line, for a spreadsheet.
      const targets = rowTargets();
      if (props.onCopyRows && targets.length > 0) {
        e.preventDefault();
        props.onCopyRows(targets, true);
      }
      return;
    }
    if (mod && letter === "c" && marks().size === 0 && rangeSize() > 1) {
      // A block of cells copies as TSV, the way a spreadsheet takes it (#690).
      e.preventDefault();
      copyText(rangeToTsv(rangeValues()));
      return;
    }
    if (mod && (letter === "c" || letter === "d")) {
      // Rows, not text (#517): the marked rows, or the selected cell's row.
      const handler = letter === "c" ? props.onCopyRows : props.onDuplicateRows;
      const targets = rowTargets();
      if (handler && targets.length > 0) {
        e.preventDefault();
        handler(targets);
      }
      return;
    }
    if (e.key === "Delete" && !mod && !e.shiftKey && !e.altKey) {
      // Staged, not run: it lands in the pending changes like the 🗑 button,
      // and only in edit mode (#644).
      // An editable table opens its edit session first (R-14).
      const targets = rowTargets();
      const del = props.edit?.onToggleDeleteRows;
      if (del && targets.length > 0 && (editing() || props.onRequestEdit)) {
        e.preventDefault();
        void withEdit(() => del(targets));
      }
      return;
    }
    if (e.key === "Escape" && marks().size > 0) {
      e.preventDefault();
      setMarks(new Set<number>());
      return;
    }
    if (e.key === "Escape" && rangeSize() > 1) {
      // Back to the focused cell; nothing else is lost.
      e.preventDefault();
      setCellAnchor(sel());
      return;
    }
    if (mod && letter === "a") {
      // Everything the view is showing — a filtered grid selects what it shows,
      // not the rows hidden behind the filter.
      e.preventDefault();
      setMarks(new Set(view()));
      return;
    }
    if (!isNavKey(e.key)) return;
    e.preventDefault();
    moveSel(e.key, e.shiftKey);
  };

  const moveSel = (key: string, shift: boolean) => {
    // The selection carries the ORIGINAL column index, but ←/→ must walk the
    // columns as they are DRAWN — so the move happens in display space and the
    // result is translated back (issue #446).
    const s = sel();
    const from = s === null ? null : { r: s.r, c: displayIndex(order(), s.c) };
    const moved = moveSelection(from, key, view().length, cols().length);
    const next = moved === null ? null : { r: moved.r, c: order()[moved.c] ?? moved.c };
    // Shift keeps the block's anchor where it was (issue #690); a plain move
    // starts over from the new cell, as a click does.
    if (shift) setCellAnchor((a) => a ?? s ?? next);
    setSel(next);
    if (!next) return;
    if (!shift) {
      setCellAnchor(next);
      setAnchor(next.r);
      setMarks(new Set<number>());
    }
  };

  /** The selected block's values, as drawn: rows top to bottom, columns left
      to right, a pending edit in place of what the core sent. */
  const rangeValues = (): (string | null)[][] => {
    const rg = cellRange();
    if (!rg) return [];
    const columns = order().slice(rg.c1, rg.c2 + 1);
    return view()
      .slice(rg.r1, rg.r2 + 1)
      .map((ri) =>
        columns.map((ci) => cellValue(ri, cols()[ci]?.name ?? "", rows()[ri]?.[ci] ?? null) ?? null),
      );
  };

  /** The rows a row action takes: the marked ones in view order, or else the
      selected cell's row (index into result.rows). */
  const rowTargets = (): number[] => {
    const marked = orderedMarks(marks(), view());
    if (marked.length > 0) return marked;
    const rg = cellRange();
    return rg ? view().slice(rg.r1, rg.r2 + 1) : [];
  };

  const isSelected = (viewPos: number, c: number) => {
    const s = sel();
    return !!s && s.r === viewPos && s.c === c;
  };
  /** The focused cell's row: its foreign-key cells show their link. */
  const isFocusRow = (viewPos: number) => sel()?.r === viewPos;

  // Publish the marked rows (original indices, view order) for the workspace.
  createEffect(() => props.onMarkedRowsChange?.(orderedMarks(marks(), view())));

  // Publish the selected ROW (index into result.rows, not into the sorted or
  // filtered view) for panels that act on it from their bar.
  createEffect(() => {
    const s = sel();
    props.onSelectedRowChange?.(s === null ? null : (view()[s.r] ?? null));
  });

  createEffect(() => {
    const s = sel();
    const rg = cellRange();
    if (s === null || rg === null) return props.onSelectedCellsChange?.(null);
    if (marks().size > 0 && rangeCellCount(rg) === 1) {
      return props.onSelectedCellsChange?.({ columns: [s.c], rows: rowTargets() });
    }
    props.onSelectedCellsChange?.({
      columns: order().slice(rg.c1, rg.c2 + 1),
      rows: view().slice(rg.r1, rg.r2 + 1),
    });
  });

  return (
    <div
      class="grid"
      aria-busy={props.loading}
      // Esc stops a running query from anywhere in the grid (R-01).
      onKeyDown={(e) => {
        if (e.key === "Escape" && props.loading && props.onCancel && !props.cancelDisabledReason) {
          e.preventDefault();
          props.onCancel();
        }
      }}
    >
      <Show when={props.error}>
        <div class="grid-error" role="alert">
          {props.error}
          {props.errorExtra}
        </div>
      </Show>


      <Show when={!props.error && props.result}>
        {(result) => (
          <Show
            when={cols().length > 0}
            fallback={
              <div class="grid-empty">
                {countText("grid.rowsAffected", result().rowsAffected)}
              </div>
            }
          >
            <Show when={searchOn()}>
              <div class="grid-search-note" role="note">
                <IconSearch />
                <span>
                  {filtersActive()
                    ? t("grid.searchMatches", { m: view().length, n: rows().length })
                    : t("grid.searchNote", { n: rows().length })}
                </span>
                <Show when={props.onFilterTable && filtersActive()}>
                  <button
                    class="btn grid-search-table"
                    type="button"
                    title={t("grid.filterTableTitle")}
                    onClick={() => props.onFilterTable?.(searchTerms(filters(), cols()))}
                  >
                    {t("grid.filterTable")}
                  </button>
                </Show>
                <button
                  class="grid-search-close"
                  type="button"
                  aria-label={t("grid.searchClose")}
                  title={t("grid.searchClose")}
                  onClick={toggleSearch}
                >
                  ×
                </button>
              </div>
            </Show>
            <div
              class="grid-scroll"
              ref={attachScroller}
              // Roles, so the result is a grid to assistive tech and not a pile of
              // divs. The counts are the TOTALS, not what the virtual window happens
              // to render: aria-rowcount/aria-rowindex exist precisely so a
              // virtualized grid can still say "row 1001 of 1200" (issue #326).
              role="grid"
              aria-label={t("grid.ariaLabel")}
              aria-multiselectable={true}
              aria-rowcount={rows().length + 1}
              aria-colcount={cols().length + colOffset()}
              classList={{ "has-marks": marks().size > 0 }}
              tabindex={0}
              style={{ "--grid-row-h": `${rowHeight()}px` }}
              onScroll={(e) => {
                setScrollTop(e.currentTarget.scrollTop);
                if (insertsEl) insertsEl.scrollLeft = e.currentTarget.scrollLeft;
              }}
              onKeyDown={onGridKeyDown}
            >
              <div class="grid-inner">
                <div
                  class="grid-header"
                  role="row"
                  aria-rowindex={1}
                  style={{ "grid-template-columns": gridCols() }}
                >
                  <Show when={markable()}>
                    <div class="grid-cell grid-head grid-mark" role="columnheader" aria-colindex={1}>
                      <input
                        type="checkbox"
                        aria-label={t("grid.markAll")}
                        title={t("grid.markAll")}
                        checked={allMarked()}
                        // `indeterminate` exists only as a DOM property, never
                        // as an attribute, so it is set from an effect.
                        ref={(el) =>
                          createEffect(() => {
                            el.indeterminate = someMarked();
                          })
                        }
                        onClick={toggleAllMarks}
                      />
                    </div>
                  </Show>
                  <Show when={editing()}>
                    <div class="grid-cell grid-head grid-action" />
                  </Show>
                  <For each={displayCols()}>
                    {(dc, di) => {
                      const col = dc.col;
                      const ci = () => dc.ci;
                      return (
                      <div
                        class={`grid-cell grid-head grid-head-sort ${classifyType(col.type) === "number" ? "head-number" : ""} ${dragFrom() === di() ? "is-dragging" : ""} ${dropAt() === di() && dragFrom() !== di() ? "is-drop-target" : ""}`}
                        role="columnheader"
                        aria-colindex={di() + 1 + colOffset()}
                        aria-sort={sortDirOf(ci())}
                        tabindex={0}
                        title={t("grid.sortOrMove", { keys: keyLabel("Alt+←/→") })}
                        draggable={true}
                        onDragStart={(e) => {
                          setDragFrom(di());
                          // Some engines refuse to start a drag without payload.
                          e.dataTransfer?.setData("text/plain", col.name);
                          if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
                        }}
                        onDragOver={(e) => {
                          if (dragFrom() === null) return;
                          e.preventDefault(); // this is what marks a drop target
                          if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
                          setDropAt(di());
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          const from = dragFrom();
                          if (from !== null) moveTo(from, di());
                        }}
                        onDragEnd={() => {
                          setDragFrom(null);
                          setDropAt(null);
                        }}
                        /* The column's type colour, for the rule the report
                           style draws under its header. Set here because only
                           the component knows each column's type; with the
                           per-type colours off, the CSS falls back to the
                           ordinary border. */
                        style={{ "--k": `var(--cell-${classifyType(col.type)})` }}
                        onClick={() => toggleSort(ci())}
                        onKeyDown={(e) => {
                          // Alt+←/→ is the keyboard route to the same move: a
                          // drag-only feature would be out of reach for anyone
                          // navigating the grid with the keyboard.
                          if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
                            e.preventDefault();
                            const to = di() + (e.key === "ArrowLeft" ? -1 : 1);
                            if (to < 0 || to >= cols().length) return;
                            const row = e.currentTarget.parentElement;
                            moveTo(di(), to);
                            // The header cells are rebuilt in the new order, so
                            // follow the column the user is moving.
                            queueMicrotask(() =>
                              (row?.querySelectorAll(".grid-head-sort")[to] as
                                | HTMLElement
                                | undefined)?.focus(),
                            );
                            return;
                          }
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleSort(ci());
                          }
                        }}
                      >
                        {/* Two lines (issue #690): the name with its marks —
                            key, foreign key, sort, page search — and the type
                            under it, with where a foreign key points. */}
                        <span class="col-line">
                          <Show when={isKey(col.name)}>
                            {/* Said, not only drawn: "this is the key" is the
                                sort of thing a header has to say out loud. */}
                            <span class="col-key-mark" title={t("grid.pkColumn")}>
                              <IconKey />
                              <span class="visually-hidden">{t("grid.pkColumn")}</span>
                            </span>
                          </Show>
                          <Show when={fkTarget(col.name) || isReferenced(col.name)}>
                            {(() => {
                              const label = () => {
                                const target = fkTarget(col.name);
                                return target ? t("grid.fkColumn", { target }) : t("related.refColumn");
                              };
                              return (
                                <span class="col-ref-mark" title={label()}>
                                  <IconRelated />
                                  <span class="visually-hidden">{label()}</span>
                                </span>
                              );
                            })()}
                          </Show>
                          <span class={`col-name ${isReferenced(col.name) ? "col-referenced" : ""}`}>
                            {col.name}
                          </span>
                          <Show
                            when={
                              props.onSortColumn
                                ? ({ ascending: "arrow-up", descending: "arrow-down", none: null } as const)[
                                    sortDirOf(ci())
                                  ]
                                : sortIcon(sort(), ci())
                            }
                          >
                            {(name) => (
                              <span class="col-sort" aria-hidden="true">
                                <Icon name={name()} size={10} />
                              </span>
                            )}
                          </Show>
                          <Show when={(filters()[ci()] ?? "").trim() !== ""}>
                            <span class="col-search-mark" title={t("grid.searchedColumn")}>
                              <IconSearch />
                              <span class="visually-hidden">{t("grid.searchedColumn")}</span>
                            </span>
                          </Show>
                        </span>
                        <Show when={props.headerTypes !== false}>
                          <span class="col-type">
                            {fkTarget(col.name) ? `${col.type} → ${fkTarget(col.name)}` : col.type}
                          </span>
                        </Show>
                        <span
                          class="col-resize"
                          title={t("grid.resize")}
                          aria-hidden="true"
                          /* Opts out of the header's drag: without this, pulling
                             the handle would move the column instead of resizing
                             it (the drag source is the nearest draggable). */
                          draggable={false}
                          onMouseDown={(e) => startResize(ci(), e)}
                          onClick={(e) => e.stopPropagation()}
                          onDblClick={(e) => {
                            e.stopPropagation();
                            setWidths((w) =>
                              w.map((width, i) =>
                                i === ci() ? computeColumnWidths([cols()[ci()]], rows().map((r) => [r[ci()]]))[0] : width,
                              ),
                            );
                          }}
                        />
                      </div>
                      );
                    }}
                  </For>
                </div>

                <Show when={searchOn()}>
                <div
                  class="grid-filter"
                  role="row"
                  style={{ "grid-template-columns": gridCols() }}
                >
                  <Show when={markable()}>
                    <div class="grid-cell grid-mark" />
                  </Show>
                  <Show when={editing()}>
                    <div class="grid-cell grid-action" />
                  </Show>
                  <For each={displayCols()}>
                    {(dc) => (
                      <div class="grid-cell grid-filter-cell" role="gridcell">
                        <input
                          class="grid-filter-input"
                          type="search"
                          placeholder={t("grid.searchPlaceholder")}
                          aria-label={t("grid.searchIn", { name: dc.col.name })}
                          value={filters()[dc.ci] ?? ""}
                          onInput={(e) => setFilter(dc.ci, e.currentTarget.value)}
                          onKeyDown={(e) => {
                            // Esc closes the search from inside it; Ctrl+F too.
                            const mod = e.ctrlKey || e.metaKey;
                            if (e.key === "Escape" || (mod && e.key.toLowerCase() === "f")) {
                              e.preventDefault();
                              e.stopPropagation();
                              toggleSearch();
                            }
                          }}
                        />
                      </div>
                    )}
                  </For>
                </div>
                </Show>

                <div class="grid-spacer" style={{ height: `${range().totalHeight}px` }}>
                  <div
                    class="grid-rows"
                    style={{ transform: `translateY(${range().offsetY}px)` }}
                  >
                    <For each={view().slice(range().start, range().end)}>
                      {(origIndex, i) => {
                        const rowIndex = () => origIndex;
                        // Position of this row within the current view (for keyboard
                        // selection + scroll-into-view, stable under sort/filter).
                        const viewPos = () => range().start + i();
                        // Reactive lookup: the <For> keys by index value, so this
                        // callback is reused across queries — read the live rows()
                        // each render, never a stale snapshot.
                        const row = () => rows()[origIndex];
                        // Zebra keyed by the row's ABSOLUTE position in the view, not
                        // by nth-child: the virtual window shifts on scroll, so a CSS
                        // nth-child stripe would flicker as rows recycle.
                        const zebra = () => ((range().start + i()) % 2 === 1 ? "row-odd" : "");
                        return (
                          <div
                            class={`grid-row ${zebra()} ${isMarked(rowIndex()) ? "row-marked" : ""} ${isDeleted(rowIndex()) ? "row-deleted" : ""} ${isFocusRow(viewPos()) ? "row-focus" : ""}`}
                            role="row"
                            aria-rowindex={viewPos() + 2}
                            aria-selected={isMarked(rowIndex())}
                            style={{ "grid-template-columns": gridCols() }}
                          >
                            <Show when={markable()}>
                              <div class="grid-cell grid-mark" role="gridcell" aria-colindex={1}>
                                {/* The row's number, or what is staged for it
                                    (issue #690): + new, ~ changed, − deleted —
                                    a glyph, so it does not rest on colour. */}
                                <Show
                                  when={props.edit ? rowChange(props.edit.pending, rowIndex()) : null}
                                  fallback={
                                    <span class="grid-mark-num" aria-hidden="true">
                                      {viewPos() + 1}
                                    </span>
                                  }
                                >
                                  {(state) => <RowGlyph state={state()} />}
                                </Show>
                                <input
                                  type="checkbox"
                                  tabindex="-1"
                                  aria-label={t("grid.markRow", { n: viewPos() + 1 })}
                                  checked={isMarked(rowIndex())}
                                  onClick={(e) => onMarkClick(viewPos(), e)}
                                />
                              </div>
                            </Show>
                            <Show when={editing()}>
                              <button
                                class="grid-cell grid-action danger"
                                title={isDeleted(rowIndex()) ? t("grid.undoDelete") : t("grid.deleteRow")}
                                aria-label={isDeleted(rowIndex()) ? t("grid.undoDelete") : t("grid.deleteRow")}
                                onClick={() => props.edit?.onToggleDelete(rowIndex())}
                              >
                                <Icon name={isDeleted(rowIndex()) ? "undo" : "trash"} size={14} />
                              </button>
                            </Show>
                            <For each={displayCols()}>
                              {(dc, di) => {
                                const col = dc.col;
                                const ci = () => dc.ci;
                                const original = () => row()[ci()] ?? null;
                                return (
                                  <Show
                                    when={editing() && isEditingCell(rowIndex(), ci())}
                                    fallback={(() => {
                                      // What the cell SHOWS, which in the report
                                      // style is not what it holds (#540). The
                                      // raw value stays in `title`, and every
                                      // path that copies, filters or saves reads
                                      // `props.result.rows`, never this. In edit
                                      // mode a cell that is not being edited
                                      // shows its pending value, with its type
                                      // colour and NULL tag (A-12).
                                      const value = () => cellValue(rowIndex(), col.name, original());
                                      const dirty = () => isDirty(rowIndex(), col.name);
                                      const scale = () => props.scales?.[col.name];
                                      const cell = createMemo(() =>
                                        displayText(
                                          scale() !== undefined && value() !== null
                                            ? withScale(value()!, scale()!)
                                            : value(),
                                          typeOf(rowIndex(), ci(), col.type),
                                          props.gridStyle ?? "registro",
                                          t,
                                          props.display,
                                        ),
                                      );
                                      const related = () => hasRelated(ci());
                                      return (
                                        <div
                                          class={`grid-cell cell-${cell().kind} ${isSelected(viewPos(), ci()) ? "cell-selected" : ""} ${inRange(cellRange(), viewPos(), di()) ? "cell-in-range" : ""} ${related() ? "cell-related" : ""} ${dirty() ? "cell-dirty" : ""} ${props.cellClass?.(rowIndex(), ci()) ?? ""}`}
                                          role="gridcell"
                                          aria-colindex={di() + 1 + colOffset()}
                                          aria-selected={inRange(cellRange(), viewPos(), di())}
                                          style={{ "text-align": cellAlign(cell().kind) }}
                                          /* The RAW value: in the report style
                                             the cell shows "1,250.00" and this
                                             is where the real 1250.00 is. A
                                             changed cell says what it was. */
                                          title={
                                            dirty()
                                              ? t("grid.originalValue", { value: original() ?? NULL_LABEL })
                                              : value() === ""
                                                ? t("grid.emptyString")
                                                : (value() ?? NULL_LABEL)
                                          }
                                          data-cell={`${viewPos()}-${ci()}`}
                                          onMouseDown={(e) => onCellMouseDown(viewPos(), ci(), e)}
                                          onMouseEnter={() => onCellMouseEnter(viewPos(), ci())}
                                          onClick={(e) => selectCell(viewPos(), ci(), e)}
                                          onDblClick={() => {
                                            selectCell(viewPos(), ci());
                                            if (props.onRowActivate && !props.edit) {
                                              props.onRowActivate(rowIndex());
                                              return;
                                            }
                                            void openEditor({ r: viewPos(), c: ci() });
                                          }}
                                          onContextMenu={(e) =>
                                            props.onCellContext?.(e, rowIndex(), ci())
                                          }
                                        >
                                          {/* NULL in its own element: it is the
                                              absence of a value, not a value,
                                              and the styles draw it as a tag
                                              rather than as italic text. */}
                                          {/* NULL and '' are both "nothing" and must
                                              never look alike, nor like data
                                              (issue #690). */}
                                          <Show
                                            when={cell().kind === "null"}
                                            fallback={
                                              <Show when={value() === ""} fallback={cell().text}>
                                                <span class="cell-empty-tag" aria-label={t("grid.emptyString")}>
                                                  ''
                                                </span>
                                              </Show>
                                            }
                                          >
                                            <span class="cell-null-tag">{cell().text}</span>
                                          </Show>
                                          <Show when={props.showOldValues && dirty()}>
                                            <s class="cell-old">{original() ?? NULL_LABEL}</s>
                                          </Show>
                                          <Show when={related()}>
                                            <button
                                              class="cell-related-btn"
                                              type="button"
                                              tabindex="-1"
                                              aria-hidden="true"
                                              title={t("related.cellArrow")}
                                              onClick={(e) => {
                                                // Without this the cell's own click
                                                // handler also runs and the grid
                                                // fights the dialog for focus.
                                                e.stopPropagation();
                                                props.onRelated?.(rowIndex(), ci());
                                              }}
                                            >
                                              <IconRelated />
                                            </button>
                                          </Show>
                                        </div>
                                      );
                                    })()}
                                  >
                                    <Show
                                      when={fkFor(col.name)}
                                      fallback={
                                        <div
                                          class={`grid-cell cell-edit ${isDirty(rowIndex(), col.name) ? "cell-dirty" : ""}`}
                                          role="gridcell"
                                          aria-colindex={di() + 1 + colOffset()}
                                          data-cell={`${viewPos()}-${ci()}`}
                                          // The value before the edit, said and
                                          // not only coloured (issue #690).
                                          title={
                                            isDirty(rowIndex(), col.name)
                                              ? t("grid.originalValue", { value: original() ?? NULL_LABEL })
                                              : undefined
                                          }
                                        >
                                        <input
                                          class="cell-input"
                                          // Named by its column, so a cell can be
                                          // addressed by what it is rather than by
                                          // counting inputs. The role stays on the
                                          // wrapper: putting gridcell on the input
                                          // would override its textbox role and stop
                                          // it being announced as editable.
                                          aria-label={col.name}
                                          disabled={isDeleted(rowIndex())}
                                          // An empty box says two different things —
                                          // a SQL NULL and an empty string — and the
                                          // difference is the whole point of being
                                          // able to write one (issue #398). The NULL
                                          // names itself in the placeholder; typing
                                          // and clearing leaves "" and no placeholder.
                                          placeholder={
                                            cellValue(rowIndex(), col.name, original()) === null
                                              ? NULL_LABEL
                                              : ""
                                          }
                                          value={(() => {
                                            const v = cellValue(rowIndex(), col.name, original());
                                            // A SQL NULL edits as empty, never "0" (a bool
                                            // NULL must stay distinct from a stored false).
                                            if (v === null || v === undefined) return "";
                                            return classifyType(col.type) === "bool"
                                              ? boolTo01(v)
                                              : v;
                                          })()}
                                          onInput={(e) =>
                                            props.edit?.onEditCell(
                                              rowIndex(),
                                              col.name,
                                              e.currentTarget.value,
                                            )
                                          }
                                          onKeyDown={(e) => onEditorKeyDown(e, rowIndex(), col.name)}
                                          onContextMenu={(e) =>
                                            props.onCellContext?.(e, rowIndex(), ci())
                                          }
                                        />
                                        <Show when={props.showOldValues && isDirty(rowIndex(), col.name)}>
                                          <s class="cell-old">{original() ?? NULL_LABEL}</s>
                                        </Show>
                                        </div>
                                      }
                                    >
                                      {(lookup) => (
                                        <FkPicker
                                          lookup={lookup()}
                                          rootClass={`grid-cell cell-fk ${isDirty(rowIndex(), col.name) ? "cell-dirty" : ""}`}
                                          class="cell-input"
                                          dataCell={`${viewPos()}-${ci()}`}
                                          disabled={isDeleted(rowIndex())}
                                          value={cellValue(rowIndex(), col.name, original()) ?? ""}
                                          onChange={(v) =>
                                            props.edit?.onEditCell(rowIndex(), col.name, v)
                                          }
                                          onKeyDown={(e) => onEditorKeyDown(e, rowIndex(), col.name)}
                                          browseOnMount={editCell()?.browse}
                                        />
                                      )}
                                    </Show>
                                  </Show>
                                );
                              }}
                            </For>
                          </div>
                        );
                      }}
                    </For>
                  </div>
                </div>
              </div>
            </div>

            {/* What the open editor is changing and how to leave it (R-14):
                the value before, the column's type and the keys. */}
            <Show when={editing() ? editCell() : null}>
              {(ed) => {
                const col = () => cols()[ed().c];
                const before = () => rows()[ed().row]?.[ed().c] ?? null;
                return (
                  <div class="grid-edit-hint" role="status">
                    <span class="grid-edit-hint-cell">
                      {t("grid.editHint.cell", {
                        column: col()?.name ?? "",
                        n: view().indexOf(ed().row) + 1,
                      })}
                    </span>
                    <span>
                      {t("grid.editHint.before", { value: before() ?? NULL_LABEL, type: col()?.type ?? "" })}
                    </span>
                    <span class="grid-edit-hint-keys">
                      {t("grid.editHint.keys", keyParams({ enter: "Enter", esc: "Esc", keys: "Mod+Shift+N" }))}
                    </span>
                  </div>
                );
              }}
            </Show>

            <Show when={editing() && (props.edit?.pending.inserts.length ?? 0) > 0}>
              <div
                class="grid-inserts"
                ref={attachInserts}
                onScroll={(e) => {
                  if (scrollerEl) scrollerEl.scrollLeft = e.currentTarget.scrollLeft;
                }}
              >
                <div class="grid-inserts-title">{t("grid.newRows")}</div>
                {/* <Index>, not <For>: each keystroke replaces the row OBJECT
                    (setInsertCell is immutable), and a referentially-keyed <For>
                    would recreate the row's DOM — blurring the input after every
                    character. <Index> keys by position and updates in place. */}
                <Index each={props.edit?.pending.inserts ?? []}>
                  {(ins, ii) => (
                    <div
                      class={`grid-row row-insert ${props.edit?.failedInsert === ii ? "row-failed" : ""}`}
                      role="row"
                      style={{ "grid-template-columns": gridCols() }}
                    >
                      <Show when={markable()}>
                        <div class="grid-cell grid-mark">
                          <RowGlyph state="added" />
                        </div>
                      </Show>
                      <button
                        class="grid-cell grid-action danger"
                        title={t("grid.removeNewRow")}
                        aria-label={t("grid.removeNewRow")}
                        onClick={() => props.edit?.onRemoveInsert(ii)}
                      >
                        <Icon name="close" size={12} />
                      </button>
                      <For each={displayCols()}>
                        {({ col }) => {
                          const same = (c: string) => c.toLowerCase() === col.name.toLowerCase();
                          // A key the database will generate is not an input:
                          // typing into it would be thrown away on save (#517).
                          const autoKey = () =>
                            props.edit?.pkModeOf?.(ii) === "generate" &&
                            !!props.edit?.pkColumns?.some(same);
                          const conflict = () => !!props.edit?.conflicts?.get(ii)?.some(same);
                          const conflictClass = () => (conflict() ? "cell-conflict" : "");
                          const conflictTitle = () =>
                            conflict() ? t("pending.conflictCell") : undefined;
                          return (
                            <Show
                              when={!autoKey()}
                              fallback={
                                <div class="grid-cell cell-edit" role="gridcell">
                                  <input
                                    class="cell-input"
                                    aria-label={t("grid.newRowCell", { name: col.name })}
                                    placeholder={t("pending.auto")}
                                    title={t("pending.autoTitle")}
                                    value=""
                                    disabled
                                  />
                                </div>
                              }
                            >
                              <Show
                                when={fkFor(col.name)}
                                fallback={
                                  <div
                                    class={`grid-cell cell-edit ${conflictClass()}`}
                                    role="gridcell"
                                    title={conflictTitle()}
                                  >
                                    <input
                                      class="cell-input"
                                      aria-label={t("grid.newRowCell", { name: col.name })}
                                      aria-invalid={conflict()}
                                      placeholder={col.name}
                                      value={ins()[col.name] ?? ""}
                                      onInput={(e) =>
                                        props.edit?.onInsertCell(ii, col.name, e.currentTarget.value)
                                      }
                                    />
                                  </div>
                                }
                              >
                                {(lookup) => (
                                  <FkPicker
                                    lookup={lookup()}
                                    rootClass={`grid-cell cell-fk ${conflictClass()}`}
                                    class="cell-input"
                                    value={ins()[col.name] ?? ""}
                                    onChange={(v) => props.edit?.onInsertCell(ii, col.name, v)}
                                  />
                                )}
                              </Show>
                            </Show>
                          );
                        }}
                      </For>
                    </div>
                  )}
                </Index>
              </div>
            </Show>

            <Show when={!filtersActive() && rows().length === 0}>
              <div class="grid-empty-filter">{t("grid.noRows")}</div>
            </Show>

            <Show when={filtersActive() && view().length === 0}>
              <div class="grid-empty-filter">
                {t("grid.noFilterMatch")}
              </div>
            </Show>

            <Show when={result().truncated}>
              <div class="grid-truncated">
                {t(props.onSortColumn ? "grid.truncatedServerSort" : "grid.truncated", {
                  n: rows().length,
                })}
              </div>
            </Show>
          </Show>
        )}
      </Show>

      <Show when={!props.error && !props.result && !props.loading}>
        <Show
          when={props.emptyState}
          fallback={<div class="grid-empty">{t("grid.runToSee")}</div>}
        >
          {props.emptyState}
        </Show>
      </Show>

      <Show when={props.loading}>
        <div class="grid-empty grid-running" role="status">
          <span>{t("grid.running")}</span>
          <Show when={props.onCancel}>
            <button
              class="grid-cancel"
              type="button"
              disabled={!!props.cancelDisabledReason}
              title={props.cancelDisabledReason}
              onClick={() => props.onCancel?.()}
            >
              {t("common.cancel")}
            </button>
          </Show>
        </div>
        <Show when={!props.result}>
          <div class="grid-skeleton" aria-hidden="true">
            <For each={[0, 1, 2, 3, 4, 5]}>{() => <span />}</For>
          </div>
        </Show>
      </Show>
    </div>
  );
}

const ROW_GLYPHS = {
  added: ["+", "grid.rowAdded"],
  changed: ["~", "grid.rowChanged"],
  removed: ["−", "grid.rowRemoved"],
} as const;

/** The gutter's mark for a staged row (issue #690), named for assistive tech. */
function RowGlyph(props: { state: keyof typeof ROW_GLYPHS }) {
  return (
    <span class={`row-glyph glyph-${props.state}`} title={t(ROW_GLYPHS[props.state][1])}>
      <span aria-hidden="true">{ROW_GLYPHS[props.state][0]}</span>
      <span class="visually-hidden">{t(ROW_GLYPHS[props.state][1])}</span>
    </span>
  );
}
