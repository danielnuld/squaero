import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { engineMonogram, connectionTarget, driverSchema, type Connection } from "../utils/connections";
import { ConnectionSearch } from "./ConnectionSearch";
import { t } from "../utils/i18n";
import { Icon } from "./icons";
import type { SafeMode } from "../utils/safeMode";

/** How many saved connections the empty explorer offers directly. */
const SAVED_SHOWN = 6;

// The explorer's head (issue #689): its title, the + that searches the saved
// connections to open one, and — with nothing open — an empty state with the
// saved connections a click away. Each OPEN connection is a row at the top of
// its own tree (ObjectTree's header), so the explorer lists it once.
export function ConnectionBar(props: {
  /** Every saved connection — what the search looks through. */
  connections: Connection[];
  /** The saved ids of the open connections. */
  openIds: string[];
  /** Non-null while a connection is being opened. */
  connectingId: string | null;
  /** Open a saved connection, or focus it when it is already open. */
  onPick: (c: Connection) => void;
  /** Open the connection form for a new connection. */
  onNew: () => void;
  /** Open the manager tab on its import step. */
  onImport: () => void;
  /** Open the manager tab. */
  onManage: () => void;
}) {
  const [searching, setSearching] = createSignal(false);
  const [popAt, setPopAt] = createSignal({ top: 0, left: 0 });
  let rootEl: HTMLDivElement | undefined;

  const openSearch = () => {
    const box = rootEl?.getBoundingClientRect();
    if (box) setPopAt({ top: box.bottom + 4, left: box.left + 8 });
    setSearching(true);
  };

  onMount(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (target instanceof Element && target.closest(".context-menu")) return;
      if (searching() && rootEl && !rootEl.contains(target)) setSearching(false);
    };
    document.addEventListener("mousedown", onDown);
    onCleanup(() => document.removeEventListener("mousedown", onDown));
  });

  const saved = () => props.connections.slice(0, SAVED_SHOWN);
  const subOf = (c: Connection) => {
    const label = driverSchema(c.driver)?.label ?? c.driver;
    const target = connectionTarget(c);
    return target ? `${label} · ${target}` : label;
  };

  return (
    <div class="connbar" ref={rootEl}>
      <div class="connbar-head">
        <span class="explorer-title">{t("explorer.title")}</span>
        <button
          class="connbar-add"
          aria-expanded={searching()}
          title={t("connbar.add")}
          aria-label={t("connbar.add")}
          onClick={() => (searching() ? setSearching(false) : openSearch())}
        >
          <Icon name="plus" size={14} />
        </button>
      </div>

      <Show when={props.openIds.length === 0}>
        <div class="explorer-empty">
          <span class="explorer-empty-title">{t("explorer.noneTitle")}</span>
          <span>{t("connbar.emptyHint")}</span>
          {/* Its own wording, not the + button's: two buttons with the same
              accessible name are ambiguous for a screen reader and for a test. */}
          <button class="primary connbar-empty-link" onClick={openSearch}>
            {t("connbar.emptyAction")}
          </button>
        </div>
        <Show when={saved().length > 0}>
          <div class="explorer-label">{t("explorer.saved")}</div>
          <ul class="explorer-saved" aria-label={t("explorer.saved")}>
            <For each={saved()}>
              {(c) => (
                <li>
                  <button
                    class="explorer-saved-row"
                    disabled={props.connectingId !== null}
                    style={c.color ? { "--conn-accent": c.color } : undefined}
                    onClick={() => props.onPick(c)}
                  >
                    <span class="connbar-accent" aria-hidden="true" />
                    <span class="connbar-mono" aria-hidden="true">
                      {engineMonogram(c.driver)}
                    </span>
                    <span class="connbar-text">
                      <span class="connbar-name">{c.name}</span>
                      <span class="connbar-sub">{subOf(c)}</span>
                    </span>
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </Show>

      <Show when={searching()}>
        <div
          class="connbar-drop"
          style={{ top: `${popAt().top}px`, left: `${popAt().left}px` }}
        >
          <ConnectionSearch
            connections={props.connections}
            openIds={props.openIds}
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

/** The protected-connection marker (issue #666), shared by the explorer and the tabs. */
export function SafeBadge(props: { mode?: SafeMode }) {
  return (
    <Show when={props.mode}>
      {(mode) => {
        const label = () => t(mode() === "readOnly" ? "safe.badgeReadOnly" : "safe.badgeConfirm");
        return (
          <span class={`safe-badge safe-${mode()}`} title={label()} aria-label={label()}>
            <Icon name={mode() === "readOnly" ? "lock" : "warning"} size={12} />
          </span>
        );
      }}
    </Show>
  );
}
