import { For, Show, createMemo } from "solid-js";
import { type RunScope } from "../utils/runScope";
import { formatClock, formatDuration } from "../utils/duration";
import { t } from "../utils/i18n";
import { Icon } from "./icons";
import type { CellSummary } from "../utils/cellSummary";
import type { SafeMode } from "../utils/safeMode";
import { statusItems, type StatusTabKind } from "../utils/statusBar";

/** The connection the active document runs against. */
export interface StatusConnection {
  name: string;
  /** Engine label ("PostgreSQL"). */
  engine: string;
  /** The connection's own colour; the accent when it has none. */
  color?: string;
  /** Working database, when the engine has one. */
  db?: string | null;
  /** The session is gone (issue #407). */
  lost?: boolean;
}

// Bottom status bar (issues #42, #386, #693): context on the left — the
// connection with its colour and engine, a neutral safe-mode chip and the open
// transaction — and the facts of the document on screen on the right, chosen
// per tab kind by utils/statusBar.ts. The pager lives with the rows, and the
// theme and the shortcuts are reached from Settings, the menu and F1.
export function StatusBar(props: {
  connection: StatusConnection | null;
  /** How the connection is protected (issue #666); absent = unprotected. */
  safeMode?: SafeMode;
  /** Statements in the connection's open transaction (issue #667); null/absent
      = no transaction open. */
  txStatements?: number | null;
  /** Commit or roll back the open transaction (the chip is a button then). */
  onTxAction?: (e: MouseEvent) => void;
  /** What the active tab is, which decides the facts on the right. */
  kind: StatusTabKind;
  rowCount: number | null;
  /** Rows the grid's page search leaves on screen (A-05); null/absent = all. */
  matchCount?: number | null;
  truncated: boolean;
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
  /** The editor caret, 1-based (query tabs). */
  cursor?: { line: number; col: number } | null;
  /** Interface zoom in percent (issue #681); shown only away from 100. */
  zoom?: number;
  onResetZoom?: () => void;
}) {
  const items = createMemo(() =>
    statusItems(props.kind, {
      hasObject: !!props.object,
      hasScope: !!props.ranScope,
      rows: props.rowCount,
      columns: props.columnCount ?? null,
      marked: props.markedCount ?? 0,
      hasSummary: !!props.summary,
      elapsedMs: props.elapsedMs,
      hasCursor: !!props.cursor,
    }),
  );

  const summaryText = (s: CellSummary) =>
    [
      t("status.cells", { n: s.count }),
      s.nulls > 0 ? t("status.nulls", { n: s.nulls }) : null,
      s.sum !== undefined ? t("status.sum", { v: s.sum }) : null,
      s.avg !== undefined ? t("status.avg", { v: s.avg }) : null,
      s.min !== undefined ? t("status.min", { v: s.min }) : null,
      s.max !== undefined ? t("status.max", { v: s.max }) : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <footer class="statusbar">
      <span class="status-item status-conn">
        <span
          class={`conn-dot ${props.connection ? (props.connection.lost ? "lost" : "on") : "off"}`}
          style={
            props.connection?.color && !props.connection.lost
              ? { "--conn-accent": props.connection.color }
              : undefined
          }
        />
        <Show when={props.connection} fallback={t("status.noConnection")}>
          {(c) => (
            <>
              <span class="status-conn-name">
                {c().lost ? t("status.connLost", { name: c().name }) : c().name}
              </span>
              <span class="status-dim">
                {c().db ? `${c().engine} · ${c().db}` : c().engine}
              </span>
            </>
          )}
        </Show>
      </span>
      <Show when={props.connection && props.safeMode}>
        <span class="status-chip" title={t("status.safeTitle")}>
          <Icon name="lock" size={11} />
          {t(props.safeMode === "readOnly" ? "safe.badgeReadOnly" : "safe.badgeConfirm")}
        </span>
      </Show>
      <Show when={props.txStatements != null}>
        <button
          class="status-chip status-tx"
          title={t("tx.openTitle", { n: props.txStatements! })}
          disabled={!props.onTxAction}
          onClick={(e) => props.onTxAction?.(e)}
        >
          {t("tx.open", { n: props.txStatements! })}
        </button>
      </Show>
      <span class="status-spacer" />
      <For each={items()}>
        {(item) => {
          switch (item) {
            case "object":
              return <span class="status-item status-object">{props.object}</span>;
            case "scope":
              return (
                <span class="status-item" title={t("status.scopeTitle")}>
                  {t(`scope.${props.ranScope}`)}
                </span>
              );
            case "rows":
              return (
                <span class="status-item" title={props.matchCount != null ? t("grid.searchMatches", { m: props.matchCount, n: props.rowCount! }) : undefined}>
                  {props.matchCount != null
                    ? t("status.rowsMatching", { m: props.matchCount, n: props.rowCount! })
                    : t(props.rowCount === 1 ? "status.rowsOne" : "status.rowsOther", {
                        n: props.rowCount!,
                      })}
                  {props.truncated ? "+" : ""}
                </span>
              );
            case "columns":
              return <span class="status-item">{t("status.columns", { n: props.columnCount! })}</span>;
            case "marked":
              return (
                <span class="status-item" title={t("status.markedTitle")}>
                  {t("status.marked", { n: props.markedCount! })}
                </span>
              );
            case "summary":
              return (
                <span class="status-item" title={t("status.summaryTitle")}>
                  {summaryText(props.summary!)}
                </span>
              );
            case "duration":
              return (
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
              );
            case "cursor":
              return (
                <span class="status-item" title={t("status.cursorTitle")}>
                  {t("status.cursor", { line: props.cursor!.line, col: props.cursor!.col })}
                </span>
              );
          }
        }}
      </For>
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
    </footer>
  );
}
