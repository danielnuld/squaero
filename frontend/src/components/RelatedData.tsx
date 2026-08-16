import { For, Show, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { t } from "../utils/i18n";
import type { RelatedQuery } from "../utils/relatedData";
import type { ResultSet } from "../utils/query";
import { ResultGrid } from "./ResultGrid";

// "Datos relacionados" of one row (issue #310): the tables that depend on it by
// foreign key, and the rows of the one being looked at.
//
// Master-detail on purpose: the dependent tables live in a narrow side column so
// the RESULT — what the user came to see — gets the rest of the dialog. Each
// entry carries its row count, which is the actual question being asked ("does
// this record have dependents?"); without it the user would have to click every
// relationship to find out.
//
// Presentational: every query runs in App, which owns the connection.
export function RelatedData(props: {
  /** The row's table and the column the modal was opened from. */
  table: string;
  column: string;
  value: string;
  /** One entry per relationship, already filtered for this row: the row this
      cell points at (tagged `parent`) and the rows that point at it. */
  queries: RelatedQuery[];
  /** Row count by query index: absent = still counting, null = unknown (failed). */
  counts: Record<number, number | null>;
  selected: number;
  onSelect: (index: number) => void;
  /** The SQL of the selected relationship (null when it cannot be filtered). */
  sql: string | null;
  /** Primary key of the dependent table being shown, marked in its header: the
      rows belong to a table the user did not open, so nothing else says which
      column identifies one. Empty while it is still being described. */
  keyColumns: string[];
  result: ResultSet | null;
  loading: boolean;
  error: string | null;
  /** The FK catalog query hit the row cap: the list may be incomplete. */
  truncated: boolean;
  /** Why this engine has no foreign keys, when it has none. */
  unsupported: string | null;
  onOpenTab: () => void;
  onToEditor: () => void;
  onClose: () => void;
}) {
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      props.onClose();
    }
  };
  onMount(() => document.addEventListener("keydown", onKeyDown, true));
  onCleanup(() => document.removeEventListener("keydown", onKeyDown, true));

  const current = () => props.queries[props.selected];
  const withData = () =>
    props.queries.filter((_, i) => (props.counts[i] ?? 0) > 0).length;
  const counted = () => props.queries.every((_, i) => i in props.counts);
  const canCarry = () => !!props.sql && !props.error;

  return (
    <Portal>
      <div
        class="modal-backdrop"
        onClick={(e) => e.target === e.currentTarget && props.onClose()}
      >
        <div
          class="modal related-modal"
          role="dialog"
          aria-modal="true"
          aria-label={t("related.title", {
            table: props.table,
            column: props.column,
            value: props.value,
          })}
        >
          <div class="related-head">
            <h2>
              {t("related.title", {
                table: props.table,
                column: props.column,
                value: props.value,
              })}
            </h2>
            <span class="status-spacer" />
            <button class="related-close" title={t("common.close")} onClick={props.onClose}>
              ✕
            </button>
          </div>

          <Show
            when={!props.unsupported}
            fallback={<p class="grid-empty related-unsupported">{props.unsupported}</p>}
          >
            <Show
              when={props.queries.length > 0}
              fallback={
                <p class="grid-empty">{t("related.none", { table: props.table })}</p>
              }
            >
              <div class="related-body">
                <aside class="related-side">
                  <div class="related-side-title">
                    {counted()
                      ? t("related.withData", { n: String(withData()) })
                      : t("related.counting")}
                  </div>
                  <ul class="related-list">
                    <For each={props.queries}>
                      {(q, i) => {
                        const count = () => props.counts[i()];
                        const zero = () => count() === 0;
                        return (
                          <li>
                            <button
                              class={`related-item ${zero() ? "is-zero" : ""}`}
                              aria-current={i() === props.selected}
                              disabled={q.where === null}
                              title={q.label}
                              onClick={() => props.onSelect(i())}
                            >
                              <span class="related-item-table">{q.relation.fromTable}</span>
                              <Show when={q.parent}>
                                {/* Which way this entry reads: the row the cell
                                    points at, not the rows that point at it. */}
                                <span class="related-dir">{t("related.parentTag")}</span>
                              </Show>
                              <span
                                class={`related-count ${
                                  count() === undefined || count() === null ? "pending" : ""
                                } ${zero() ? "zero" : ""}`}
                              >
                                {q.where === null
                                  ? "?"
                                  : count() === undefined
                                    ? "…"
                                    : count() === null
                                      ? "?"
                                      : String(count())}
                              </span>
                            </button>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </aside>

                <div class="related-main">
                  <Show when={props.truncated}>
                    <p class="related-warn">{t("related.truncated")}</p>
                  </Show>
                  <p class="related-filter" title={current()?.label}>
                    {current()?.where === null
                      ? t("related.blocked", { column: current()?.missing ?? "" })
                      : current()?.label}
                  </p>
                  <div class="related-result">
                    <ResultGrid
                      result={props.result}
                      loading={props.loading}
                      error={props.error}
                      keyColumns={props.keyColumns}
                    />
                  </div>
                  <Show when={props.sql}>
                    <pre class="related-sql">{props.sql}</pre>
                  </Show>
                </div>
              </div>
            </Show>
          </Show>

          <div class="modal-actions related-actions">
            <span class="related-rows">
              <Show when={props.result && !props.loading}>
                {t("related.rows", { n: String(props.result!.rows.length) })}
              </Show>
            </span>
            <span class="status-spacer" />
            <button class="primary" disabled={!canCarry()} onClick={props.onOpenTab}>
              {t("related.openTab")}
            </button>
            <button disabled={!canCarry()} onClick={props.onToEditor}>
              {t("related.toEditor")}
            </button>
            <button onClick={props.onClose}>{t("common.close")}</button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
