import { For, Show, createSignal } from "solid-js";
import {
  connIcon,
  connectionGroups,
  driverSchema,
  groupConnections,
  type Connection,
} from "../utils/connections";
import { loadCollapsedGroups, saveCollapsedGroups } from "../utils/connectionStore";
import { openContextMenu, type MenuItem } from "../utils/contextMenu";
import { t } from "../utils/i18n";

// Props for the connection list + CRUD. Shared with ConnectionBar, which wraps
// this component in a collapsible sidebar popover (Explorer-first layout).
export interface ConnectionManagerProps {
  connections: Connection[];
  /** The focused connection's id (drives the tree + new tabs); highlighted. */
  activeConnId: string | null;
  /** Ids of every open connection (several can be open at once). */
  openIds?: string[];
  /** Of the open ones, those the core has told us are gone (issue #407). The
      entry stays open — its tabs and their unsaved SQL depend on it — but the
      bar must stop claiming it is connected. */
  lostIds?: string[];
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
  onImport: (files: File[]) => Promise<string>;
  /** Move a connection to a group ("" = ungrouped). New groups are named in the
      connection form; the context menu only moves between existing ones. */
  onMoveToGroup: (id: string, group: string) => void;
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
    // Several at once: DBeaver keeps the connection list and its passwords in
    // two files, and picking them together is the whole gesture (#391).
    const files = [...(e.currentTarget.files ?? [])];
    e.currentTarget.value = ""; // allow re-importing the same file
    if (files.length === 0) return;
    setImportMsg(await props.onImport(files));
  };

  // Collapsed groups persist across restarts (UI state, its own storage key).
  const [collapsed, setCollapsed] = createSignal<string[]>(loadCollapsedGroups());
  const toggleGroup = (name: string, open: boolean) => {
    const next = open ? collapsed().filter((n) => n !== name) : [...collapsed(), name];
    setCollapsed(next);
    saveCollapsedGroups(next);
  };

  // Right-click a connection to move it between the groups that already exist.
  // Creating a group is done in the connection form, where it can be typed.
  const rowMenu = (e: MouseEvent, c: Connection) => {
    const current = (c.group ?? "").trim();
    const items: MenuItem[] = connectionGroups(props.connections)
      .filter((g) => g !== current)
      .map((g) => ({ label: t("conn.moveTo", { group: g }), action: () => props.onMoveToGroup(c.id, g) }));
    if (current) {
      items.push({ label: t("conn.moveToNone"), action: () => props.onMoveToGroup(c.id, "") });
    }
    if (items.length > 0) items.push({ separator: true });
    items.push({ label: t("common.edit"), action: () => props.onEdit(c) });
    openContextMenu(e, items);
  };

  const row = (c: Connection) => (
    <li
      class={`conn-item ${c.id === props.activeConnId ? "active" : ""} ${
        props.openIds?.includes(c.id) ? "open" : ""
      }`}
      style={c.color ? { "border-left": `3px solid ${c.color}` } : undefined}
      onContextMenu={(e) => rowMenu(e, c)}
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
          <span class="engine-icon">{connIcon(c)}</span> {c.name}
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
  );

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
          /* Ours, DBeaver's data-sources.json, and Navicat's .ncx — the reader
             tells them apart by content, so the extension is only a filter. */
          multiple
          accept=".json,.ncx,.xml,application/json,text/xml"
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
        fallback={
          <>
            <p class="sidebar-hint">{t("conn.empty")}</p>
            {/* Said exactly here, and only here: someone arriving from another
                tool has nothing saved yet, and this is the moment that decides
                whether they retype thirty servers or import them (#391). Once
                there are connections the line has done its job and goes away. */}
            <p class="sidebar-hint">{t("conn.importForeign")}</p>
          </>
        }
      >
        <For each={groupConnections(props.connections)}>
          {(g) => (
            <Show
              when={g.name}
              fallback={
                <ul class="conn-list">
                  <For each={g.conns}>{row}</For>
                </ul>
              }
            >
              {(name) => (
                <details
                  class="conn-group"
                  open={!collapsed().includes(name())}
                  onToggle={(e) => toggleGroup(name(), e.currentTarget.open)}
                >
                  <summary>
                    <span class="conn-group-name">{name()}</span>
                    <Show when={g.conns.some((c) => props.openIds?.includes(c.id))}>
                      <span class="conn-live" title={t("conn.connectedDot")}>●</span>
                    </Show>
                    <span class="conn-group-count">{g.conns.length}</span>
                  </summary>
                  <ul class="conn-list">
                    <For each={g.conns}>{row}</For>
                  </ul>
                </details>
              )}
            </Show>
          )}
        </For>
      </Show>
    </div>
  );
}
