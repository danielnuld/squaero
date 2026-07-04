import { For, Show, createMemo, createSignal, onMount } from "solid-js";
import { runQuery, type ResultSet } from "../utils/query";
import { errorText } from "../utils/errors";
import { monitorFor, buildKillSql, unsupportedReason } from "../utils/serverMonitor";
import { Modal } from "./Modal";

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

  const idIndex = createMemo(() => {
    const cols = result()?.columns ?? [];
    if (!support.idColumn) return -1;
    return cols.findIndex((c) => c.name.toLowerCase() === support.idColumn!.toLowerCase());
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
  const cols = () => result()?.columns ?? [];

  return (
    <Modal title="Monitor de servidor" wide class="server-monitor" onClose={props.onClose}>
      <div class="sm-head">
        <h2>Monitor de servidor</h2>
        <div class="sm-actions">
          <Show when={support.supported}>
            <span class="sm-count">{rows().length} sesión(es)</span>
            <button class="edit-btn" disabled={loading()} onClick={load}>
              {loading() ? "Actualizando…" : "⟳ Refrescar"}
            </button>
          </Show>
          <button class="edit-btn" onClick={props.onClose}>
            Cerrar
          </button>
        </div>
      </div>

      <Show when={error()}>
        <div class="grid-error" role="alert">
          {error()}
        </div>
      </Show>

      <Show
        when={support.supported}
        fallback={<p class="grid-empty">{unsupportedReason(props.engine)}</p>}
      >
        <Show
          when={rows().length > 0}
          fallback={
            <p class="grid-empty">
              {loading() ? "Cargando…" : "No hay sesiones activas."}
            </p>
          }
        >
          <div class="sm-scroll">
            <table class="sm-table">
              <thead>
                <tr>
                  <Show when={support.canKill}>
                    <th class="sm-kill-col" />
                  </Show>
                  <For each={cols()}>{(c) => <th>{c.name}</th>}</For>
                </tr>
              </thead>
              <tbody>
                <For each={rows()}>
                  {(row) => {
                    const id = () => (idIndex() >= 0 ? row[idIndex()] : null);
                    return (
                      <tr>
                        <Show when={support.canKill}>
                          <td class="sm-kill-col">
                            <Show when={id() !== null}>
                              <button
                                class="edit-btn sm-kill"
                                title={`Matar sesión ${id()}`}
                                disabled={killing() !== null}
                                onClick={() => kill(id()!)}
                              >
                                {killing() === id() ? "…" : "Matar"}
                              </button>
                            </Show>
                          </td>
                        </Show>
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
    </Modal>
  );
}
