import { Show } from "solid-js";
import type { PagerView } from "../utils/pager";
import { t } from "../utils/i18n";
import { Icon } from "./icons";

// The footer under a table's rows (issues #688, A-20, R-38): which rows are on
// screen, «Contar total» to learn of how many, and first/previous/next/last.
// A query's result pages with the same footer, minus the jumps that need an
// offset of their own (issue #693). Presentational: the workspace runs the queries.
export function Pager(props: {
  view: PagerView;
  total: number | null;
  /** The count is running. */
  counting: boolean;
  /** Absent → no «Contar total» (an engine with no cheap count). */
  onCount?: () => void;
  /** Unsaved edits hold the page still (#134). */
  paused: boolean;
  /** Absent (a query's pager, issue #693) → no first/last jumps. */
  onFirst?: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast?: () => void;
}) {
  const range = () =>
    props.total === null
      ? t("result.rowsRange", { from: props.view.from, to: props.view.to })
      : t("result.rowsRangeOf", { from: props.view.from, to: props.view.to, total: props.total });
  return (
    <div class="pager" role="navigation" aria-label={t("pager.aria")}>
      <span class="pager-range">{range()}</span>
      <Show when={props.total === null && props.onCount}>
        <button class="pager-count" disabled={props.counting} onClick={() => props.onCount!()}>
          {props.counting ? t("pager.counting") : t("pager.count")}
        </button>
      </Show>
      <Show when={props.paused}>
        <span class="pager-paused">{t("result.pagingPaused")}</span>
      </Show>
      <span class="toolbar-spacer" />
      <span class="seg" role="group" aria-label={t("pager.pages")}>
        <Show when={props.onFirst}>
          <button class="seg-btn" aria-label={t("pager.first")} title={t("pager.first")} disabled={!props.view.canFirst} onClick={() => props.onFirst!()}>
            <Icon name="chevron-left" size={12} />
            <Icon name="chevron-left" size={12} />
          </button>
        </Show>
        <button class="seg-btn" aria-label={t("pager.prev")} title={t("pager.prev")} disabled={!props.view.canPrev} onClick={() => props.onPrev()}>
          <Icon name="chevron-left" size={12} />
        </button>
        <span class="seg-btn on" aria-current="page">
          {props.view.pages === null
            ? props.view.page
            : t("pager.pageOf", { page: props.view.page, pages: props.view.pages })}
        </span>
        <button class="seg-btn" aria-label={t("pager.next")} title={t("pager.next")} disabled={!props.view.canNext} onClick={() => props.onNext()}>
          <Icon name="chevron-right" size={12} />
        </button>
        <Show when={props.onLast}>
          <button
            class="seg-btn"
            aria-label={t("pager.last")}
            title={props.view.pages === null ? t("pager.lastNeedsCount") : t("pager.last")}
            disabled={!props.view.canLast}
            onClick={() => props.onLast!()}
          >
            <Icon name="chevron-right" size={12} />
            <Icon name="chevron-right" size={12} />
          </button>
        </Show>
      </span>
    </div>
  );
}
