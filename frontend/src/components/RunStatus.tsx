import { Show, createSignal, onCleanup, createEffect } from "solid-js";
import { formatDuration, formatElapsed } from "../utils/duration";
import { setCount, setKind } from "../utils/scriptRuns";
import type { ResultSet } from "../utils/query";
import { t } from "../utils/i18n";
import { Icon } from "./icons";

// The result panel's status band (issue #691, R-01): what the run below the
// editor is doing or did, said in one line that ties the result to the run.
//
//   running  «Ejecutando · 00:04 · sentencia 2 de 3»          [Cancelar]
//   rows     «Resultado · 8 filas · 11 ms»
//   write    «2 filas afectadas · 9 ms»
//   error    «Error en la línea 3 · 13 ms»                    [Ir a la línea 3]
//
// The clock ticks while the query runs, so a slow query never looks like a dead
// screen. Presentational: the workspace passes the tab's run state.
export function RunStatus(props: {
  loading: boolean;
  /** When the run started (epoch ms): the clock counts from here. */
  startedAt?: number;
  /** Which statement of a script is running. */
  progress?: { n: number; total: number } | null;
  result: ResultSet | null;
  error: string | null;
  elapsedMs: number | null;
  /** The line the engine blamed, if it named one (see errorLine). */
  errorLine?: number | null;
  /** Cancel the running query; absent when it cannot be offered. */
  onCancel?: () => void;
  /** Why it cannot be cancelled (engine without cancel). */
  cancelBlocked?: string;
  /** Show the failed line in the editor; absent when the editor cannot find it. */
  onReveal?: () => void;
}) {
  const [now, setNow] = createSignal(Date.now());
  createEffect(() => {
    if (!props.loading) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    onCleanup(() => clearInterval(timer));
  });

  const kind = () =>
    props.error !== null
      ? "error"
      : setKind({ sql: "", label: "", result: props.result, error: null, elapsedMs: 0 });
  const count = () =>
    setCount({ sql: "", label: "", result: props.result, error: null, elapsedMs: 0 });
  const took = () => (props.elapsedMs === null ? "" : ` · ${formatDuration(props.elapsedMs)}`);
  const plural = (base: string, n: number) => t(n === 1 ? `${base}One` : base, { n });

  const text = () => {
    if (props.loading) {
      const clock = t("run.running", { time: formatElapsed(now() - (props.startedAt ?? now())) });
      const p = props.progress;
      return p && p.total > 1 ? `${clock} · ${t("run.progress", { n: p.n, total: p.total })}` : clock;
    }
    if (kind() === "error") {
      const line = props.errorLine;
      return (line ? t("run.errorAt", { n: line }) : t("run.error")) + took();
    }
    return (kind() === "rows" ? plural("run.rows", count()) : plural("run.affected", count())) + took();
  };

  return (
    <Show when={props.loading || props.result || props.error !== null}>
      <div
        class="run-status"
        classList={{ "is-running": props.loading, "is-error": !props.loading && kind() === "error" }}
        role="status"
        aria-live="polite"
      >
        <Show when={props.loading} fallback={<Icon name={kind() === "error" ? "warning" : "check"} size={14} />}>
          <span class="tab-spinner" aria-hidden="true" />
        </Show>
        <span class="run-status-text num">{text()}</span>
        <span class="toolbar-spacer" />
        <Show when={props.loading && props.onCancel}>
          <button
            class="edit-btn"
            disabled={!!props.cancelBlocked}
            title={props.cancelBlocked}
            onClick={() => props.onCancel?.()}
          >
            {t("common.cancel")}
          </button>
        </Show>
        <Show when={!props.loading && kind() === "error" && props.onReveal}>
          <button class="edit-btn" onClick={() => props.onReveal?.()}>
            {props.errorLine ? t("run.goToLine", { n: props.errorLine }) : t("run.goToStatement")}
          </button>
        </Show>
      </div>
    </Show>
  );
}
