import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { formatCell, cellAlign } from "../utils/format";
import { filterRows, fkValueIndex, type FkLookup } from "../utils/fkLookup";
import { t } from "../utils/i18n";

// The rows of a referenced table, as a real grid you can read and search, with an
// explicit "Elegir" on every row (issue #300). This replaces an earlier floating
// dropdown, for two reasons that both bit in the real app:
//
//   - A popup anchored inside the result grid is fighting the grid: the rows are
//     virtualized with a CSS `transform`, which makes a transformed ancestor the
//     containing block of any position:fixed child, so the popup landed off-target
//     and was clipped by the scroller. A modal in a Portal has no such ancestor.
//   - A two-column "id — label" list answers less than the question does. You pick
//     a foreign key by RECOGNISING the row, so the dialog shows every column of it.
//
// The rows are already loaded (App fetches them when the edit session starts), so
// this component is pure presentation: filter, show, pick.
export function FkBrowser(props: {
  lookup: FkLookup;
  /** The value the cell holds now, marked in the list. */
  current: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal("");
  let filterEl: HTMLInputElement | undefined;

  const valueIdx = createMemo(() => fkValueIndex(props.lookup.columns, props.lookup.toColumn));
  const shown = createMemo(() => filterRows(props.lookup.rows, query()));

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation(); // never let Escape also close the row detail behind us
      props.onClose();
    }
  };
  onMount(() => {
    document.addEventListener("keydown", onKeyDown, true);
    filterEl?.focus();
  });
  onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));

  return (
    <Portal>
      <div
        class="modal-backdrop"
        onClick={(e) => e.target === e.currentTarget && props.onClose()}
      >
        <div class="modal fk-browser" role="dialog" aria-modal="true" aria-label={t("fk.title", { table: props.lookup.toTable })}>
          <div class="fk-browser-head">
            <h2>{t("fk.title", { table: props.lookup.toTable })}</h2>
            <p class="fk-browser-sub">
              {t("fk.subtitle", {
                table: props.lookup.toTable,
                column: props.lookup.toColumn,
              })}
            </p>
          </div>

          <input
            ref={filterEl}
            class="fk-browser-filter"
            type="search"
            placeholder={t("fk.filterPlaceholder")}
            aria-label={t("fk.filterPlaceholder")}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />

          <div class="fk-browser-scroll">
            <Show
              when={shown().length > 0}
              fallback={<p class="fk-browser-empty">{t("fk.noMatch")}</p>}
            >
              <table class="fk-table">
                <thead>
                  <tr>
                    <th class="fk-pick-head" />
                    <For each={props.lookup.columns}>
                      {(c) => (
                        <th title={c.type}>
                          <span class="col-name">{c.name}</span>
                          <span class="col-type">{c.type}</span>
                        </th>
                      )}
                    </For>
                  </tr>
                </thead>
                <tbody>
                  <For each={shown()}>
                    {(r) => {
                      const value = () => r.row[valueIdx()] ?? "";
                      const isCurrent = () => value() === props.current;
                      return (
                        <tr class={isCurrent() ? "fk-row-current" : ""}>
                          <td class="fk-pick-cell">
                            <button
                              type="button"
                              class="fk-pick"
                              onClick={() => props.onPick(value())}
                            >
                              {t("fk.pick")}
                            </button>
                          </td>
                          <For each={props.lookup.columns}>
                            {(col, ci) => {
                              const cell = formatCell(r.row[ci()] ?? null, col.type);
                              return (
                                <td
                                  class={`cell-${cell.kind} ${ci() === valueIdx() ? "fk-key-cell" : ""}`}
                                  style={{ "text-align": cellAlign(cell.kind) }}
                                  title={cell.text}
                                >
                                  {cell.text}
                                </td>
                              );
                            }}
                          </For>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </Show>
          </div>

          <div class="modal-actions">
            <span class="fk-browser-count">
              {t("fk.count", { n: shown().length })}
              <Show when={props.lookup.truncated}> · {t("fk.truncated")}</Show>
            </span>
            <span class="toolbar-spacer" />
            <button class="primary" onClick={props.onClose}>
              {t("panel.close")}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
