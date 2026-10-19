import { Show } from "solid-js";
import { PAGE_SIZES, offsetForPage, type PagerView } from "../utils/pager";
import { t } from "../utils/i18n";
import { Icon } from "./icons";
import { Dropdown } from "./Dropdown";

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
  /** Rows per page; with `onPageSize`, a selector of PAGE_SIZES (A-20, R-38). */
  pageSize?: number;
  onPageSize?: (size: number) => void;
  /** Jump to an offset: with it the page number is a field (R-38). */
  onGoTo?: (offset: number) => void;
}) {
  /** Enter or leaving the field goes to the typed page; a bad one snaps back. */
  const goTo = (input: HTMLInputElement) => {
    const offset = offsetForPage(input.value, props.pageSize ?? 1, props.view.pages);
    if (offset === null || Math.floor(offset / Math.max(1, props.pageSize ?? 1)) + 1 === props.view.page) {
      input.value = String(props.view.page);
      return;
    }
    props.onGoTo!(offset);
  };
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
      <Show when={props.onPageSize && props.pageSize}>
        {(size) => (
          <Dropdown
            class="pager-size"
            aria-label={t("pager.size")}
            title={t("pager.size")}
            value={String(size())}
            disabled={props.paused}
            options={PAGE_SIZES.map((n) => ({
              value: String(n),
              label: t("pager.sizeOption", { n }),
            }))}
            onChange={(v) => props.onPageSize!(Number(v))}
          />
        )}
      </Show>
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
        <Show
          when={props.onGoTo && props.pageSize}
          fallback={
            <span class="seg-btn on" aria-current="page">
              {props.view.pages === null
                ? props.view.page
                : t("pager.pageOf", { page: props.view.page, pages: props.view.pages })}
            </span>
          }
        >
          <span class="seg-btn on pager-page" aria-current="page">
            <input
              class="pager-page-input"
              type="text"
              inputmode="numeric"
              aria-label={t("pager.pageField")}
              disabled={props.paused}
              value={props.view.page}
              size={Math.max(2, String(props.view.pages ?? props.view.page).length)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  goTo(e.currentTarget);
                }
                if (e.key === "Escape") e.currentTarget.value = String(props.view.page);
              }}
              onBlur={(e) => goTo(e.currentTarget)}
            />
            <Show when={props.view.pages !== null}>
              <span>{t("pager.ofPages", { pages: props.view.pages! })}</span>
            </Show>
          </span>
        </Show>
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
