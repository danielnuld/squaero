// The native menu bar's model (issue #686). The shell (app/src/main.cc) binds
// `quaeroSetMenu(json)` on Windows and Linux and builds the OS menu from what
// the UI sends here — labels in the UI's language, the accelerators as text (the
// keys themselves stay the UI's: shortcuts.ts already handles them, so the
// shell binds none), and whether each item is enabled. A click comes back as a
// `quaero-menu` CustomEvent whose detail is the item id, which App runs through
// the same handler the command palette and the shortcuts use: an item id IS a
// catalog id — a shortcut ActionId, a palette `act:*`/`tool:*` id — except
// "quit", which the shell handles itself. macOS keeps its AppKit menu (no
// binding there), and a plain browser has none either.

import { SHORTCUTS, displayKeys, type ActionId } from "./shortcuts";
import { TOOL_CATALOG } from "./toolCatalog";

export interface MenuItem {
  id: string;
  label: string;
  /** Display text ("Ctrl+Shift+F", "⌘⇧F"); absent when the action has no key. */
  accel?: string;
  /** Absent means enabled. */
  enabled?: boolean;
}

export type MenuEntry = MenuItem | { separator: true };

export interface Menu {
  label: string;
  items: MenuEntry[];
}

/** What the enabled states depend on. */
export interface MenuState {
  connected: boolean;
  /** A database is selected (the object list needs one). */
  hasDb: boolean;
  hasTab: boolean;
  isMac: boolean;
}

/** The shell's own item: it closes the window, nothing reaches the page. */
export const QUIT_ACTION = "quit";

/** The event the shell dispatches on `window` with the clicked item's id. */
export const MENU_EVENT = "quaero-menu";

type Translate = (key: string) => string;

const SEP: MenuEntry = { separator: true };

/**
 * The seven menus, from the action catalog. Shortcut-backed items take their
 * label from the shortcut's own description (the help overlay's text) unless a
 * better one is named, and their accelerator from its keys; palette-only items
 * use the palette's label key.
 */
export function buildMenuModel(t: Translate, s: MenuState): Menu[] {
  const keysOf = new Map(SHORTCUTS.map((sc) => [sc.id, sc.keys]));
  const sc = (id: ActionId, labelKey = `sc.${id}`, enabled = true): MenuItem => {
    const keys = keysOf.get(id);
    const item: MenuItem = { id, label: t(labelKey) };
    if (keys) item.accel = displayKeys(keys, s.isMac);
    if (!enabled) item.enabled = false;
    return item;
  };
  const act = (id: string, labelKey: string, enabled = true): MenuItem =>
    enabled ? { id, label: t(labelKey) } : { id, label: t(labelKey), enabled: false };

  return [
    {
      label: t("menu.file"),
      items: [
        sc("new-tab", "toolbar.newQuery.title"),
        act("tool:connections", "tool.connections.label"),
        act("act:reconnect", "conn.reconnect", s.connected),
        SEP,
        sc("close-tab", "sc.close-tab", s.hasTab),
        SEP,
        act("act:settings", "common.settings"),
        SEP,
        { id: QUIT_ACTION, label: t("menu.quit") },
      ],
    },
    {
      label: t("menu.edit"),
      items: [
        sc("editor-find"),
        SEP,
        sc("save-edits"),
        sc("save-snippet"),
        SEP,
        sc("filter-add-condition", "sc.filter-add-condition", s.connected),
        sc("filter-add-sort", "sc.filter-add-sort", s.connected),
      ],
    },
    {
      label: t("menu.view"),
      items: [
        sc("refresh", "sc.refresh", s.connected),
        sc("toggle-theme"),
        SEP,
        act("act:objects", "toolbar.objects.title", s.connected && s.hasDb),
      ],
    },
    {
      label: t("menu.query"),
      items: [
        sc("run-query", "sc.run-query", s.connected),
        sc("format-sql"),
        SEP,
        act("act:newTable", "toolbar.newTable.title", s.connected),
      ],
    },
    {
      label: t("menu.tools"),
      items: TOOL_CATALOG.filter((tool) => tool.tool !== "connections").map((tool) =>
        act(`tool:${tool.tool}`, tool.label, s.connected),
      ),
    },
    {
      label: t("menu.window"),
      items: [
        sc("next-tab", "sc.next-tab", s.hasTab),
        sc("prev-tab", "sc.prev-tab", s.hasTab),
        SEP,
        sc("command-palette"),
        sc("object-palette", "sc.object-palette", s.connected),
        sc("snippet-palette"),
      ],
    },
    {
      label: t("menu.help"),
      items: [sc("toggle-help", "status.shortcuts")],
    },
  ];
}

interface ShellHost {
  quaeroSetMenu?: (json: string) => unknown;
}

/** True inside a shell that draws a native menu bar (Windows, Linux). */
export function hasShellMenu(): boolean {
  return typeof (globalThis as ShellHost).quaeroSetMenu === "function";
}

/** Send the model to the shell; `[]` takes the bar away. No-op without a shell. */
export function setShellMenu(model: Menu[]): void {
  (globalThis as ShellHost).quaeroSetMenu?.(JSON.stringify(model));
}

/**
 * Run `handler` with the item id of each native menu click. Returns the
 * uninstaller. Anything but a string detail is ignored.
 */
export function onShellMenu(target: EventTarget, handler: (id: string) => void): () => void {
  const listener = (e: Event) => {
    const id = (e as CustomEvent).detail;
    if (typeof id === "string" && id !== "") handler(id);
  };
  target.addEventListener(MENU_EVENT, listener);
  return () => target.removeEventListener(MENU_EVENT, listener);
}
