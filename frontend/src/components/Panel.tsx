import { Show, onCleanup, onMount, type JSX } from "solid-js";
import { IconRefresh } from "./icons";
import { t } from "../utils/i18n";

// Inline workspace panel (UX refactor: tools open as tabs in the same window
// instead of modals). A Panel fills the workspace area below the tab bar; the tab
// itself carries the title and the close (✕), so a Panel is just a labelled,
// scrollable region. Escape still closes it via onClose. `title` becomes the
// accessible name; `wide` is accepted for call-site compatibility and ignored
// (panels are always full width). Replaces the old centered Modal + backdrop.
//
// It also owns the bar every tool used to build for itself (issue #372). Twelve
// panels each hand-rolled a header, and it showed: seven repeated the title the
// tab already displays, seven repeated a "Cerrar" next to the tab's own ✕, and
// the three that skipped the bar looked like a different product. The tool now
// hands over WHAT goes in the bar — its actions and its status — and the bar
// itself is the same everywhere.
export function Panel(props: {
  title?: string;
  onClose?: () => void;
  /** Accepted for compatibility with former Modal call sites; panels fill the area. */
  wide?: boolean;
  /** Extra class (component-specific layout hook, e.g. "user-mgr"). */
  class?: string;
  /** The tool's own actions, at the start of the bar. */
  actions?: JSX.Element;
  /** Counts and freshness, at the end of the bar, before Refresh. */
  status?: JSX.Element;
  /** Given, the bar ends with the refresh button. */
  onRefresh?: () => void;
  /** Disables refresh and labels it as running. */
  refreshing?: boolean;
  children: JSX.Element;
}) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose?.();
  };
  onMount(() => document.addEventListener("keydown", onKey));
  onCleanup(() => document.removeEventListener("keydown", onKey));

  const hasBar = () => !!props.actions || !!props.status || !!props.onRefresh;

  return (
    <div class={`tool-pane ${props.class ?? ""}`} role="region" aria-label={props.title}>
      <Show when={hasBar()}>
        <div class="panel-bar">
          {props.actions}
          <span class="panel-bar-spacer" />
          <Show when={props.status}>
            <span class="panel-status">{props.status}</span>
          </Show>
          <Show when={props.onRefresh}>
            <button
              class="panel-icon-btn"
              type="button"
              disabled={props.refreshing}
              /* Icon only, so the bar stays quiet; the name lives in the tooltip
                 and in the accessible name, never in the glyph alone. */
              title={props.refreshing ? t("panel.refreshing") : t("panel.refresh")}
              aria-label={props.refreshing ? t("panel.refreshing") : t("panel.refresh")}
              onClick={() => props.onRefresh?.()}
            >
              <IconRefresh />
            </button>
          </Show>
        </div>
      </Show>
      {props.children}
    </div>
  );
}
