import { For, Show } from "solid-js";
import type { ResultSet } from "../utils/query";
import type { ResultComparison } from "../utils/resultCompare";
import { formatClock } from "../utils/duration";
import { t } from "../utils/i18n";
import { Icon } from "./icons";

// Pinned results and their comparison (issue #669). Presentational: the
// workspace owns the pins, what is on screen and the comparison itself.

/**
 * A result kept aside so the next run does not replace it. It is the page that
 * was on screen when pinned — nothing is fetched or re-run for it later.
 */
export interface PinnedResult {
  id: number;
  ranAt: number;
  sql: string;
  result: ResultSet;
  /** The first row's position in the full result (paging). */
  offset: number;
  /** The table's key when the result had an edit source; [] otherwise. */
  pk: string[];
}

/** "📌 14:32:05" — how a pin is named everywhere. */
export const pinLabel = (p: PinnedResult) => t("pin.label", { time: formatClock(p.ranAt) });

/** The strip of pins above the result toolbar: the live result, then each pin. */
export function PinStrip(props: {
  pins: PinnedResult[];
  /** The pin on screen, or null for the live result. */
  shown: number | null;
  onSelect: (id: number | null) => void;
  onClose: (id: number) => void;
}) {
  return (
    <div class="result-tabs" role="tablist" aria-label={t("pin.stripAria")}>
      <button
        class="rtab"
        classList={{ on: props.shown === null }}
        role="tab"
        aria-selected={props.shown === null}
        onClick={() => props.onSelect(null)}
      >
        {t("pin.current")}
      </button>
      <For each={props.pins}>
        {(p) => (
          <span class="rtab pin-tab" classList={{ on: props.shown === p.id }}>
            <button
              class="pin-tab-open"
              role="tab"
              aria-selected={props.shown === p.id}
              title={p.sql}
              onClick={() => props.onSelect(p.id)}
            >
              <span class="rtab-label">{pinLabel(p)}</span>
              <span class="rtab-ct">{t("result.setRows", { n: p.result.rows.length })}</span>
            </button>
            <button
              class="pin-tab-close"
              title={t("pin.unpin")}
              aria-label={t("pin.unpin")}
              onClick={() => props.onClose(p.id)}
            >
              <Icon name="close" size={12} />
            </button>
          </span>
        )}
      </For>
    </div>
  );
}

/** Which rows a pin holds, said plainly: it is what was loaded, not a re-run. */
export function pinScope(p: PinnedResult): string {
  const n = p.result.rows.length;
  const rows = n === 0 ? t("pin.noRows") : t("pin.rows", { from: p.offset + 1, to: p.offset + n });
  return `${rows}${p.result.truncated ? ` · ${t("pin.moreExisted")}` : ""} · ${t("pin.notRerun")}`;
}

/** The bar over a pinned result on screen. */
export function PinNote(props: {
  pin: PinnedResult;
  onCompare: (e: MouseEvent) => void;
  onClose: () => void;
}) {
  return (
    <div class="edit-toolbar" role="toolbar" aria-label={t("pin.stripAria")}>
      <span class="pin-note" title={props.pin.sql}>
        <strong>{pinLabel(props.pin)}</strong> · {pinScope(props.pin)}
      </span>
      <span class="toolbar-spacer" />
      <button class="edit-btn edit-btn-menu" aria-haspopup="menu" onClick={(e) => props.onCompare(e)}>
        {t("pin.compare")} <Icon name="chevron-down" size={12} class="eb-caret" />
      </button>
      <button class="edit-btn" onClick={props.onClose}>
        {t("pin.unpin")}
      </button>
    </div>
  );
}

/** The bar over a comparison: what is compared, by what, and what came out. */
export function CompareBar(props: {
  cmp: ResultComparison;
  baseLabel: string;
  otherLabel: string;
  keyColumns: string[];
  onKey: (columns: string[]) => void;
  onClose: () => void;
}) {
  const c = () => props.cmp;
  const count = (s: string) => c().rows.filter((r) => r.status === s).length;
  const toggle = (col: string, on: boolean) =>
    props.onKey(
      on
        ? c().columns.filter((x) => x === col || props.keyColumns.includes(x))
        : props.keyColumns.filter((x) => x !== col),
    );
  const loaded = (n: number, more: boolean) =>
    more ? t("compare.loadedMore", { n }) : t("compare.loaded", { n });
  return (
    <div class="edit-toolbar compare-bar" role="toolbar" aria-label={t("compare.aria")}>
      <span>
        <strong>{props.baseLabel}</strong> → <strong>{props.otherLabel}</strong>
      </span>
      <details class="compare-key">
        <summary>
          {props.keyColumns.length > 0
            ? t("compare.byKey", { cols: props.keyColumns.join(", ") })
            : t("compare.byPosition")}
        </summary>
        <div class="compare-key-list">
          <span class="compare-key-hint">{t("compare.keyHint")}</span>
          <For each={c().columns}>
            {(col) => (
              <label>
                <input
                  type="checkbox"
                  checked={props.keyColumns.includes(col)}
                  onChange={(e) => toggle(col, e.currentTarget.checked)}
                />{" "}
                {col}
              </label>
            )}
          </For>
        </div>
      </details>
      <Show
        when={c().missingKey.length === 0}
        fallback={<span class="edit-error">{t("compare.missingKey", { cols: c().missingKey.join(", ") })}</span>}
      >
        <span class="compare-counts">
          <span class="diff-added">+{count("added")}</span>{" "}
          <span class="diff-removed">−{count("removed")}</span>{" "}
          <span class="diff-changed">~{count("changed")}</span> · {t("compare.same", { n: c().same })}
        </span>
        <Show when={c().duplicateKeys > 0}>
          <span class="edit-error">{t("compare.duplicates", { n: c().duplicateKeys })}</span>
        </Show>
      </Show>
      <Show when={c().onlyLeft.length > 0}>
        <span class="pending-notice">
          {t("compare.onlyIn", { side: props.baseLabel, cols: c().onlyLeft.join(", ") })}
        </span>
      </Show>
      <Show when={c().onlyRight.length > 0}>
        <span class="pending-notice">
          {t("compare.onlyIn", { side: props.otherLabel, cols: c().onlyRight.join(", ") })}
        </span>
      </Show>
      <span class="pending-notice">
        {props.baseLabel}: {loaded(c().loaded.left, c().truncated.left)} · {props.otherLabel}:{" "}
        {loaded(c().loaded.right, c().truncated.right)}
      </span>
      <span class="toolbar-spacer" />
      <button class="edit-btn" onClick={props.onClose}>
        {t("compare.close")}
      </button>
    </div>
  );
}
