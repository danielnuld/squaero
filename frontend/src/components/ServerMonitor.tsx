import { Show, createMemo, createSignal, onMount } from "solid-js";
import { runQuery, type ResultSet } from "../utils/query";
import { errorText } from "../utils/errors";
import { monitorFor, buildKillSql, unsupportedReason } from "../utils/serverMonitor";
import { Panel } from "./Panel";
import { ResultGrid } from "./ResultGrid";
import { t } from "../utils/i18n";

// Server monitor / process list (issue #148): lists the server's active
// sessions/queries for the active connection and, where the engine allows, kills
// one — all via query.run using the per-engine SQL from utils/serverMonitor.ts.
// Basic metric shown: the number of active sessions. Refresh is manual (a button)
// so the panel never spams the server on its own.
export function ServerMonitor(props: {
  connId: string;
  engine: string;
  onClose: () => void;
}) {
  const support = monitorFor(props.engine);
  const [result, setResult] = createSignal<ResultSet | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [killing, setKilling] = createSignal<string | null>(null);
  const [selectedRow, setSelectedRow] = createSignal<number | null>(null);

  const idIndex = createMemo(() => {
    const cols = result()?.columns ?? [];
    if (!support.idColumn) return -1;
    return cols.findIndex((c) => c.name.toLowerCase() === support.idColumn!.toLowerCase());
  });

  /* The session id of the selected row, or null when there is nothing to kill.
     Declared AFTER idIndex on purpose: a createMemo runs eagerly, so reading a
     const declared below it throws before the panel ever renders. */
  const selectedId = createMemo(() => {
    const r = selectedRow();
    if (r === null || idIndex() < 0) return null;
    return result()?.rows[r]?.[idIndex()] ?? null;
  });

  const load = async () => {
    if (!support.supported || !support.listSql) return;
    setLoading(true);
    setError(null);
    try {
      setResult(await runQuery(props.connId, support.listSql));
    } catch (err) {
      setError(errorText(err));
    } finally {
      setLoading(false);
    }
  };

  const kill = async (id: string) => {
    const sql = buildKillSql(props.engine, id);
    if (!sql) return;
    setKilling(id);
    setError(null);
    try {
      await runQuery(props.connId, sql);
      await load();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setKilling(null);
    }
  };

  onMount(load);

  const rows = () => result()?.rows ?? [];

  return (
    <Panel
      title={t("tool.monitor.tab")}
      class="server-monitor"
      onClose={props.onClose}
      actions={
        <Show when={support.supported && support.canKill}>
          {/* Acts on the selected row: a column of buttons is not something the
              result grid has a place for, and every other panel's actions live
              in the bar (#372). */}
          <button
            class="edit-btn"
            disabled={selectedId() === null || killing() !== null}
            title={
              selectedId() === null
                ? t("monitor.killHint")
                : t("monitor.killTitle", { id: selectedId()! })
            }
            onClick={() => void kill(selectedId()!)}
          >
            {killing() !== null ? "…" : t("monitor.kill")}
          </button>
        </Show>
      }
      status={
        <Show when={support.supported}>
          <span>{t("monitor.sessions", { n: rows().length })}</span>
        </Show>
      }
      onRefresh={support.supported ? load : undefined}
      refreshing={loading()}
    >
      <Show when={error()}>
        <div class="grid-error" role="alert">
          {error()}
        </div>
      </Show>

      <Show
        when={support.supported}
        fallback={<p class="grid-empty">{unsupportedReason(props.engine)}</p>}
      >
        <ResultGrid
          result={result()}
          loading={loading()}
          error={null}
          emptyState={<p class="grid-empty">{t("monitor.noSessions")}</p>}
          onSelectedRowChange={setSelectedRow}
        />
      </Show>
    </Panel>
  );
}
