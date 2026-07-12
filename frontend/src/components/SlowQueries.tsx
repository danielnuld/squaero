import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import { runQuery, type ResultSet } from "../utils/query";
import { errorText } from "../utils/errors";
import {
  slowQuerySupport,
  buildSlowQuerySql,
  DEFAULT_SLOW_LIMIT,
  type SlowOrder,
} from "../utils/slowQueries";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";

// "Consultas lentas" tool (issue #180): lists the slowest statements the SERVER
// recorded, via query.run over performance_schema (MySQL) / pg_stat_statements
// (PostgreSQL) — no core change (same pattern as the #148 monitor). Unsupported
// engines show an honest reason; when the catalog exists but is disabled/not
// installed, the listing SQL errors and that error is shown verbatim (never a
// faked result). Per row: open the statement in the editor or run EXPLAIN on it.
// As a persistent tool tab it reloads via createEffect keyed on conn/engine/order
// (not onMount), with a monotonic token guarding against out-of-order responses.
// label holds an i18n key; the <option> renders it with t().
const ORDER_OPTS: { value: SlowOrder; label: string }[] = [
  { value: "avg", label: "slow.orderAvg" },
  { value: "total", label: "slow.orderTotal" },
  { value: "count", label: "slow.orderCount" },
];

export function SlowQueries(props: {
  connId: string;
  engine: string;
  onOpenSql: (sql: string) => void;
  onExplain: (sql: string) => void;
  onClose: () => void;
}) {
  const support = createMemo(() => slowQuerySupport(props.engine));
  const [order, setOrder] = createSignal<SlowOrder>("avg");
  const [result, setResult] = createSignal<ResultSet | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [resetting, setResetting] = createSignal(false);

  let token = 0;

  const queryIndex = createMemo(() => {
    const col = support().queryColumn;
    const cols = result()?.columns ?? [];
    if (!col) return -1;
    return cols.findIndex((c) => c.name.toLowerCase() === col.toLowerCase());
  });

  const load = async () => {
    const sql = buildSlowQuerySql(props.engine, order(), DEFAULT_SLOW_LIMIT);
    if (!sql) {
      setResult(null);
      return;
    }
    const mine = ++token;
    // Clear stale rows BEFORE awaiting so a connection/engine switch between two
    // supported engines (same column shape) never shows the previous server's
    // data — same guard as TriggersExplorer/IndexManager.
    setResult(null);
    setLoading(true);
    setError(null);
    try {
      const res = await runQuery(props.connId, sql);
      if (mine !== token) return; // a newer load superseded this one
      setResult(res);
    } catch (err) {
      if (mine !== token) return;
      setResult(null);
      setError(errorText(err));
    } finally {
      if (mine === token) setLoading(false);
    }
  };

  // Reload whenever the connection, engine, or ordering changes.
  createEffect(() => {
    // track deps explicitly
    void props.connId;
    void props.engine;
    void order();
    void load();
  });

  const reset = async () => {
    const sql = support().resetSql;
    if (!sql) return;
    setResetting(true);
    setError(null);
    try {
      await runQuery(props.connId, sql);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setResetting(false);
    }
  };

  const rows = () => result()?.rows ?? [];
  const cols = () => result()?.columns ?? [];
  const queryText = (row: (string | null)[]) => (queryIndex() >= 0 ? row[queryIndex()] : null);

  return (
    <Panel title={t("tool.slow.tab")} class="slow-queries" onClose={props.onClose}>
      <div class="sm-head">
        <h2>{t("tool.slow.tab")}</h2>
        <div class="sm-actions">
          <Show when={support().supported}>
            <label class="sq-order">
              {t("slow.orderBy")}
              <select value={order()} onChange={(e) => setOrder(e.currentTarget.value as SlowOrder)}>
                <For each={ORDER_OPTS}>{(o) => <option value={o.value}>{t(o.label)}</option>}</For>
              </select>
            </label>
            <button class="edit-btn" disabled={loading()} onClick={load}>
              {loading() ? t("panel.refreshing") : t("panel.refresh")}
            </button>
            <Show when={support().resetSql}>
              <button class="edit-btn" disabled={resetting()} onClick={reset} title={t("slow.resetTitle")}>
                {resetting() ? "…" : t("slow.resetStats")}
              </button>
            </Show>
          </Show>
          <button class="edit-btn" onClick={props.onClose}>
            {t("panel.close")}
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="grid-error" role="alert">
          {error()}
        </div>
      </Show>

      <Show
        when={support().supported}
        fallback={<p class="grid-empty">{support().reason}</p>}
      >
        <Show
          when={rows().length > 0}
          fallback={<p class="grid-empty">{loading() ? t("panel.loading") : t("slow.noRecords")}</p>}
        >
          <div class="sm-scroll">
            <table class="sm-table">
              <thead>
                <tr>
                  <th class="sq-actions-col" />
                  <For each={cols()}>{(c) => <th>{c.name}</th>}</For>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(row) => {
                    const q = () => queryText(row);
                    return (
                      <tr>
                        <td class="sq-actions-col">
                          <Show when={q()}>
                            <button class="edit-btn" title={t("slow.openTitle")} onClick={() => props.onOpenSql(q()!)}>
                              {t("slow.open")}
                            </button>
                            <button class="edit-btn" title={t("slow.explainTitle")} onClick={() => props.onExplain(q()!)}>
                              EXPLAIN
                            </button>
                          </Show>
                        </td>
                        <For each={cols()}>
                          {(_c, i) => <td title={row[i()] ?? ""}>{row[i()] ?? ""}</td>}
                        </For>
                      </tr>
                    );
                  }}
                </For>
              </tbody>
            </table>
          </div>
        </Show>
      </Show>
    </Panel>
  );
}
