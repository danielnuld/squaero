import { Show, createSignal } from "solid-js";
import { FkBrowser } from "./FkBrowser";
import { fkHint, type FkLookup } from "../utils/fkLookup";
import { t } from "../utils/i18n";

// The value editor for a foreign-key cell (issue #300): a free-text input — a FK
// is still just a value, and a valid one can always be typed — plus a visible
// button that opens the REFERENCED table's rows in a browser dialog (FkBrowser),
// so the user can see and search what is allowed instead of remembering an id.
export function FkPicker(props: {
  lookup: FkLookup;
  value: string;
  disabled?: boolean;
  /** Extra classes for the input, so the grid and the row detail keep their look. */
  class?: string;
  /** Extra classes for the wrapper (the grid needs it to BE a grid cell). */
  rootClass?: string;
  /** The grid's cell address, so keyboard focus still finds this input. */
  dataCell?: string;
  onChange: (value: string) => void;
}) {
  const [browsing, setBrowsing] = createSignal(false);

  return (
    <div class={`fk-picker ${props.rootClass ?? ""}`}>
      <input
        class={`fk-value ${props.class ?? ""}`}
        disabled={props.disabled}
        data-cell={props.dataCell}
        value={props.value}
        title={fkHint(props.lookup)}
        onInput={(e) => props.onChange(e.currentTarget.value)}
      />
      <button
        type="button"
        class="fk-toggle"
        disabled={props.disabled}
        aria-label={t("fk.open", { table: props.lookup.toTable })}
        title={t("fk.open", { table: props.lookup.toTable })}
        onClick={() => setBrowsing(true)}
      >
        ⋯
      </button>

      <Show when={browsing()}>
        <FkBrowser
          lookup={props.lookup}
          current={props.value}
          onPick={(v) => {
            props.onChange(v);
            setBrowsing(false);
          }}
          onClose={() => setBrowsing(false)}
        />
      </Show>
    </div>
  );
}
