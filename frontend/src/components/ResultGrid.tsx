import { For, Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from "solid-js";
import { visibleRange, needsMoreRows } from "../utils/virtualize";
import { formatCell, cellAlign } from "../utils/format";
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
}) {
  const rowHeight = () => props.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportH, setViewportH] = createSignal(0);

  // The scroller is rendered only once a result with columns exists, and it can
  // come and go across queries, so we measure it from a callback ref rather than
  // onMount (which fires once, possibly before any result). This attaches — and
  // re-attaches — a ResizeObserver whenever the scroller element appears.
  let ro: ResizeObserver | undefined;
  const attachScroller = (el: HTMLDivElement) => {
    setViewportH(el.clientHeight);
    ro?.disconnect();
    ro = new ResizeObserver(() => setViewportH(el.clientHeight));
    ro.observe(el);
  };
  onCleanup(() => ro?.disconnect());

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
    setWidths(computeColumnWidths(cols(), rows()));
  });
  const view = createMemo(() => buildViewIndices(rows(), cols(), sort(), filters()));
  const filtersActive = () => Object.values(filters()).some((q) => q.trim() !== "");
  const toggleSort = (col: number) => setSort((s) => cycleSort(s, col));
  const setFilter = (col: number, q: string) => setFilters((f) => ({ ...f, [col]: q }));
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
                {result().rowsAffected} fila(s) afectada(s).
              </div>
            }
          >
            <div
              class="grid-scroll"
              ref={attachScroller}
              style={{ "--grid-row-h": `${rowHeight()}px` }}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
              <div class="grid-inner">
                <div
                  class="grid-header"
                  style={{ "grid-template-columns": gridCols() }}
                >
                  <Show when={editing()}>
                    <div class="grid-cell grid-head grid-action" />
                  </Show>
                  <For each={cols()}>
                    {(col, ci) => (
                      <div
                        class="grid-cell grid-head grid-head-sort"
                        role="button"
                        tabindex={0}
                        title="Ordenar (asc / desc / ninguno)"
                        onClick={() => toggleSort(ci())}
                        onKeyDown={(e) =>
                          (e.key === "Enter" || e.key === " ") &&
                          (e.preventDefault(), toggleSort(ci()))
                        }
                      >
                        <span class="col-name">{col.name}</span>
                        <span class="col-type">{col.type}</span>
                        <span class="col-sort">{sortGlyph(sort(), ci())}</span>
                        <span
                          class="col-resize"
                          title="Ajustar ancho de columna"
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
                  style={{ "grid-template-columns": gridCols() }}
                >
                  <Show when={editing()}>
                    <div class="grid-cell grid-action" />
                  </Show>
                  <For each={cols()}>
                    {(_col, ci) => (
                      <div class="grid-cell grid-filter-cell">
                        <input
                          class="grid-filter-input"
                          type="search"
                          placeholder="Filtrar…"
                          aria-label={`Filtrar por ${cols()[ci()].name}`}
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
                            style={{ "grid-template-columns": gridCols() }}
                          >
                            <Show when={editing()}>
                              <button
                                class="grid-cell grid-action danger"
                                title={isDeleted(rowIndex()) ? "Deshacer borrado" : "Borrar fila"}
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
                                      return (
                                        <div
                                          class={`grid-cell cell-${cell.kind}`}
                                          style={{ "text-align": cellAlign(cell.kind) }}
                                          title={cell.text}
                                          onContextMenu={(e) =>
                                            props.onCellContext?.(e, rowIndex(), ci())
                                          }
                                        >
                                          {cell.text}
                                        </div>
                                      );
                                    })()}
                                  >
                                    <input
                                      class="grid-cell cell-input"
                                      disabled={isDeleted(rowIndex())}
                                      value={cellValue(rowIndex(), col.name, original()) ?? ""}
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
              <div class="grid-inserts">
                <div class="grid-inserts-title">Nuevas filas</div>
                <For each={props.edit?.pending.inserts ?? []}>
                  {(ins, ii) => (
                    <div
                      class="grid-row row-insert"
                      style={{ "grid-template-columns": gridCols() }}
                    >
                      <button
                        class="grid-cell grid-action danger"
                        title="Quitar fila nueva"
                        onClick={() => props.edit?.onRemoveInsert(ii())}
                      >
                        ✕
                      </button>
                      <For each={cols()}>
                        {(col) => (
                          <input
                            class="grid-cell cell-input"
                            placeholder={col.name}
                            value={ins[col.name] ?? ""}
                            onInput={(e) =>
                              props.edit?.onInsertCell(ii(), col.name, e.currentTarget.value)
                            }
                          />
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            <Show when={filtersActive() && view().length === 0}>
              <div class="grid-empty-filter">
                Ninguna fila de la página coincide con el filtro.
              </div>
            </Show>

            <Show when={result().truncated}>
              <div class="grid-truncated">
                Mostrando las primeras {rows().length} filas (resultado truncado). El
                orden y los filtros se aplican solo sobre las filas cargadas, no con
                ORDER BY/WHERE en el servidor.
              </div>
            </Show>
          </Show>
        )}
      </Show>

      <Show when={!props.error && !props.result && !props.loading}>
        <Show
          when={props.emptyState}
          fallback={<div class="grid-empty">Ejecuta una consulta para ver resultados.</div>}
        >
          {props.emptyState}
        </Show>
      </Show>

      <Show when={props.loading}>
        <div class="grid-empty">Ejecutando…</div>
      </Show>
    </div>
  );
}
