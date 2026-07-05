import { For, Show, createSignal } from "solid-js";
import { driverSchema, engineIcon, type Connection } from "../utils/connections";

// Sidebar list of saved connections with CRUD + connect actions. Clicking a
// connection opens it; the active one is highlighted. Presentational — all
// state and IPC live in App. Export/import (issue #188) let the user back up and
// migrate connections; the export password opt-in is a deliberate, warned choice.
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
  /** Export saved connections to a JSON file (issue #188). */
  onExport: (includePasswords: boolean) => void;
  /** Import connections from a file; resolves with a message to show the user. */
  onImport: (file: File) => Promise<string>;
}) {
  const [showExport, setShowExport] = createSignal(false);
  const [includePasswords, setIncludePasswords] = createSignal(false);
  const [importMsg, setImportMsg] = createSignal<string | null>(null);
  let fileInput: HTMLInputElement | undefined;

  const doExport = () => {
    props.onExport(includePasswords());
    setShowExport(false);
    setIncludePasswords(false);
  };

  const onFile = async (e: Event & { currentTarget: HTMLInputElement }) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ""; // allow re-importing the same file
    if (!file) return;
    setImportMsg(await props.onImport(file));
  };

  return (
    <div class="conn-manager">
      <button class="conn-new" onClick={props.onNew}>
        + Nueva conexión
      </button>

      <div class="conn-io">
        <Show when={props.connections.length > 0}>
          <button class="conn-io-btn" onClick={() => setShowExport((v) => !v)}>
            ⬆ Exportar
          </button>
        </Show>
        <button class="conn-io-btn" onClick={() => fileInput?.click()}>
          ⬇ Importar
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={onFile}
        />
      </div>

      <Show when={showExport()}>
        <div class="conn-export">
          <label class="conn-export-opt">
            <input
              type="checkbox"
              checked={includePasswords()}
              onChange={(e) => setIncludePasswords(e.currentTarget.checked)}
            />
            Incluir contraseñas
          </label>
          <Show when={includePasswords()}>
            <p class="conn-warn">
              ⚠ El archivo guardará las contraseñas en <strong>texto plano</strong>.
            </p>
          </Show>
          <div class="conn-export-actions">
            <button class="conn-io-btn" onClick={doExport}>
              Exportar
            </button>
            <button class="conn-io-btn" onClick={() => setShowExport(false)}>
              Cancelar
            </button>
          </div>
        </div>
      </Show>

      <Show when={importMsg()}>
        <p class="conn-import-msg">{importMsg()}</p>
      </Show>

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
