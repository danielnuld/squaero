// App-global context-menu state (issue: adaptive right-click menu).
//
// The native WebView2/Chromium menu (Reload, Save as, Inspect…) is useless in
// the app, so we suppress it and render our own menu whose items depend on where
// the click landed. Any surface builds a list of MenuItem and calls
// openContextMenu(event, items); a single <ContextMenu> in App renders whatever
// is open. State lives at module scope because there is exactly one app instance
// and it saves prop-drilling a menu opener through every component.

import { createSignal, type JSX } from "solid-js";
import { isContextMenuKey } from "./listNav";

export interface MenuItem {
  /** Visible label. Omit for a separator. */
  label?: string;
  /**
   * Optional icon drawn before the label. Decorative: the row's accessible name
   * is the label, so an icon must not be part of it — which is also why this is a
   * component rather than a character glued onto the label string, as the tools
   * menu used to do with an emoji.
   */
  Icon?: () => JSX.Element;
  /** Invoked on click; the menu closes first, then this runs. */
  action?: () => void;
  /** Greyed out and non-interactive. */
  disabled?: boolean;
  /** Renders a divider instead of a clickable row. */
  separator?: boolean;
  /** Styles the item as a destructive action. */
  danger?: boolean;
  /** Dim text after the label, e.g. "3 hours ago" (issue #642). */
  hint?: string;
  /** Hover tooltip: the full text when the label is cut short. */
  title?: string;
  /**
   * Rows of a submenu opened beside this one (audit A-14). Such a row has no
   * action of its own. One level only: a submenu row's `submenu` is ignored.
   */
  submenu?: MenuItem[];
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

/**
 * Where a menu opened from the keyboard goes (issue #687): just inside the
 * focused element's bottom-left corner, as Windows places it — and never past
 * the window's edge when the element is taller than the screen (the grid, the
 * editor). Pure — the caller measures.
 */
export function keyboardMenuPoint(
  rect: { left: number; top: number; width: number; height: number },
  viewport: { width: number; height: number },
  inset = 8,
): { x: number; y: number } {
  const x = Math.max(0, Math.min(rect.left + inset, viewport.width - inset));
  const y = Math.max(rect.top, Math.min(rect.top + rect.height - inset, viewport.height - inset));
  return { x, y: Math.max(0, y) };
}

/**
 * Makes the Menu key and Shift+F10 open the same menu a right-click would, on
 * whatever has the focus (issue #687). Instead of teaching every surface a
 * second entry point, the key becomes a synthetic `contextmenu` event dispatched
 * on the focused element at `keyboardMenuPoint` — it bubbles through the very
 * `onContextMenu` handlers the mouse uses, items and all. The key event is
 * default-prevented so the browser does not also raise the native menu.
 * Returns the uninstaller.
 */
export function installContextMenuKey(doc: Document = document): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (!isContextMenuKey(e) || e.defaultPrevented) return;
    const el = doc.activeElement;
    if (!(el instanceof HTMLElement) || el === doc.body) return;
    e.preventDefault();
    const win = doc.defaultView ?? window;
    const p = keyboardMenuPoint(el.getBoundingClientRect(), {
      width: win.innerWidth,
      height: win.innerHeight,
    });
    el.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: p.x,
        clientY: p.y,
        button: 2,
      }),
    );
  };
  doc.addEventListener("keydown", onKey);
  return () => doc.removeEventListener("keydown", onKey);
}

/** A menu box to place: where it was asked for, how big it is, and the window. */
export interface ClampInput {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportW: number;
  viewportH: number;
  /** Gap kept from the window edges (default 4px). */
  margin?: number;
}

/**
 * Where to place a menu so its whole box stays inside the window: the requested
 * position, moved in when the box would stick out on the right or at the bottom,
 * and never past the top-left margin (a menu larger than the window is pinned
 * there rather than pushed off-screen). Pure — the caller measures. Issue #318.
 */
export function clampToViewport(i: ClampInput): { x: number; y: number } {
  const m = i.margin ?? 4;
  return {
    x: Math.max(m, Math.min(i.x, i.viewportW - i.width - m)),
    y: Math.max(m, Math.min(i.y, i.viewportH - i.height - m)),
  };
}
