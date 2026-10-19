import { countText } from "../utils/confirmText";
import { Show, createEffect, createMemo, createSignal } from "solid-js";
import { runQuery, type ResultSet } from "../utils/query";
import { errorText } from "../utils/errors";
import {
  slowQuerySupport,
  buildSlowQuerySql,
  DEFAULT_SLOW_LIMIT,
  slowFacts,
  slowSourceKey,
  type SlowOrder,
} from "../utils/slowQueries";
import { copyText } from "../utils/rowCopy";
import { countText } from "../utils/confirmText";
import { Segmented } from "./Segmented";
import { EmptyNote } from "./EmptyNote";
import { Panel } from "./Panel";
import { ResultGrid } from "./ResultGrid";
import { t } from "../utils/i18n";
import { ConfirmDialog } from "./ConfirmDialog";
import { resetStatsConfirm } from "../utils/confirmText";

// "Consultas lentas" tool (issue #180): lists the slowest statements the SERVER
// recorded, via query.run over performance_schema (MySQL) / pg_stat_statements
// (PostgreSQL) — no core change (same pattern as the #148 monitor). Unsupported
// engines show an honest reason; when the catalog exists but is disabled/not
// installed, the listing SQL errors and that error is shown verbatim (never a
// faked result). Per row: open the statement in the editor or run EXPLAIN on it.
// As a persistent tool tab it reloads via createEffect keyed on conn/engine/order
// (not onMount), with a monotonic token guarding against out-of-order responses.
// label holds an i18n key; the segmented control renders it with t().
// P6: the order is a segmented choice, a note names the catalog the numbers
// come from, and the selected statement gets a detail pane (its text with
// Copiar, executions, latencies and its share of the listed total).
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
  // Resetting wipes what the server gathered for everyone: asked first.
  const [confirmReset, setConfirmReset] = createSignal(false);
  const [selectedRow, setSelectedRow] = createSignal<number | null>(null);

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
  const queryText = (row: (string | null)[]) => (queryIndex() >= 0 ? row[queryIndex()] : null);

  /* The SQL of the selected row, which is what "Abrir" and EXPLAIN act on now
     that the buttons live in the bar rather than in a column of their own.
     After queryIndex, deliberately: an eagerly-run memo cannot read a const
     declared below it. */
  const selectedQuery = createMemo(() => {
    const r = selectedRow();
    if (r === null) return null;
    const res = result();
    const row = res?.rows[r];
    if (!res || !row) return null;
    // MongoDB's query cell is the profiled command (JSON): the statement to open
    // or explain is rebuilt from it and the namespace. Null when it cannot be.
    const toStatement = support().statementOf;
    if (!toStatement) return queryText(row);
    return toStatement(Object.fromEntries(res.columns.map((c, i) => [c.name.toLowerCase(), row[i]])));
  });

  return (
    <Panel
      title={t("tool.slow.tab")}
      class="slow-queries"
      onClose={props.onClose}
      actions={
        <Show when={support().supported}>
          {/* Both act on the selected row (#372): the grid has no column for
              per-row buttons, and the bar is where every panel keeps actions. */}
          <button
            class="edit-btn edit-btn-primary"
            disabled={!selectedQuery()}
            title={selectedQuery() ? t("slow.openTitle") : t("slow.pickFirst")}
            onClick={() => props.onOpenSql(selectedQuery()!)}
          >
            {t("slow.open")}
          </button>
          <button
            class="edit-btn"
            disabled={!selectedQuery()}
            title={selectedQuery() ? t("slow.explainTitle") : t("slow.pickFirst")}
            onClick={() => props.onExplain(selectedQuery()!)}
          >
            {t("slow.explain")}
          </button>
          <span class="sq-order">{t("slow.orderBy")}</span>
          <Segmented
            label={t("slow.orderBy")}
            options={ORDER_OPTS.map((o) => ({ value: o.value, label: t(o.label) }))}
            value={order()}
            onChange={setOrder}
          />
          <Show when={support().resetSql}>
            <button class="edit-btn" disabled={resetting()} onClick={() => setConfirmReset(true)} title={t("slow.resetTitle")}>
              {resetting() ? "…" : t("slow.resetStats")}
            </button>
          </Show>
        </Show>
      }
      status={<Show when={support().supported}>{countText("slow.count", rows().length)}</Show>}
      onRefresh={support().supported ? load : undefined}
      refreshing={loading()}
    >
      <Show when={error()}>
        <div class="grid-error" role="alert">
          {error()}
        </div>
      </Show>

      <Show
        when={support().supported}
        fallback={<EmptyNote title={t("slow.unsupportedTitle")} text={support().reason ?? undefined} />}
      >
        <Show when={slowSourceKey(props.engine)}>
          {(k) => <p class="help slow-source">{t(k())}</p>}
        </Show>
        <ResultGrid
          result={result()}
          loading={loading()}
          error={null}
          emptyState={<p class="grid-empty">{t("slow.noRecords")}</p>}
          onSelectedRowChange={setSelectedRow}
        />
        {/* An empty answer can mean the catalog is switched off (MongoDB's
            profiler), not that nothing was slow: say how to turn it on. */}
        <Show when={support().emptyHint && result() && rows().length === 0 && !loading() && !error()}>
          <p class="grid-empty">{t(support().emptyHint!)}</p>
        </Show>
        <Show when={selectedRow() !== null && result() && slowFacts(result()!, selectedRow()!)}>
          {(f) => (
            <section class="slow-detail" aria-label={t("slow.detailAria")}>
              <div class="slow-detail-sql">
                <div class="monitor-detail-head">
                  <span class="monitor-detail-title">{t("slow.detailQuery")}</span>
                  <span class="panel-bar-spacer" />
                  <Show when={selectedQuery()}>
                    <button type="button" class="btn" onClick={() => copyText(selectedQuery()!)}>
                      {t("slow.copy")}
                    </button>
                  </Show>
                </div>
                <pre class="monitor-detail-sql">{selectedQuery() ?? queryText(result()!.rows[selectedRow()!]) ?? ""}</pre>
              </div>
              <dl class="slow-facts">
                <dt>{t("slow.fact.calls")}</dt>
                <dd>{f().calls ?? "—"}</dd>
                <dt>{t("slow.fact.avg")}</dt>
                <dd>{f().avgMs === null ? "—" : `${f().avgMs} ms`}</dd>
                <dt>{t("slow.fact.max")}</dt>
                <dd>{f().maxMs === null ? "—" : `${f().maxMs} ms`}</dd>
                <dt>{t("slow.fact.total")}</dt>
                <dd>{f().totalMs === null ? "—" : `${f().totalMs} ms`}</dd>
                <Show when={f().share !== null}>
                  <dt class="slow-share-label">{t("slow.fact.share", { n: f().share! })}</dt>
                  <dd
                    class="slow-share"
                    role="meter"
                    aria-label={t("slow.fact.shareAria")}
                    aria-valuenow={f().share!}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${f().share}%` }} />
                  </dd>
                </Show>
              </dl>
            </section>
          )}
        </Show>
      </Show>
      <Show when={confirmReset()}>
        <ConfirmDialog
          title={resetStatsConfirm(rows().length).title}
          message={resetStatsConfirm(rows().length).message}
          confirmLabel={resetStatsConfirm(rows().length).confirm}
          sql={support().resetSql ?? undefined}
          onConfirm={() => {
            setConfirmReset(false);
            void reset();
          }}
          onCancel={() => setConfirmReset(false)}
        />
      </Show>
    </Panel>
  );
}
