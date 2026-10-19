import { For, Show, createMemo, createSignal } from "solid-js";
import {
  connIcon,
  connectionGroups,
  connectionTarget,
  driverSchema,
  groupConnections,
  type Connection,
} from "../utils/connections";
import { loadCollapsedGroups, saveCollapsedGroups } from "../utils/connectionStore";
import { openContextMenu, type MenuItem } from "../utils/contextMenu";
import { t, locale } from "../utils/i18n";
import { Icon } from "./icons";
import { EnvChip, SafeChip } from "./ConnChips";
import { matchesConnection } from "../utils/connectionSearch";
import { timeAgo } from "../utils/history";
import type { UsageMap } from "../utils/recentConnections";

// Props for the connection list + CRUD. Opening, closing and reconnecting are
// NOT here: they belong to the sidebar's bar and its search (issue #525).
export interface ConnectionManagerProps {
  connections: Connection[];
  /** The focused connection's id (drives the tree + new tabs); highlighted. */
  activeConnId: string | null;
  /** Ids of every open connection (several can be open at once). */
  openIds?: string[];
  onEdit: (c: Connection) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  /** Export saved connections to a JSON file (issue #188); `ids` narrows it to
      those (a row's own «Exportar…»), always without passwords. */
  onExport: (includePasswords: boolean, ids?: string[]) => void;
  /** Open it, or focus it when it is open already (R-06). Absent: no button. */
  onConnect?: (c: Connection) => void;
  /** A copy in the connection form, saved only from there. */
  onDuplicate?: (c: Connection) => void;
  /** When each was last opened, for the «Último uso» column. */
  usage?: UsageMap;
  /** Injected in tests; Date.now otherwise. */
  now?: () => number;
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

  // The search narrows the list as the bar's search does (name, engine, target, group).
  const [query, setQuery] = createSignal("");
  const shown = createMemo(() =>
    props.connections.filter((c) =>
      matchesConnection(c, query(), driverSchema(c.driver)?.label ?? c.driver),
    ),
  );

  // Collapsed groups persist across restarts (UI state, its own storage key).
  const [collapsed, setCollapsed] = createSignal<string[]>(loadCollapsedGroups());
  const toggleGroup = (name: string, open: boolean) => {
    const next = open ? collapsed().filter((n) => n !== name) : [...collapsed(), name];
    setCollapsed(next);
    saveCollapsedGroups(next);
  };

  // Right-click a connection (or its "more" button) to move it between the
  // groups that already exist — creating one is done in the connection form —
  // or to delete it. Delete is the LAST item, in danger colour, away from Edit
  // (issue #762): it used to be a bare icon touching the pencil.
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
    if (props.onDuplicate) items.push({ label: t("conn.duplicate"), action: () => props.onDuplicate!(c) });
    items.push({ label: t("conn.exportOne"), action: () => props.onExport(false, [c.id]) });
    items.push({ separator: true });
    items.push({ label: t("conn.deleteItem"), danger: true, action: () => props.onDelete(c.id) });
    openContextMenu(e, items);
  };

  // A row is what the connection IS, not a way to open it: opening moved to the
  // bar's search (issue #525), and this list is where a connection is created,
  // renamed, moved between groups or deleted. Editing is the row's own action,
  // so the whole row activates it rather than being dead weight next to a pencil.
  const row = (c: Connection) => (
    <li
      class={`conn-item ${c.id === props.activeConnId ? "active" : ""} ${
        props.openIds?.includes(c.id) ? "open" : ""
      }`}
      style={c.color ? { "border-left": `3px solid ${c.color}` } : undefined}
      onContextMenu={(e) => rowMenu(e, c)}
    >
      {/* Named after its connection, not just "Editar": the pencil beside it
          edits too, and two buttons sharing an accessible name are ambiguous
          for a screen reader as much as for a test. */}
      <button class="conn-open" title={t("conn.editName", { name: c.name })} onClick={() => props.onEdit(c)}>
        <span class="conn-name">
          <Show when={c.color}>
            <span class="conn-color" style={{ background: c.color }} />
          </Show>
          {/* Decoration: the engine is spelled out on the second line, so the
              icon adds nothing a screen reader needs — and unmarked it landed
              INSIDE the button's accessible name ("🗄️ Nómina SQLite · …"),
              which is the very thing the emoji-to-SVG move settled (#332). */}
          <span class="engine-icon" aria-hidden="true">{connIcon(c)}</span> {c.name}
          <Show when={props.openIds?.includes(c.id)}>
            <span class="conn-live" role="img" aria-label={t("conn.connectedDot")} title={t("conn.connectedDot")} />
          </Show>
        </span>
        <span class="conn-driver">{driverSchema(c.driver)?.label ?? c.driver}</span>
      </button>
      <span class="conn-cell conn-target" title={connectionTarget(c)}>
        {connectionTarget(c)}
      </span>
      <span class="conn-cell">
        <Show when={c.env} fallback={<span class="conn-none">—</span>}>
          <EnvChip env={c.env} />
        </Show>
      </span>
      <span class="conn-cell">
        <Show when={c.safeMode} fallback={<span class="conn-none">{t("conn.protectNone")}</span>}>
          <SafeChip mode={c.safeMode} />
        </Show>
      </span>
      <span class="conn-cell conn-when">
        {props.usage?.[c.id] !== undefined
          ? timeAgo(props.usage[c.id], (props.now ?? Date.now)(), locale())
          : t("welcome.neverUsed")}
      </span>
      <div class="conn-actions">
        <Show when={props.onConnect}>
          <button class="btn conn-connect" onClick={() => props.onConnect!(c)}>
            {t(props.openIds?.includes(c.id) ? "conn.openIt" : "conn.connect")}
          </button>
        </Show>
        <button
          title={t("common.edit")}
          aria-label={t("common.edit")}
          onClick={() => props.onEdit(c)}
        >
          <Icon name="edit" size={14} />
        </button>
        <button
          title={t("conn.more", { name: c.name })}
          aria-label={t("conn.more", { name: c.name })}
          onClick={(e) => rowMenu(e, c)}
        >
          <Icon name="more" size={14} />
        </button>
      </div>
    </li>
  );

  return (
    <div class="conn-manager">
      <button class="conn-new" onClick={props.onNew}>
        <Icon name="plus" size={14} /> {t("conn.new")}
      </button>

      <div class="conn-io">
        <Show when={props.connections.length > 0}>
          <button class="conn-io-btn" onClick={() => setShowExport((v) => !v)}>
            <Icon name="export" size={14} /> {t("conn.export")}
          </button>
        </Show>
        <button class="conn-io-btn" onClick={() => fileInput?.click()}>
          <Icon name="import" size={14} /> {t("conn.import")}
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

      <Show when={props.connections.length > 0}>
        <input
          class="conn-search"
          type="search"
          placeholder={t("conn.searchPlaceholder")}
          aria-label={t("conn.searchPlaceholder")}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <div class="conn-head" aria-hidden="true">
          <span>{t("conn.col.name")}</span>
          <span>{t("conn.col.target")}</span>
          <span>{t("conn.col.env")}</span>
          <span>{t("conn.col.protection")}</span>
          <span>{t("conn.col.lastUsed")}</span>
          <span>{t("conn.col.actions")}</span>
        </div>
        <Show when={shown().length === 0}>
          <p class="sidebar-hint">{t("connsearch.noMatch")}</p>
        </Show>
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
        <For each={groupConnections(shown())}>
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
                      <span class="conn-live" role="img" aria-label={t("conn.connectedDot")} title={t("conn.connectedDot")} />
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
