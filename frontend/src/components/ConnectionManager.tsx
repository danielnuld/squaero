import { For, Show } from "solid-js";
import { driverSchema, engineIcon, type Connection } from "../utils/connections";

// Sidebar list of saved connections with CRUD + connect actions. Clicking a
// connection opens it; the active one is highlighted. Presentational — all
// state and IPC live in App.
export function ConnectionManager(props: {
  connections: Connection[];
  activeConnId: string | null;
  /** Id of the connection currently being opened (shows a busy state). */
  connectingId: string | null;
  onConnect: (c: Connection) => void;
  onEdit: (c: Connection) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  /** Close the active connection. */
  onDisconnect: () => void;
  /** Reconnect the active connection with a fresh session (recovers a drop). */
  onReconnect: () => void;
}) {
  return (
    <div class="conn-manager">
      <button class="conn-new" onClick={props.onNew}>
        + Nueva conexión
      </button>

      <Show
        when={props.connections.length > 0}
        fallback={<p class="sidebar-hint">No hay conexiones guardadas.</p>}
      >
        <ul class="conn-list">
          <For each={props.connections}>
            {(c) => (
              <li class={`conn-item ${c.id === props.activeConnId ? "active" : ""}`}>
                <button
                  class="conn-open"
                  title="Conectar"
                  disabled={props.connectingId !== null}
                  onClick={() => props.onConnect(c)}
                >
                  <span class="conn-name">
                    <span class="engine-icon">{engineIcon(c.driver)}</span> {c.name}
                  </span>
                  <span class="conn-driver">
                    {driverSchema(c.driver)?.label ?? c.driver}
                    {props.connectingId === c.id ? " · conectando…" : ""}
                  </span>
                </button>
                <div class="conn-actions">
                  <Show when={c.id === props.activeConnId}>
                    <button
                      title="Reconectar"
                      disabled={props.connectingId !== null}
                      onClick={() => props.onReconnect()}
                    >
                      ↻
                    </button>
                    <button title="Desconectar" onClick={() => props.onDisconnect()}>
                      ⏏
                    </button>
                  </Show>
                  <button title="Editar" onClick={() => props.onEdit(c)}>
                    ✎
                  </button>
                  <button class="danger" title="Eliminar" onClick={() => props.onDelete(c.id)}>
                    🗑
                  </button>
                </div>
              </li>
            )}
          </For>
        </ul>
      </Show>
    </div>
  );
}
