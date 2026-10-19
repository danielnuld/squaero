import { For } from "solid-js";
import type { SideState, SidePanel } from "../utils/sidePanel";
import { t } from "../utils/i18n";
import { Icon, type IconName } from "./icons";

const PANELS: { id: SidePanel; icon: IconName; label: string; title: string }[] = [
  { id: "explorer", icon: "database", label: "rail.explorer", title: "rail.explorerTitle" },
  { id: "history", icon: "history", label: "rail.history", title: "rail.historyTitle" },
  { id: "snippets", icon: "bookmark", label: "rail.snippets", title: "rail.snippetsTitle" },
  { id: "search", icon: "search", label: "rail.search", title: "rail.searchTitle" },
];

// The labelled panel switcher on the window's left edge (issues #688, #689):
// what the side column shows on top, the saved connections and the settings
// at the bottom, with the notification history's bell above them (#693).
// Tools are not here: they live in the Herramientas menu and
// the Ctrl+K palette.
export function Rail(props: {
  side: SideState;
  onPick: (panel: SidePanel) => void;
  /** Panels that need a connection (the data search) are off without one. */
  connected: boolean;
  onConnections: () => void;
  onSettings: () => void;
  /** The notification history (issue #693): unread count, open state, toggle. */
  unread?: number;
  notesOpen?: boolean;
  onNotifications?: () => void;
}) {
  return (
    <nav class="rail" aria-label={t("rail.aria")}>
      <div class="rail-group" role="tablist" aria-orientation="vertical" aria-label={t("rail.panels")}>
        <For each={PANELS}>
          {(p) => {
            const on = () => props.side.panel === p.id && !props.side.collapsed;
            const disabled = () => p.id === "search" && !props.connected;
            return (
              <button
                class="rail-btn"
                classList={{ on: on() }}
                role="tab"
                aria-selected={on()}
                title={disabled() ? t("rail.needsConnection") : t(p.title)}
                disabled={disabled()}
                onClick={() => props.onPick(p.id)}
              >
                <Icon name={p.icon} size={18} />
                <span class="rail-lb">{t(p.label)}</span>
              </button>
            );
          }}
        </For>
      </div>
      <span class="rail-spacer" />
      <button
        class="rail-btn rail-bell"
        classList={{ on: !!props.notesOpen }}
        aria-expanded={!!props.notesOpen}
        title={
          props.unread
            ? t("rail.notificationsUnread", { n: props.unread })
            : t("rail.notificationsTitle")
        }
        onClick={() => props.onNotifications?.()}
      >
        <Icon name="bell" size={18} />
        <span class="rail-lb">{t("rail.notifications")}</span>
        {props.unread ? (
          <span class="rail-badge" aria-hidden="true">
            {props.unread > 9 ? "9+" : props.unread}
          </span>
        ) : null}
      </button>
      <button class="rail-btn" title={t("rail.connectionsTitle")} onClick={() => props.onConnections()}>
        <Icon name="plug" size={18} />
        <span class="rail-lb">{t("rail.connections")}</span>
      </button>
      <button class="rail-btn" title={t("rail.settingsTitle")} onClick={() => props.onSettings()}>
        <Icon name="settings" size={18} />
        <span class="rail-lb">{t("rail.settings")}</span>
      </button>
    </nav>
  );
}
