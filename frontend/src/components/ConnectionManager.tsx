import { For, Show, createSignal } from "solid-js";
import { driverSchema, engineIcon, type Connection } from "../utils/connections";
import { t } from "../utils/i18n";

// Props for the connection list + CRUD. Shared with ConnectionBar, which wraps
// this component in a collapsible sidebar popover (Explorer-first layout).
export interface ConnectionManagerProps {
  connections: Connection[];
  /** The focused connection's id (drives the tree + new tabs); highlighted. */
  activeConnId: string | null;
  /** Ids of every open connection (several can be open at once). */
  openIds?: string[];
  /** Id of the connection currently being opened (shows a busy state). */
  connectingId: string | null;
  onConnect: (c: Connection) => void;
  onEdit: (c: Connection) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  /** Close an open connection (defaults to the focused one). */
  onDisconnect: (defId?: string) => void;
  /** Reconnect the focused connection with a fresh session (recovers a drop). */
  onReconnect: () => void;
  /** Export saved connections to a JSON file (issue #188). */
  onExport: (includePasswords: boolean) => void;
  /** Import connections from a file; resolves with a message to show the user. */
  onImport: (file: File) => Promise<string>;
}

// Sidebar list of saved connections with CRUD + connect actions. Clicking a
// connection opens it; the active one is highlighted. Presentational — all
// state and IPC live in App. Export/import (issue #188) let the user back up and
// migrate connections; the export password opt-in is a deliberate, warned choice.
export function ConnectionManager(props: ConnectionManagerProps) {
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
        + {t("conn.new")}
      </button>

      <div class="conn-io">
        <Show when={props.connections.length > 0}>
          <button class="conn-io-btn" onClick={() => setShowExport((v) => !v)}>
            ⬆ {t("conn.export")}
          </button>
        </Show>
        <button class="conn-io-btn" onClick={() => fileInput?.click()}>
          ⬇ {t("conn.import")}
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
            {t("conn.includePasswords")}
          </label>
          <Show when={includePasswords()}>
            <p class="conn-warn" innerHTML={t("conn.plaintextWarn")}></p>
          </Show>
          <div class="conn-export-actions">
            <button class="conn-io-btn" onClick={doExport}>
              {t("conn.export")}
            </button>
            <button class="conn-io-btn" onClick={() => setShowExport(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      </Show>

      <Show when={importMsg()}>
        <p class="conn-import-msg">{importMsg()}</p>
      </Show>

      <Show
        when={props.connections.length > 0}
        fallback={<p class="sidebar-hint">{t("conn.empty")}</p>}
      >
        <ul class="conn-list">
          <For each={props.connections}>
            {(c) => (
              <li
                class={`conn-item ${c.id === props.activeConnId ? "active" : ""} ${
                  props.openIds?.includes(c.id) ? "open" : ""
                }`}
                style={c.color ? { "border-left": `3px solid ${c.color}` } : undefined}
              >
                <button
                  class="conn-open"
                  title={props.openIds?.includes(c.id) ? t("conn.focus") : t("conn.connect")}
                  disabled={props.connectingId !== null}
                  onClick={() => props.onConnect(c)}
                >
                  <span class="conn-name">
                    <Show when={c.color}>
                      <span class="conn-color" style={{ background: c.color }} />
                    </Show>
                    <span class="engine-icon">{engineIcon(c.driver)}</span> {c.name}
                    <Show when={props.openIds?.includes(c.id)}>
                      <span class="conn-live" title={t("conn.connectedDot")}>●</span>
                    </Show>
                  </span>
                  <span class="conn-driver">
                    {driverSchema(c.driver)?.label ?? c.driver}
                    {props.connectingId === c.id ? " · " + t("conn.connecting") : ""}
                  </span>
                </button>
                <div class="conn-actions">
                  <Show when={c.id === props.activeConnId}>
                    <button
                      title={t("conn.reconnect")}
                      disabled={props.connectingId !== null}
                      onClick={() => props.onReconnect()}
                    >
                      ↻
                    </button>
                  </Show>
                  <Show when={props.openIds?.includes(c.id)}>
                    <button title={t("conn.disconnect")} onClick={() => props.onDisconnect(c.id)}>
                      ⏏
                    </button>
                  </Show>
                  <button title={t("common.edit")} onClick={() => props.onEdit(c)}>
                    ✎
                  </button>
                  <button class="danger" title={t("common.delete")} onClick={() => props.onDelete(c.id)}>
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
