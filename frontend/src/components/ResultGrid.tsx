import { For, Index, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js";
import { visibleRange, needsMoreRows } from "../utils/virtualize";
import { formatCell, cellAlign, boolTo01, classifyType } from "../utils/format";
import { moveSelection, scrollRowIntoView, isNavKey, type CellPos } from "../utils/gridNav";
import {
  buildViewIndices,
  cycleSort,
  sortGlyph,
  type SortState,
  type ColumnFilters,
} from "../utils/gridView";
import { computeColumnWidths, resizeColumn, MIN_COL_WIDTH } from "../utils/gridColumns";
import type { ResultSet } from "../utils/query";
import type { PendingChanges } from "../utils/editSession";
import type { FkLookup } from "../utils/fkLookup";
import { FkPicker } from "./FkPicker";
import { IconRelated } from "./icons";
import { t } from "../utils/i18n";

const DEFAULT_ROW_HEIGHT = 28;
const ACTION_WIDTH = 36;

/**
 * Edit hooks passed by the workspace when the active tab is in edit mode over an
 * editable (primary-keyed) table. When absent or `active` is false the grid is
 * read-only, exactly as before.
 */
export interface GridEdit {
  active: boolean;
  pending: PendingChanges;
  onEditCell: (rowIndex: number, column: string, value: string) => void;
  onToggleDelete: (rowIndex: number) => void;
  onInsertCell: (insertIndex: number, column: string, value: string) => void;
  onRemoveInsert: (insertIndex: number) => void;
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
  /** Rich content for the no-result state (issue #178). When absent a plain
      "run a query" message is shown. Only rendered before the tab has a result. */
  emptyState?: JSX.Element;
  /** Ask the workspace to enter edit mode (double-click / Enter on a cell in a
      read-only but editable table). No-op when absent → the grid stays read-only. */
  onRequestEdit?: () => void;
  /** Cancel the running query (op.cancel). When present, a Cancelar button shows
      alongside the "Ejecutando…" state; absent → no cancel affordance. */
  onCancel?: () => void;
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
   * Sort at the SERVER instead of in the browser (issue #347). Given, a header
   * click hands the column name up rather than reordering the rows already
   * fetched — which over a truncated result reordered an arbitrary sample. The
   * current server sort comes back as `sortedColumn` so the header can show it.
   */
  onSortColumn?: (column: string) => void;
  sortedColumn?: { column: string; dir: "ASC" | "DESC" } | null;
  /** The table's primary key columns. Marked in the header so a grid of rows
      from a table you did not open says which column identifies each one —
      asked for on the related-data modal, where the rows belong to a table the
      user never chose and whose key they have no reason to know. */
  keyColumns?: string[];
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
  // position (r) and column (c). Click selects; arrow keys move; double-click or
  // Enter on a selected cell requests edit mode. `pendingEditFocus` remembers the
  // cell to focus once the (async) edit session turns on.
  const [sel, setSel] = createSignal<CellPos | null>(null);
  const [pendingEditFocus, setPendingEditFocus] = createSignal<CellPos | null>(null);

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
  const editing = () => props.edit?.active ?? false;

  // Client-side sort + filter over the loaded page (issue #132). The view is a
  // list of ORIGINAL row indices in display order, so edit hooks stay keyed by
  // original index. Both reset whenever a new result loads.
  const [sort, setSort] = createSignal<SortState | null>(null);
  const [filters, setFilters] = createSignal<ColumnFilters>({});
  // Per-column widths (issue: grid visual pass). Seeded content-aware from the
  // new result and then adjustable by dragging the header resize handles.
  const [widths, setWidths] = createSignal<number[]>([]);
  createEffect(() => {
    props.result; // reset on identity change
    setSort(null);
    setFilters({});
    setSel(null);
    setWidths(computeColumnWidths(cols(), rows()));
    // A new result is read from its first row: the scroller survives when one
    // result replaces another, so its position would otherwise carry over into
    // rows that have nothing to do with the old ones (issue #313).
    setScrollTop(0);
    if (scrollerEl) scrollerEl.scrollTop = 0;
  });
  const view = createMemo(() => buildViewIndices(rows(), cols(), sort(), filters()));
  const filtersActive = () => Object.values(filters()).some((q) => q.trim() !== "");
  // Sort/filter reorder or shrink the view, so a view-position selection would
  // point at a different row — clear it (matches the reset on a new result).
  const toggleSort = (col: number) => {
    const server = props.onSortColumn;
    if (server) {
      const name = cols()[col]?.name;
      if (name) server(name);
      setSel(null);
      return;
    }
    setSort((s) => cycleSort(s, col));
    setSel(null);
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
    setSel(null);
  };
  const colWidth = (ci: number) => widths()[ci] ?? 180;
  const gridCols = () => {
    const body = cols()
      .map((_c, ci) => `${colWidth(ci)}px`)
      .join(" ");
    return editing() ? `${ACTION_WIDTH}px ${body}` : body;
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

  // Once the (async) edit session turns on, focus the cell that requested it.
  createEffect(() => {
    if (!editing()) return;
    const f = pendingEditFocus();
    if (!f || !scrollerEl) return;
    setPendingEditFocus(null);
    queueMicrotask(() => {
      // data-cell is on the cell element: a <div> in both modes now (an editable
      // cell wraps its input so the wrapper can be the gridcell). Reach the input
      // through it, and tolerate the older shape where the input carried the
      // attribute itself.
      const el = scrollerEl?.querySelector(`[data-cell="${f.r}-${f.c}"]`);
      const input = (el?.tagName === "INPUT" ? el : el?.querySelector("input")) as
        | HTMLInputElement
        | null
        | undefined;
      input?.focus();
      input?.select();
    });
  });

  const selectCell = (viewPos: number, c: number) => {
    setSel({ r: viewPos, c });
    scrollerEl?.focus({ preventScroll: true });
  };

  // Enter edit mode targeting a cell (double-click / Enter). No-op if already
  // editing or the table isn't editable (onRequestEdit absent).
  const requestEditAt = (pos: CellPos) => {
    if (editing() || !props.onRequestEdit) return;
    setPendingEditFocus(pos);
    props.onRequestEdit();
  };

  const onGridKeyDown = (e: KeyboardEvent) => {
    // Only act when focus is on the grid surface itself: inputs (edit cells,
    // filter boxes) and the focusable sort-header cells own their own keys.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.closest(".grid-head-sort"))) return;
    if (e.key === "Enter") {
      const s = sel();
      if (s) {
        e.preventDefault();
        requestEditAt(s);
      }
      return;
    }
    if (!isNavKey(e.key)) return;
    e.preventDefault();
    setSel((s) => moveSelection(s, e.key, view().length, cols().length));
  };

  const isSelected = (viewPos: number, c: number) => {
    const s = sel();
    return !!s && s.r === viewPos && s.c === c;
  };

  // Publish the selected ROW (index into result.rows, not into the sorted or
  // filtered view) for panels that act on it from their bar.
  createEffect(() => {
    const s = sel();
    props.onSelectedRowChange?.(s === null ? null : (view()[s.r] ?? null));
  });

  return (
    <div class="grid">
      <Show when={props.error}>
        <div class="grid-error" role="alert">
          {props.error}
        </div>
      </Show>


      <Show when={!props.error && props.result}>
        {(result) => (
          <Show
            when={cols().length > 0}
            fallback={
              <div class="grid-empty">
                {t("grid.rowsAffected", { n: result().rowsAffected })}
              </div>
            }
          >
            <div
              class="grid-scroll"
              ref={attachScroller}
              // Roles, so the result is a grid to assistive tech and not a pile of
              // divs. The counts are the TOTALS, not what the virtual window happens
              // to render: aria-rowcount/aria-rowindex exist precisely so a
              // virtualized grid can still say "row 1001 of 1200" (issue #326).
              role="grid"
              aria-label={t("grid.ariaLabel")}
              aria-rowcount={rows().length + 1}
              aria-colcount={cols().length}
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
                  <Show when={editing()}>
                    <div class="grid-cell grid-head grid-action" />
                  </Show>
                  <For each={cols()}>
                    {(col, ci) => (
                      <div
                        class="grid-cell grid-head grid-head-sort"
                        role="columnheader"
                        aria-colindex={ci() + 1}
                        aria-sort={sortDirOf(ci())}
                        tabindex={0}
                        title={t("grid.sort")}
                        onClick={() => toggleSort(ci())}
                        onKeyDown={(e) =>
                          (e.key === "Enter" || e.key === " ") &&
                          (e.preventDefault(), toggleSort(ci()))
                        }
                      >
                        <span class={`col-name ${isReferenced(col.name) ? "col-referenced" : ""}`}>
                          {col.name}
                        </span>
                        <Show when={isKey(col.name)}>
                          {/* Not aria-hidden like the reference mark beside it:
                              "this is the key" is the sort of thing a header has
                              to say out loud, not only draw. */}
                          <span class="col-key-mark" title={t("grid.pkColumn")}>
                            <span aria-hidden="true">🔑</span>
                            <span class="visually-hidden">{t("grid.pkColumn")}</span>
                          </span>
                        </Show>
                        <Show when={isReferenced(col.name)}>
                          <span class="col-ref-mark" title={t("related.refColumn")} aria-hidden="true">
                            ⇲
                          </span>
                        </Show>
                        <span class="col-type">{col.type}</span>
                        <span class="col-sort">
                          {props.onSortColumn
                            ? { ascending: "▲", descending: "▼", none: "" }[sortDirOf(ci())]
                            : sortGlyph(sort(), ci())}
                        </span>
                        <span
                          class="col-resize"
                          title={t("grid.resize")}
                          aria-hidden="true"
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
                    )}
                  </For>
                </div>

                <div
                  class="grid-filter"
                  role="row"
                  style={{ "grid-template-columns": gridCols() }}
                >
                  <Show when={editing()}>
                    <div class="grid-cell grid-action" />
                  </Show>
                  <For each={cols()}>
                    {(_col, ci) => (
                      <div class="grid-cell grid-filter-cell" role="gridcell">
                        <input
                          class="grid-filter-input"
                          type="search"
                          placeholder={t("grid.filterPlaceholder")}
                          aria-label={t("grid.filterBy", { name: cols()[ci()].name })}
                          value={filters()[ci()] ?? ""}
                          onInput={(e) => setFilter(ci(), e.currentTarget.value)}
                        />
                      </div>
                    )}
                  </For>
                </div>

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
                            class={`grid-row ${zebra()} ${isDeleted(rowIndex()) ? "row-deleted" : ""}`}
                            role="row"
                            aria-rowindex={viewPos() + 2}
                            style={{ "grid-template-columns": gridCols() }}
                          >
                            <Show when={editing()}>
                              <button
                                class="grid-cell grid-action danger"
                                title={isDeleted(rowIndex()) ? t("grid.undoDelete") : t("grid.deleteRow")}
                                onClick={() => props.edit?.onToggleDelete(rowIndex())}
                              >
                                {isDeleted(rowIndex()) ? "↩" : "🗑"}
                              </button>
                            </Show>
                            <For each={cols()}>
                              {(col, ci) => {
                                const original = () => row()[ci()] ?? null;
                                return (
                                  <Show
                                    when={editing()}
                                    fallback={(() => {
                                      const cell = formatCell(original(), col.type);
                                      const related = () =>
                                        !!props.onRelated && isReferenced(col.name);
                                      return (
                                        <div
                                          class={`grid-cell cell-${cell.kind} ${isSelected(viewPos(), ci()) ? "cell-selected" : ""} ${related() ? "cell-related" : ""}`}
                                          role="gridcell"
                                          aria-colindex={ci() + 1}
                                          aria-selected={isSelected(viewPos(), ci())}
                                          style={{ "text-align": cellAlign(cell.kind) }}
                                          title={cell.text}
                                          data-cell={`${viewPos()}-${ci()}`}
                                          onClick={() => selectCell(viewPos(), ci())}
                                          onDblClick={() => {
                                            selectCell(viewPos(), ci());
                                            requestEditAt({ r: viewPos(), c: ci() });
                                          }}
                                          onContextMenu={(e) =>
                                            props.onCellContext?.(e, rowIndex(), ci())
                                          }
                                        >
                                          {cell.text}
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
                                          class="grid-cell cell-edit"
                                          role="gridcell"
                                          aria-colindex={ci() + 1}
                                          data-cell={`${viewPos()}-${ci()}`}
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
                                          onContextMenu={(e) =>
                                            props.onCellContext?.(e, rowIndex(), ci())
                                          }
                                        />
                                        </div>
                                      }
                                    >
                                      {(lookup) => (
                                        <FkPicker
                                          lookup={lookup()}
                                          rootClass="grid-cell cell-fk"
                                          class="cell-input"
                                          dataCell={`${viewPos()}-${ci()}`}
                                          disabled={isDeleted(rowIndex())}
                                          value={cellValue(rowIndex(), col.name, original()) ?? ""}
                                          onChange={(v) =>
                                            props.edit?.onEditCell(rowIndex(), col.name, v)
                                          }
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
                      class="grid-row row-insert"
                      role="row"
                      style={{ "grid-template-columns": gridCols() }}
                    >
                      <button
                        class="grid-cell grid-action danger"
                        title={t("grid.removeNewRow")}
                        onClick={() => props.edit?.onRemoveInsert(ii)}
                      >
                        ✕
                      </button>
                      <For each={cols()}>
                        {(col) => (
                          <Show
                            when={fkFor(col.name)}
                            fallback={
                              <div class="grid-cell cell-edit" role="gridcell">
                                <input
                                  class="cell-input"
                                  aria-label={t("grid.newRowCell", { name: col.name })}
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
                                rootClass="grid-cell cell-fk"
                                class="cell-input"
                                value={ins()[col.name] ?? ""}
                                onChange={(v) => props.edit?.onInsertCell(ii, col.name, v)}
                              />
                            )}
                          </Show>
                        )}
                      </For>
                    </div>
                  )}
                </Index>
              </div>
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
        <div class="grid-empty grid-running">
          <span>{t("grid.running")}</span>
          <Show when={props.onCancel}>
            <button
              class="grid-cancel"
              type="button"
              onClick={() => props.onCancel?.()}
            >
              {t("common.cancel")}
            </button>
          </Show>
        </div>
      </Show>
    </div>
  );
}
