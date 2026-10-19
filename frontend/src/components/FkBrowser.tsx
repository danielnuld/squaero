import { For, Show, createMemo, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import { formatCell, cellAlign } from "../utils/format";
import { filterRows, fkValueIndex, type FkLookup } from "../utils/fkLookup";
import { t } from "../utils/i18n";
import { Dialog } from "./Dialog";

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

  const valueIdx = createMemo(() => fkValueIndex(props.lookup.columns, props.lookup.toColumn));
  const shown = createMemo(() => filterRows(props.lookup.rows, query()));

  return (
    <Portal>
      {/* The shared Dialog swallows Escape in the capture phase, so it never
          also closes the row detail behind it. */}
      <Dialog
        title={t("fk.title", { table: props.lookup.toTable })}
        size="lg"
        class="fk-browser"
        onCancel={props.onClose}
        cancelLabel={t("panel.close")}
        helpers={
          <span class="fk-browser-count">
            {t("fk.count", { n: shown().length })}
            <Show when={props.lookup.truncated}> · {t("fk.truncated")}</Show>
          </span>
        }
      >
          <div class="fk-browser-head">
            <p class="fk-browser-sub">
              {t("fk.subtitle", {
                table: props.lookup.toTable,
                column: props.lookup.toColumn,
              })}
            </p>
          </div>

          <input
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
      </Dialog>
    </Portal>
  );
}
