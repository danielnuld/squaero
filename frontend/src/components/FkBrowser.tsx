import { Show, createMemo, createSignal } from "solid-js";
import { Portal } from "solid-js/web";
import { filterRows, fkValueIndex, type FkLookup } from "../utils/fkLookup";
import type { ResultSet } from "../utils/query";
import { t } from "../utils/i18n";
import { Dialog } from "./Dialog";
import { ResultGrid } from "./ResultGrid";

// The rows of a referenced table, to pick the one a foreign key should point at
// (issue #300). A modal in a Portal: a popup anchored inside the result grid
// would fight its virtualizing `transform`, and you pick a key by RECOGNISING
// the row, so the dialog shows every column of it.
//
// The rows are the app's own grid (A-40): select a row and press Seleccionar,
// Enter or double-click it — one button below, not an «Elegir» on every row.
// The rows are already loaded (App fetches them when the edit session starts),
// so this component is pure presentation: filter, show, pick.
export function FkBrowser(props: {
  lookup: FkLookup;
  /** The value the cell holds now, said in the subtitle. */
  current: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = createSignal("");
  const [selected, setSelected] = createSignal<number | null>(null);

  const valueIdx = createMemo(() => fkValueIndex(props.lookup.columns, props.lookup.toColumn));
  const shown = createMemo(() => filterRows(props.lookup.rows, query()));
  const result = createMemo<ResultSet>(() => ({
    columns: props.lookup.columns,
    rows: shown().map((r) => r.row),
    truncated: false,
    rowsAffected: 0,
  }));
  const pick = (rowIndex: number | null) => {
    const row = rowIndex === null ? undefined : shown()[rowIndex]?.row;
    if (row) props.onPick(row[valueIdx()] ?? "");
  };

  return (
    <Portal>
      {/* The shared Dialog swallows Escape in the capture phase, so it never
          also closes the row detail behind it; Enter presses Seleccionar. */}
      <Dialog
        title={t("fk.title", { table: props.lookup.toTable })}
        size="lg"
        class="fk-browser"
        onCancel={props.onClose}
        primary={{
          label: t("fk.select"),
          onClick: () => pick(selected()),
          disabled: selected() === null,
        }}
        helpers={
          <span class="fk-browser-count">
            {t("fk.count", { n: shown().length })}
            <Show when={props.lookup.truncated}> · {t("fk.truncated")}</Show>
            {" · "}
            {t("fk.howTo")}
          </span>
        }
      >
        <p class="fk-browser-sub">
          {t("fk.subtitle", { column: props.lookup.toColumn })}
          <Show when={props.current !== ""}>
            {" "}
            {t("fk.currentValue", { value: props.current })}
          </Show>
        </p>

        <input
          class="fk-browser-filter"
          type="search"
          placeholder={t("fk.filterPlaceholder")}
          aria-label={t("fk.filterPlaceholder")}
          value={query()}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setSelected(null);
          }}
        />

        <div class="fk-browser-scroll">
          <Show
            when={shown().length > 0}
            fallback={<p class="fk-browser-empty">{t("fk.noMatch")}</p>}
          >
            <ResultGrid
              result={result()}
              loading={false}
              error={null}
              keyColumns={[props.lookup.toColumn]}
              onSelectedRowChange={setSelected}
              onRowActivate={pick}
            />
          </Show>
        </div>
      </Dialog>
    </Portal>
  );
}
