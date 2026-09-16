import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { engineMonogram, type Connection } from "../utils/connections";
import { ConnectionSearch } from "./ConnectionSearch";
import { t } from "../utils/i18n";

/** One open connection, as the bar draws it. */
export interface OpenConnRow {
  defId: string;
  name: string;
  driver: string;
  color?: string;
  /** The core said the session is gone (issue #407). */
  lost?: boolean;
  /** Engine label plus where it points — the second line of the row. */
  sub: string;
}

// The sidebar's connection bar (issue #525). It used to be ONE row — the focused
// connection — with the whole manager behind a popover: with three connections
// open it showed one, switching meant open the popover, find it, click it, and
// finding one among thirty meant folding groups by hand.
//
// Now every open connection has its own row, always visible, and a click focuses
// it. The + opens a SEARCH over the saved ones (ConnectionSearch); creating,
// editing, importing and exporting live in their own tab, which the search's
// footer opens. What belongs to a single connection (its tools, refresh,
// collapse, working database) stays in that connection's explorer section header
// (issue #444); this bar answers "what is open, and which one am I in".
export function ConnectionBar(props: {
  /** Every saved connection — what the search looks through. */
  connections: Connection[];
  /** The open connections, in the order they were opened. */
  open: OpenConnRow[];
  /** Which one the workspace is on. */
  focusedDefId: string | null;
  /** Non-null while a connection is being opened. */
  connectingId: string | null;
  /** Bring a connection into focus (never opens or closes anything). */
  onFocus: (defId: string) => void;
  /** Open a saved connection, or focus it when it is already open. */
  onPick: (c: Connection) => void;
  onDisconnect: (defId: string) => void;
  /** Reconnect one connection — a lost session is recovered from its row. */
  onReconnectConn: (defId: string) => void;
  /** Open the connection form for a new connection. */
  onNew: () => void;
  /** Open the manager tab on its import step. */
  onImport: () => void;
  /** Open the manager tab. */
  onManage: () => void;
}) {
  const [searching, setSearching] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;

  // Dismiss on a click outside the bar + popover.
  onMount(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // A context menu renders outside this popover (it lives in App); clicking
      // one of its items must not collapse the search.
      if (target instanceof Element && target.closest(".context-menu")) return;
      if (searching() && rootEl && !rootEl.contains(target)) setSearching(false);
    };
    document.addEventListener("mousedown", onDown);
    onCleanup(() => document.removeEventListener("mousedown", onDown));
  });

  const count = () => props.open.length;
  const openIds = () => props.open.map((r) => r.defId);

  return (
    <div class="connbar" ref={rootEl}>
      <div class="connbar-head">
        <span class="connbar-count">
          {count() === 0
            ? t("connbar.noneOpen")
            : count() === 1
              ? t("connbar.openOne")
              : t("connbar.openN", { n: count() })}
        </span>
        <button
          class="connbar-add"
          aria-expanded={searching()}
          title={t("connbar.add")}
          aria-label={t("connbar.add")}
          onClick={() => setSearching((v) => !v)}
        >
          +
        </button>
      </div>

      {/* A list, not a listbox: every row carries its own buttons (disconnect,
          reconnect), and buttons inside an `option` is worse than having no
          listbox at all. The focused row says so with aria-current. */}
      <Show
        when={count() > 0}
        fallback={
          <p class="connbar-empty">
            {t("connbar.emptyHint")}{" "}
            {/* Its own wording, not the + button's: two buttons with the same
                accessible name are ambiguous for a screen reader as much as for
                a test. */}
            <button class="connbar-empty-link" onClick={() => setSearching(true)}>
              {t("connbar.emptyAction")}
            </button>
          </p>
        }
      >
        <ul class="connbar-list" aria-label={t("connbar.listLabel")}>
          <For each={props.open}>
            {(row) => {
              const focused = () => row.defId === props.focusedDefId;
              return (
                <li class="connbar-item" classList={{ "is-focused": focused() }}>
                  <span
                    class="connbar-accent"
                    style={row.color ? { background: row.color } : undefined}
                    aria-hidden="true"
                  />
                  <button
                    class="connbar-pick"
                    aria-current={focused() ? "true" : undefined}
                    title={t("connbar.focusTitle", { name: row.name })}
                    onClick={() => props.onFocus(row.defId)}
                  >
                    <span class="connbar-mono" aria-hidden="true">
                      {engineMonogram(row.driver)}
                    </span>
                    <span class="connbar-text">
                      <span class="connbar-name">{row.name}</span>
                      <span class="connbar-sub">{row.sub}</span>
                    </span>
                  </button>
                  <div class="connbar-actions">
                    <Show
                      when={row.lost}
                      fallback={
                        <span class="conn-live" title={t("conn.connectedDot")} aria-hidden="true">
                          ●
                        </span>
                      }
                    >
                      <span class="connbar-lost">{t("conn.statusLost")}</span>
                      <button
                        class="connbar-act"
                        title={t("conn.reconnect")}
                        aria-label={t("conn.reconnect")}
                        disabled={props.connectingId !== null}
                        onClick={() => props.onReconnectConn(row.defId)}
                      >
                        ↻
                      </button>
                    </Show>
                    <button
                      class="connbar-act connbar-eject"
                      title={t("conn.disconnectName", { name: row.name })}
                      aria-label={t("conn.disconnectName", { name: row.name })}
                      disabled={props.connectingId !== null}
                      onClick={() => props.onDisconnect(row.defId)}
                    >
                      ⏏
                    </button>
                  </div>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>

      <Show when={searching()}>
        <div class="connbar-drop">
          <ConnectionSearch
            connections={props.connections}
            openIds={openIds()}
            connectingId={props.connectingId}
            onPick={props.onPick}
            onNew={() => {
              props.onNew();
              setSearching(false);
            }}
            onImport={() => {
              props.onImport();
              setSearching(false);
            }}
            onManage={() => {
              props.onManage();
              setSearching(false);
            }}
            onClose={() => setSearching(false)}
          />
        </div>
      </Show>
    </div>
  );
}
