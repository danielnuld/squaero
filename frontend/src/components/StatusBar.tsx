import { Show } from "solid-js";
import { themeIcon, type ThemePref } from "../utils/theme";
import { type RunScope } from "../utils/runScope";
import { formatClock, formatDuration } from "../utils/duration";
import { t } from "../utils/i18n";
import type { CellSummary } from "../utils/cellSummary";

// Bottom status bar: active connection, the object the rows came from, the
// pager, and the shape and cost of the last run, plus the theme toggle and
// shortcuts help (issues #42, #386).
//
// It absorbed two whole bands in #386. The pager was a 36 px strip under the
// grid for two buttons and a range, and the information pane another one for
// facts — rows, columns, duration, the object's name — that are status-bar
// items by definition. Values and handlers are passed in by the workspace.
export function StatusBar(props: {
  connection: string | null;
  rowCount: number | null;
  truncated: boolean;
  /** Statements in the connection's open transaction (issue #667); null/absent
      = no transaction open. */
  txStatements?: number | null;
  /** Rows marked in the grid (issue #382); 0 hides the indicator. */
  markedCount?: number;
  /** Summary of the selected cells (issue #670); null/absent hides it. */
  summary?: CellSummary | null;
  elapsedMs: number | null;
  /** When the last run started, epoch ms (issue #643); named in the tooltip. */
  ranAt?: number;
  /** What the last run executed, for the run-scope indicator (issue #130). */
  ranScope?: RunScope | null;
  /** Qualified name of the object the rows came from; null for a free query. */
  object?: string | null;
  /** Columns in the current result; null when there is no result. */
  columnCount?: number | null;
  /** Offset paging (issue #134), absent when the result is not paged. */
  page?: {
    from: number;
    to: number;
    canPrev: boolean;
    canNext: boolean;
    /** Paging is held while there are unsaved cell edits on screen. */
    paused: boolean;
  } | null;
  onPage?: (delta: -1 | 1) => void;
  theme: ThemePref;
  onToggleTheme: () => void;
  onShowHelp: () => void;
  onShowSettings: () => void;
  /** Interface zoom in percent (issue #681); shown only away from 100. */
  zoom?: number;
  onResetZoom?: () => void;
}) {
  return (
    <footer class="statusbar">
      <span class="status-item">
        <span class={`conn-dot ${props.connection ? "on" : "off"}`} />
        {props.connection ?? t("status.noConnection")}
      </span>
      <Show when={props.object}>
        <span class="status-sep" aria-hidden="true">
          /
        </span>
        <span class="status-item status-object">{props.object}</span>
      </Show>
      <Show when={props.txStatements != null}>
        <span class="status-item status-tx" title={t("tx.openTitle", { n: props.txStatements! })}>
          {t("tx.open", { n: props.txStatements! })}
        </span>
      </Show>
      <span class="status-spacer" />
      {/* The pager, formerly a band of its own under the grid. */}
      <Show when={props.page}>
        {(page) => (
          <span class="status-page">
            <button
              class="status-btn"
              disabled={!page().canPrev}
              title={t("result.prev")}
              aria-label={t("result.prev")}
              onClick={() => props.onPage?.(-1)}
            >
              ‹
            </button>
            <span class="status-item status-range">
              {t("result.rowsRange", { from: page().from, to: page().to })}
              <Show when={page().paused}>{t("result.pagingPaused")}</Show>
            </span>
            <button
              class="status-btn"
              disabled={!page().canNext}
              title={t("result.next")}
              aria-label={t("result.next")}
              onClick={() => props.onPage?.(1)}
            >
              ›
            </button>
          </span>
        )}
      </Show>
      <span class="status-spacer" />
      <Show when={props.ranScope}>
        <span class="status-item" title={t("status.scopeTitle")}>
          ▷ {t(`scope.${props.ranScope}`)}
        </span>
      </Show>
      <Show when={props.rowCount !== null}>
        <span class="status-item">
          {t(props.rowCount === 1 ? "status.rowsOne" : "status.rowsOther", {
            n: props.rowCount!,
          })}
          {props.truncated ? "+" : ""}
        </span>
      </Show>
      <Show when={props.columnCount !== null && props.columnCount !== undefined}>
        <span class="status-item">{t("status.columns", { n: props.columnCount! })}</span>
      </Show>
      <Show when={(props.markedCount ?? 0) > 0}>
        <span class="status-item" title={t("status.markedTitle")}>
          {t("status.marked", { n: props.markedCount! })}
        </span>
      </Show>
      <Show when={props.summary}>
        {(s) => (
          <span class="status-item" title={t("status.summaryTitle")}>
            {[
              t("status.cells", { n: s().count }),
              s().nulls > 0 ? t("status.nulls", { n: s().nulls }) : null,
              s().sum !== undefined ? t("status.sum", { v: s().sum! }) : null,
              s().avg !== undefined ? t("status.avg", { v: s().avg! }) : null,
              s().min !== undefined ? t("status.min", { v: s().min! }) : null,
              s().max !== undefined ? t("status.max", { v: s().max! }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </Show>
      <Show when={props.elapsedMs !== null}>
        <span
          class="status-item"
          title={
            props.ranAt === undefined
              ? t("status.durationTitle")
              : t("status.durationTitleAt", { time: formatClock(props.ranAt) })
          }
        >
          {formatDuration(props.elapsedMs!)}
        </span>
      </Show>
      <Show when={props.zoom !== undefined && props.zoom !== 100}>
        <button
          class="status-btn"
          title={`${t("status.zoomTitle")} (Ctrl+0)`}
          aria-label={t("status.zoomTitle")}
          onClick={props.onResetZoom}
        >
          {props.zoom}%
        </button>
      </Show>
      <button
        class="status-btn"
        title={`${t(`theme.${props.theme}`)} (Ctrl+Alt+L)`}
        aria-label={t(`theme.${props.theme}`)}
        onClick={props.onToggleTheme}
      >
        {themeIcon(props.theme)}
      </button>
      <button
        class="status-btn"
        title={t("common.settings")}
        aria-label={t("common.settings")}
        onClick={props.onShowSettings}
      >
        ⚙
      </button>
      <button
        class="status-btn"
        title={`${t("status.shortcuts")} (F1)`}
        aria-label={t("status.shortcuts")}
        onClick={props.onShowHelp}
      >
        ?
      </button>
    </footer>
  );
}
