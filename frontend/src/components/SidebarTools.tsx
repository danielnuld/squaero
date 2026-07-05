import { For, Show } from "solid-js";
import { TOOL_CATALOG, type ToolMenuItem } from "../utils/toolCatalog";

// Collapsible "Herramientas" section of the sidebar (issue #176). Each tool is an
// icon + label button; the section header toggles a persisted collapsed state.
// Presentational and controlled: App owns the collapsed signal + persistence and
// handles opening a tool. Keyboard-accessible (real buttons, aria-expanded).
export function SidebarTools(props: {
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (item: ToolMenuItem) => void;
}) {
  return (
    <div class="sidebar-tools">
      <button
        class="sidebar-tools-header"
        aria-expanded={!props.collapsed}
        title={props.collapsed ? "Mostrar herramientas" : "Ocultar herramientas"}
        onClick={props.onToggle}
      >
        <span class="sidebar-tools-caret">{props.collapsed ? "▸" : "▾"}</span>
        Herramientas
      </button>
      <Show when={!props.collapsed}>
        <div class="sidebar-tools-list">
          <For each={TOOL_CATALOG}>
            {(item) => (
              <button
                class="tool-item"
                title={item.title}
                aria-label={item.label}
                onClick={() => props.onOpen(item)}
              >
                <span class="tool-item-icon" aria-hidden="true">
                  {item.icon}
                </span>
                <span class="tool-item-label">{item.label}</span>
              </button>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
