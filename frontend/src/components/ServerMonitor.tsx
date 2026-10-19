import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { runQuery, type ResultSet } from "../utils/query";
import { errorText } from "../utils/errors";
import {
  AUTO_REFRESH_MS,
  buildCancelSql,
  buildKillSql,
  monitorFor,
  monitorKpis,
  nextSessionSort,
  sessionFacts,
  sessionQuery,
  sessionState,
  shouldAutoRefresh,
  unsupportedReason,
  viewSessions,
  type SessionView,
} from "../utils/serverMonitor";
import { Panel } from "./Panel";
import { ResultGrid } from "./ResultGrid";
import { Segmented } from "./Segmented";
import { EmptyNote } from "./EmptyNote";
import { t } from "../utils/i18n";
import { ConfirmDialog } from "./ConfirmDialog";
import { countText, killSessionConfirm } from "../utils/confirmText";

// Server monitor / process list (issue #148): lists the server's active
// sessions/queries for the active connection and, where the engine allows,
// cancels a session's query or kills the session — all via query.run using the
// per-engine SQL from utils/serverMonitor.ts.
//
// P6 depth (prototype ServerMonitor): it re-reads the list every 5 s unless
// paused (and never while a dialog asks about a session or the window is
// hidden); a filter and «Ocultar inactivas» narrow the list; cards count the
// sessions per state, all from the list itself — nothing is invented; the
// selected session gets a detail strip with its query and its actions. The
// sort lives here, not in the grid, so a refresh keeps it.
export function ServerMonitor(props: {
  connId: string;
  engine: string;
  /** The connection's name, for the kill confirmation. */
  connName?: string;
  /** Opens a session's query in a new editor tab. */
  onOpenSql?: (sql: string) => void;
  /** Opens the slow-queries tool for the same connection. */
  onSlowQueries?: () => void;
  onClose: () => void;
}) {
  const support = monitorFor(props.engine);
  const [result, setResult] = createSignal<ResultSet | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [loadedAt, setLoadedAt] = createSignal<Date | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [auto, setAuto] = createSignal(true);
  const [view, setView] = createSignal<SessionView>({ text: "", hideIdle: true, sort: null });
  /* The session the detail strip shows, by id: a refresh rebuilds the grid
     (and drops its selection), but the strip stays on the same session. */
  const [selectedId, setSelectedId] = createSignal<string | null>(null);
  // Killing cuts off someone else's work: it asks first, naming the session and
  // the server (audit A-10, R-31). Errors stay in the dialog to retry.
  // The PID is typed to confirm, and the row's facts are shown, captured when
  // asked: a refresh behind the dialog cannot change which session it names.
  const [confirmKill, setConfirmKill] = createSignal<string | null>(null);
  const [killFacts, setKillFacts] = createSignal<{ name: string; value: string }[]>([]);

  const shown = createMemo(() => viewSessions(props.engine, result(), view()));
  const kpis = createMemo(() => monitorKpis(props.engine, result()));

  const idIndex = createMemo(() => {
    const cols = result()?.columns ?? [];
    if (!support.idColumn) return -1;
    return cols.findIndex((c) => c.name.toLowerCase() === support.idColumn!.toLowerCase());
  });

  /** The selected session's row in the latest list, or null when it left. */
  const selected = createMemo(() => {
    const id = selectedId();
    const res = result();
    if (id === null || !res || idIndex() < 0) return null;
    const row = res.rows.find((r) => r[idIndex()] === id);
    return row ? { id, row, columns: res.columns } : null;
  });

  const load = async () => {
    if (!support.supported || !support.listSql) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await runQuery(props.connId, support.listSql));
      setLoadedAt(new Date());
    } catch (err) {
      setError(errorText(err));
      // A failing server is not polled on: the user resumes when it is back.
      setAuto(false);
    } finally {
      setLoading(false);
    }
  };

  const act = async (sql: string, done?: () => void) => {
    setBusy(true);
    setError(null);
    try {
      await runQuery(props.connId, sql);
      done?.();
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  onMount(() => {
    void load();
    const timer = setInterval(() => {
      if (
        shouldAutoRefresh({
          auto: auto(),
          loading: loading() || busy(),
          asking: confirmKill() !== null,
          hidden: typeof document !== "undefined" && document.visibilityState === "hidden",
        })
      )
        void load();
    }, AUTO_REFRESH_MS);
    onCleanup(() => clearInterval(timer));
  });

  const stateLabel = (row: readonly (string | null)[]) => {
    const s = sessionState(props.engine, result()?.columns ?? [], row);
    return s ? t(`monitor.state.${s}`) : null;
  };

  return (
    <Panel
      title={t("tool.monitor.tab")}
      class="server-monitor"
      onClose={props.onClose}
      actions={
        <Show when={support.supported}>
          <Segmented
            label={t("monitor.autoAria")}
            options={[
              { value: true, label: t("monitor.auto", { s: AUTO_REFRESH_MS / 1000 }) },
              { value: false, label: t("monitor.paused") },
            ]}
            value={auto()}
            onChange={setAuto}
          />
          <input
            type="search"
            class="monitor-filter"
            placeholder={t("monitor.filter")}
            aria-label={t("monitor.filter")}
            value={view().text}
            onInput={(e) => setView((v) => ({ ...v, text: e.currentTarget.value }))}
          />
          <button
            type="button"
            class="edit-btn"
            aria-pressed={view().hideIdle}
            classList={{ on: view().hideIdle }}
            onClick={() => setView((v) => ({ ...v, hideIdle: !v.hideIdle }))}
          >
            {t("monitor.hideIdle")}
          </button>
          <Show when={props.onSlowQueries}>
            <button type="button" class="edit-btn" onClick={() => props.onSlowQueries!()}>
              {t("tool.slow.label")}
            </button>
          </Show>
        </Show>
      }
      status={
        <Show when={support.supported}>
          <span>
            {countText("monitor.count", kpis().total)}
            {shown() && shown()!.rows.length !== kpis().total
              ? ` · ${countText("monitor.visible", shown()!.rows.length)}`
              : ""}
            <Show when={loadedAt()}>{(at) => ` · ${t("monitor.updatedAt", { time: at().toLocaleTimeString() })}`}</Show>
          </span>
        </Show>
      }
      onRefresh={support.supported ? load : undefined}
      refreshing={loading()}
    >
      <Show when={confirmKill()}>
        {(id) => (
          <ConfirmDialog
            title={killSessionConfirm(id(), props.connName ?? "").title}
            message={killSessionConfirm(id(), props.connName ?? "").message}
            sql={buildKillSql(props.engine, id()) ?? undefined}
            confirmLabel={killSessionConfirm(id(), props.connName ?? "").confirm}
            typeToConfirm={id()}
            busy={busy()}
            error={error()}
            onConfirm={() => {
              const sql = buildKillSql(props.engine, id());
              if (sql) void act(sql, () => setConfirmKill(null));
            }}
            onCancel={() => setConfirmKill(null)}
          >
            <Show when={killFacts().length > 0}>
              <dl class="kill-facts">
                <For each={killFacts()}>
                  {(f) => (
                    <>
                      <dt>{f.name}</dt>
                      <dd>{f.value}</dd>
                    </>
                  )}
                </For>
              </dl>
            </Show>
          </ConfirmDialog>
        )}
      </Show>

      <Show when={error() && !confirmKill()}>
        <div class="grid-error" role="alert">
          {error()}
        </div>
      </Show>

      <Show
        when={support.supported}
        fallback={<EmptyNote title={t("monitor.unsupportedTitle")} text={unsupportedReason(props.engine)} />}
      >
        <div class="monitor-kpis" role="group" aria-label={t("monitor.kpisAria")}>
          <div class="monitor-kpi">
            <span class="monitor-kpi-label">{t("monitor.kpi.total")}</span>
            <span class="monitor-kpi-value">{kpis().total}</span>
          </div>
          <div class="monitor-kpi">
            <span class="monitor-kpi-label">{t("monitor.kpi.active")}</span>
            <span class="monitor-kpi-value">{kpis().active}</span>
          </div>
          <div class="monitor-kpi">
            <span class="monitor-kpi-label">{t("monitor.kpi.idle")}</span>
            <span class="monitor-kpi-value">{kpis().idle}</span>
          </div>
          <div class="monitor-kpi" classList={{ warn: kpis().waiting > 0 }}>
            <span class="monitor-kpi-label">{t("monitor.kpi.waiting")}</span>
            <span class="monitor-kpi-value">{kpis().waiting}</span>
          </div>
        </div>

        <div class="monitor-grid">
          <Show
            when={!shown() || shown()!.rows.length > 0}
            fallback={
              <EmptyNote
                title={t(result()?.rows.length ? "monitor.noMatch" : "monitor.noSessions")}
                action={
                  result()?.rows.length
                    ? { label: t("monitor.showAll"), onClick: () => setView((v) => ({ ...v, text: "", hideIdle: false })) }
                    : undefined
                }
              />
            }
          >
          <ResultGrid
            result={shown()}
            loading={loading() && !result()}
            error={null}
            onSortColumn={(column) => setView((v) => ({ ...v, sort: nextSessionSort(v.sort, column) }))}
            sortedColumn={view().sort}
            onSelectedRowChange={(i) => {
              if (i === null || idIndex() < 0) return;
              const id = shown()?.rows[i]?.[idIndex()];
              if (id) setSelectedId(id);
            }}
          />
          </Show>
        </div>

        <Show when={selectedId()}>
          {(id) => (
            <section class="monitor-detail" aria-label={t("monitor.detailAria", { id: id() })}>
              <Show
                when={selected()}
                fallback={
                  <div class="monitor-detail-head">
                    <span class="monitor-detail-title">{t("monitor.detailTitle", { id: id() })}</span>
                    <span class="help">{t("monitor.gone")}</span>
                  </div>
                }
              >
                {(s) => {
                  const query = () => sessionQuery(s().columns, s().row);
                  const cancelSql = () => buildCancelSql(props.engine, s().id);
                  const idle = () => {
                    const st = sessionState(props.engine, s().columns, s().row);
                    return st === "idle" || st === "idleInTx";
                  };
                  const cancelReason = () =>
                    !cancelSql()
                      ? t("monitor.cancelUnsupported")
                      : idle() || !query()
                        ? t("monitor.cancelIdle")
                        : t("monitor.cancelTitle", { sql: cancelSql()! });
                  return (
                    <>
                      <div class="monitor-detail-head">
                        <span class="monitor-detail-title">{t("monitor.detailTitle", { id: s().id })}</span>
                        <Show when={stateLabel(s().row)}>{(l) => <span class="chip">{l()}</span>}</Show>
                        <span class="panel-bar-spacer" />
                        <Show when={props.onOpenSql && query()}>
                          <button type="button" class="btn" onClick={() => props.onOpenSql!(query()!)}>
                            {t("monitor.openSql")}
                          </button>
                        </Show>
                        <button
                          type="button"
                          class="btn"
                          disabled={!cancelSql() || idle() || !query() || busy()}
                          title={cancelReason()}
                          onClick={() => void act(cancelSql()!)}
                        >
                          {t("monitor.cancelQuery")}
                        </button>
                        <Show when={support.canKill}>
                          <button
                            type="button"
                            class="btn btn-danger"
                            disabled={busy() || !buildKillSql(props.engine, s().id)}
                            title={t("monitor.killTitle", { id: s().id })}
                            onClick={() => {
                              setError(null);
                              setKillFacts(sessionFacts(s().columns, s().row));
                              setConfirmKill(s().id);
                            }}
                          >
                            {t("monitor.killId", { id: s().id })}
                          </button>
                        </Show>
                      </div>
                      <Show when={query()}>
                        <pre class="monitor-detail-sql">{query()}</pre>
                      </Show>
                    </>
                  );
                }}
              </Show>
            </section>
          )}
        </Show>
      </Show>
    </Panel>
  );
}
