import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { visibleRange, needsMoreRows } from "../utils/virtualize";
import { formatCell, cellAlign } from "../utils/format";
import type { ResultSet } from "../utils/query";

const ROW_HEIGHT = 28;
const COL_WIDTH = 180;

// Virtualized result grid: only the rows intersecting the viewport are in the
// DOM (see .rules/frontend.md §2). The spacer carries the full scroll height; a
// translateY offsets the rendered window. Pagination is delegated to onNeedMore
// when the user scrolls near the end of a truncated dataset. Cell formatting is
// driven by each column's neutral type (src/utils/format.ts).
export function ResultGrid(props: {
  result: ResultSet | null;
  loading: boolean;
  error: string | null;
  /** Called when more rows should be fetched (truncated dataset, near bottom). */
  onNeedMore?: () => void;
}) {
  let scroller!: HTMLDivElement;
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportH, setViewportH] = createSignal(0);

  onMount(() => {
    setViewportH(scroller.clientHeight);
    const ro = new ResizeObserver(() => setViewportH(scroller.clientHeight));
    ro.observe(scroller);
    onCleanup(() => ro.disconnect());
  });

  const cols = () => props.result?.columns ?? [];
  const rows = () => props.result?.rows ?? [];
  const gridCols = () => `repeat(${cols().length}, ${COL_WIDTH}px)`;

  const range = () =>
    visibleRange({
      scrollTop: scrollTop(),
      viewportHeight: viewportH(),
      rowHeight: ROW_HEIGHT,
      rowCount: rows().length,
    });

  // Ask for more rows when the rendered window approaches the end of a
  // truncated dataset.
  createEffect(() => {
    const r = props.result;
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
              ref={scroller}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
            >
              <div class="grid-inner">
                <div
                  class="grid-header"
                  style={{ "grid-template-columns": gridCols() }}
                >
                  <For each={cols()}>
                    {(col) => (
                      <div class="grid-cell grid-head">
                        <span class="col-name">{col.name}</span>
                        <span class="col-type">{col.type}</span>
                      </div>
                    )}
                  </For>
                </div>

                <div class="grid-spacer" style={{ height: `${range().totalHeight}px` }}>
                  <div
                    class="grid-rows"
                    style={{ transform: `translateY(${range().offsetY}px)` }}
                  >
                    <For each={rows().slice(range().start, range().end)}>
                      {(row) => (
                        <div
                          class="grid-row"
                          style={{ "grid-template-columns": gridCols() }}
                        >
                          <For each={cols()}>
                            {(col, i) => {
                              const cell = formatCell(row[i()] ?? null, col.type);
                              return (
                                <div
                                  class={`grid-cell cell-${cell.kind}`}
                                  style={{ "text-align": cellAlign(cell.kind) }}
                                  title={cell.text}
                                >
                                  {cell.text}
                                </div>
                              );
                            }}
                          </For>
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </div>
            <Show when={result().truncated}>
              <div class="grid-truncated">
                Mostrando las primeras {rows().length} filas (resultado truncado).
              </div>
            </Show>
          </Show>
        )}
      </Show>

      <Show when={!props.error && !props.result && !props.loading}>
        <div class="grid-empty">Ejecuta una consulta para ver resultados.</div>
      </Show>

      <Show when={props.loading}>
        <div class="grid-empty">Ejecutando…</div>
      </Show>
    </div>
  );
}
