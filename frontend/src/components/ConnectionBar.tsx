import { For, Show, createSignal, createEffect, onCleanup, onMount, mergeProps } from "solid-js";
import { engineMonogram, type Connection } from "../utils/connections";
import { ConnectionManager, type ConnectionManagerProps } from "./ConnectionManager";
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
// connection — with everything else behind a popover: with three connections
// open it showed one, and switching meant open the popover, find it, click it.
// Now every open connection has its own row, always visible, and a click focuses
// it. What belongs to a single connection (its tools, refresh, collapse, working
// database) stays in that connection's explorer section header (issue #444);
// this bar answers "what is open, and which one am I in".
//
// Connecting still goes through the popover below, which holds the full manager.
// Phase C of the change replaces it with a search and moves the manager to its
// own tab — until then this stays the only road to a saved connection.
export function ConnectionBar(
  props: ConnectionManagerProps & {
    openTick?: number;
    /** The open connections, in the order they were opened. */
    open: OpenConnRow[];
    /** Which one the workspace is on. */
    focusedDefId: string | null;
    /** Bring a connection into focus (never opens or closes anything). */
    onFocus: (defId: string) => void;
    /** Reconnect one connection — a lost session is recovered from its row. */
    onReconnectConn: (defId: string) => void;
  },
) {
  const [open, setOpen] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;

  // Reopen the popover when the app asks (bumped after saving a connection), so
  // a just-added connection is visible in the list — otherwise the form closes
  // over a collapsed bar and the save appears to have done nothing.
  let lastOpenTick = props.openTick ?? 0;
  createEffect(() => {
    const tick = props.openTick ?? 0;
    if (tick !== lastOpenTick) {
      lastOpenTick = tick;
      setOpen(true);
    }
  });

  // Close the popover after an action that navigates away from it (connecting,
  // or opening the new/edit form), while forwarding the real handler.
  // mergeProps (NOT object spread) keeps `props` reactive: spreading `{...props}`
  // snapshots the connection list at mount time, so a connection added later
  // never reaches the ConnectionManager below (it only appeared after a restart).
  const closingProps: ConnectionManagerProps = mergeProps(props, {
    onConnect: (c: Connection) => {
      props.onConnect(c);
      setOpen(false);
    },
    onNew: () => {
      props.onNew();
      setOpen(false);
    },
    onEdit: (c: Connection) => {
      props.onEdit(c);
      setOpen(false);
    },
  });

  // Dismiss on a click outside the bar + popover.
  onMount(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      // The context menu of a connection row renders outside this popover (it
      // lives in App); clicking one of its items must not collapse the list.
      if (target instanceof Element && target.closest(".context-menu")) return;
      if (open() && rootEl && !rootEl.contains(target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    onCleanup(() => document.removeEventListener("mousedown", onDown));
  });

  const count = () => props.open.length;

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
          aria-expanded={open()}
          title={t("connbar.add")}
          aria-label={t("connbar.add")}
          onClick={() => setOpen((v) => !v)}
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
                accessible name are ambiguous for a screen reader — and for a
                test, which is how this was caught. */}
            <button class="connbar-empty-link" onClick={() => setOpen(true)}>
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

      <Show when={open()}>
        <div class="connbar-drop">
          <ConnectionManager {...closingProps} />
        </div>
      </Show>
    </div>
  );
}
