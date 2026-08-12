import { For, Show } from "solid-js";
import { t } from "../utils/i18n";
import {
  OPERATORS,
  isNullaryOp,
  isRangeOp,
  RANGE_SEPARATOR,
  type Condition,
  type Operator,
  type OrderBy,
} from "../utils/queryBuilder";
import type { FilterState } from "../utils/dataFilter";

// The filter and sort panel of a table tab (issue #347). It takes the place of
// the SQL editor: a tab opened from the tree is for browsing a table, and the
// question people actually have there is "show me the rows where…", which used
// to mean writing the SELECT by hand or sorting the one page that came back.
//
// Presentational. The state is the workspace's, the SQL is utils/dataFilter's,
// and applying it re-runs the paged preview — so every condition here narrows
// the whole table, not the rows already on screen.
export function DataFilterBar(props: {
  state: FilterState;
  /** Column names of the table, for the column pickers. */
  columns: string[];
  /** True while the draft says something the grid does not show yet. */
  dirty: boolean;
  /** Rows on screen / rows the filter matches; absent while unknown. */
  loaded?: number;
  onChange: (index: number, patch: Partial<Condition>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onConjunction: (value: "AND" | "OR") => void;
  onSort: (index: number, patch: Partial<OrderBy>) => void;
  onAddSort: () => void;
  onRemoveSort: (index: number) => void;
  onApply: () => void;
  onClear: () => void;
  onToggleCollapsed: () => void;
  onOpenSql: () => void;
}) {
  const opLabel = (op: Operator) => t(`filter.op.${op}`);

  /** The two halves of a BETWEEN row, which travel inside one value string. */
  const bounds = (c: Condition): [string, string] => {
    const [from = "", to = ""] = c.value.split(RANGE_SEPARATOR);
    return [from.trim(), to.trim()];
  };
  const setBound = (i: number, c: Condition, which: 0 | 1, v: string) => {
    const b = bounds(c);
    b[which] = v;
    props.onChange(i, { value: `${b[0]} ${RANGE_SEPARATOR} ${b[1]}` });
  };

  return (
    <section class="filterbar" aria-label={t("filter.region")}>
      <div class="filterbar-head">
        <button
          class="filterbar-toggle"
          aria-expanded={!props.state.collapsed}
          onClick={props.onToggleCollapsed}
        >
          <span class="filterbar-chev" aria-hidden="true">
            {props.state.collapsed ? "▸" : "▾"}
          </span>
          {t("filter.title")}
        </button>
        <Show when={props.state.collapsed && props.state.applied}>
          <span class="filterbar-summary">{t("filter.activeSummary")}</span>
        </Show>
        <span class="filterbar-spacer" />
        <button class="status-btn" onClick={props.onOpenSql} title={t("filter.sqlTitle")}>
          {t("filter.sql")}
        </button>
      </div>

      <Show when={!props.state.collapsed}>
        <div class="filter-body">
          <Show
            when={props.state.conditions.length > 0}
            fallback={<p class="filter-empty">{t("filter.none")}</p>}
          >
            <ul class="filter-list">
              <For each={props.state.conditions}>
                {(c, i) => (
                  <li class={`filter-cond ${c.enabled === false ? "off" : ""}`}>
                    <label class="filter-check">
                      <input
                        type="checkbox"
                        checked={c.enabled !== false}
                        aria-label={t("filter.enabled", { column: c.column || "—" })}
                        onChange={(e) =>
                          props.onChange(i(), { enabled: e.currentTarget.checked })
                        }
                      />
                    </label>

                    <select
                      class="filter-col"
                      aria-label={t("filter.column")}
                      value={c.column}
                      onChange={(e) => props.onChange(i(), { column: e.currentTarget.value })}
                    >
                      <option value="">{t("filter.pickColumn")}</option>
                      <For each={props.columns}>{(col) => <option value={col}>{col}</option>}</For>
                    </select>

                    <select
                      class="filter-op"
                      aria-label={t("filter.operator")}
                      value={c.op}
                      onChange={(e) =>
                        props.onChange(i(), { op: e.currentTarget.value as Operator })
                      }
                    >
                      <For each={OPERATORS}>{(op) => <option value={op}>{opLabel(op)}</option>}</For>
                    </select>

                    <Show when={!isNullaryOp(c.op)}>
                      <Show
                        when={isRangeOp(c.op)}
                        fallback={
                          <input
                            class="filter-val"
                            type="text"
                            aria-label={t("filter.value")}
                            placeholder={c.op === "IN" ? t("filter.listHint") : ""}
                            value={c.value}
                            onInput={(e) => props.onChange(i(), { value: e.currentTarget.value })}
                          />
                        }
                      >
                        <input
                          class="filter-val range"
                          type="text"
                          aria-label={t("filter.from")}
                          value={bounds(c)[0]}
                          onInput={(e) => setBound(i(), c, 0, e.currentTarget.value)}
                        />
                        <span class="filter-sep" aria-hidden="true">
                          {RANGE_SEPARATOR}
                        </span>
                        <input
                          class="filter-val range"
                          type="text"
                          aria-label={t("filter.to")}
                          value={bounds(c)[1]}
                          onInput={(e) => setBound(i(), c, 1, e.currentTarget.value)}
                        />
                      </Show>
                    </Show>

                    <button
                      class="status-btn danger filter-drop"
                      aria-label={t("filter.removeCond")}
                      title={t("filter.removeCond")}
                      onClick={() => props.onRemove(i())}
                    >
                      ×
                    </button>

                    <Show when={i() < props.state.conditions.length - 1}>
                      <span class="filter-join">{t(`filter.join.${props.state.conjunction}`)}</span>
                    </Show>
                  </li>
                )}
              </For>
            </ul>
          </Show>

          <div class="filter-actions">
            <button class="status-btn" onClick={props.onAdd}>
              {t("filter.addCond")}
            </button>
            <Show when={props.state.conditions.length > 1}>
              <select
                class="filter-conj"
                aria-label={t("filter.joinLabel")}
                value={props.state.conjunction}
                onChange={(e) =>
                  props.onConjunction(e.currentTarget.value as "AND" | "OR")
                }
              >
                <option value="AND">{t("filter.join.AND")}</option>
                <option value="OR">{t("filter.join.OR")}</option>
              </select>
            </Show>
          </div>

          <div class="filter-sort">
            <span class="filter-sort-label">{t("filter.sortBy")}</span>
            <For each={props.state.order}>
              {(o, i) => (
                <span class="filter-sort-pill">
                  <select
                    aria-label={t("filter.sortColumn")}
                    value={o.column}
                    onChange={(e) => props.onSort(i(), { column: e.currentTarget.value })}
                  >
                    <For each={props.columns}>{(col) => <option value={col}>{col}</option>}</For>
                  </select>
                  <button
                    class="status-btn"
                    aria-label={t(o.dir === "ASC" ? "filter.asc" : "filter.desc")}
                    title={t(o.dir === "ASC" ? "filter.asc" : "filter.desc")}
                    onClick={() =>
                      props.onSort(i(), { dir: o.dir === "ASC" ? "DESC" : "ASC" })
                    }
                  >
                    {o.dir === "ASC" ? "↑" : "↓"}
                  </button>
                  <button
                    class="status-btn danger"
                    aria-label={t("filter.removeSort")}
                    onClick={() => props.onRemoveSort(i())}
                  >
                    ×
                  </button>
                </span>
              )}
            </For>
            <button class="status-btn" onClick={props.onAddSort} disabled={props.columns.length === 0}>
              {t("filter.addSort")}
            </button>
          </div>

          <div class="filter-apply">
            <button class="primary" onClick={props.onApply}>
              {t("filter.apply")}
            </button>
            <button class="status-btn" onClick={props.onClear}>
              {t("filter.clear")}
            </button>
            {/* Live, because it is the answer to "why does the grid not match
                what I just typed?" — the question a stale panel provokes. */}
            <span class="filter-state" role="status">
              <Show when={props.dirty}>{t("filter.unapplied")}</Show>
            </span>
            <Show when={props.loaded !== undefined}>
              <span class="filter-count">{t("filter.loaded", { n: props.loaded ?? 0 })}</span>
            </Show>
          </div>
        </div>
      </Show>
    </section>
  );
}
