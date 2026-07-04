// App-global context-menu state (issue: adaptive right-click menu).
//
// The native WebView2/Chromium menu (Reload, Save as, Inspect…) is useless in
// the app, so we suppress it and render our own menu whose items depend on where
// the click landed. Any surface builds a list of MenuItem and calls
// openContextMenu(event, items); a single <ContextMenu> in App renders whatever
// is open. State lives at module scope because there is exactly one app instance
// and it saves prop-drilling a menu opener through every component.

import { createSignal } from "solid-js";

export interface MenuItem {
  /** Visible label. Omit for a separator. */
  label?: string;
  /** Invoked on click; the menu closes first, then this runs. */
  action?: () => void;
  /** Greyed out and non-interactive. */
  disabled?: boolean;
  /** Renders a divider instead of a clickable row. */
  separator?: boolean;
  /** Styles the item as a destructive action. */
  danger?: boolean;
}

export interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

const [menu, setMenu] = createSignal<MenuState | null>(null);

/** The currently open menu, or null. Read by the <ContextMenu> renderer. */
export const contextMenu = menu;

/**
 * Opens a context menu at the event's position with the given items. Prevents
 * the native menu and stops the event from bubbling to the document-level
 * suppressor (which would immediately close it). A menu with no items is not
 * opened (the native menu is still suppressed by the caller's preventDefault).
 */
export function openContextMenu(e: MouseEvent, items: MenuItem[]): void {
  e.preventDefault();
  e.stopPropagation();
  if (items.length === 0) {
    setMenu(null);
    return;
  }
  setMenu({ x: e.clientX, y: e.clientY, items });
}

/** Closes any open context menu. */
export function closeContextMenu(): void {
  setMenu(null);
}
