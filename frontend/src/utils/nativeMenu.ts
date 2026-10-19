// The native menu bar's model (issue #686). The shell (app/src/main.cc) binds
// `quaeroSetMenu(json)` on Windows, Linux and macOS and builds the OS menu from what
// the UI sends here — labels in the UI's language, the accelerators as text (the
// keys themselves stay the UI's: shortcuts.ts already handles them, so the
// shell binds none), and whether each item is enabled. A click comes back as a
// `quaero-menu` CustomEvent whose detail is the item id, which App runs through
// the same handler the command palette and the shortcuts use: an item id IS a
// catalog id — a shortcut ActionId, a palette `act:*`/`tool:*` id — except
// "quit", the "edit:*" commands and macOS's "mac:*", which the shell runs
// itself. macOS builds its AppKit bar from the same model (app menu first); a
// plain browser has none.

import { APP_NAME } from "./shell";
import { SHORTCUTS, formatKeys, type ActionId, type Shortcut } from "./shortcuts";
import { accessKeys, type Os } from "./titleBar";
import { TOOL_CATALOG, toolUnsupported } from "./toolCatalog";

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
  /** The active tab is a query tab (Guardar .sql saves its text). */
  queryTab: boolean;
  /** A previous session is waiting to be resumed (Retomar). */
  canResume: boolean;
  isMac: boolean;
  /** The focused connection's driver: a tool it cannot run is disabled (A-18). */
  engine?: string;
  /** The shortcuts in force (the user's rebound keys); the defaults when absent. */
  shortcuts?: readonly Shortcut[];
}

/** The shell's own item: it closes the window, nothing reaches the page. */
export const QUIT_ACTION = "quit";

/**
 * The standard Edit commands (A-11). The shell runs them on whatever has the
 * focus in the page (app/include/menu_model.h): a click delivered to the page
 * would land after the focus left the field it was meant for.
 */
export const EDIT_ACTIONS = [
  "edit:undo",
  "edit:redo",
  "edit:cut",
  "edit:copy",
  "edit:paste",
  "edit:select-all",
] as const;

/** The event the shell dispatches on `window` with the clicked item's id. */
export const MENU_EVENT = "quaero-menu";

type Translate = (key: string) => string;

const SEP: MenuEntry = { separator: true };

const isItem = (e: MenuEntry): e is MenuItem => !("separator" in e);

/**
 * The menus, from the action catalog. Shortcut-backed items take their label
 * from the shortcut's own description (the help overlay's text) unless a
 * better one is named, and their accelerator from its keys; palette-only items
 * use the palette's label key. macOS gets its app menu first (About, Settings,
 * Hide, Quit — where a Mac looks for them, A-11) and the File and Help menus
 * without those; elsewhere Settings and Exit close File and About closes Help.
 */
export function buildMenuModel(t: Translate, s: MenuState): Menu[] {
  const keysOf = new Map<string, string>((s.shortcuts ?? SHORTCUTS).map((sc) => [sc.id, sc.keys]));
  const fmt = (keys: string | undefined) => formatKeys(keys ?? "", s.isMac ? "macos" : "windows", t);
  const keyed = (item: MenuItem, keys: string | undefined, enabled: boolean): MenuItem => {
    if (fmt(keys)) item.accel = fmt(keys);
    if (!enabled) item.enabled = false;
    return item;
  };
  const sc = (id: ActionId, labelKey = `sc.${id}`, enabled = true): MenuItem =>
    keyed({ id, label: t(labelKey) }, keysOf.get(id), enabled);
  /** A palette action; `shortcut` lends it the keys of the shortcut that does the same. */
  const act = (id: string, labelKey: string, enabled = true, shortcut?: ActionId): MenuItem =>
    keyed({ id, label: t(labelKey) }, shortcut && keysOf.get(shortcut), enabled);
  const edit = (id: (typeof EDIT_ACTIONS)[number], labelKey: string, keys: string): MenuItem =>
    keyed({ id, label: t(labelKey) }, keys, true);
  const settings = act("act:settings", "common.settings", true, "open-settings");
  const about = act("act:about", "menu.about");

  const appMenu: Menu[] = s.isMac
    ? [
        {
          label: APP_NAME,
          items: [
            about,
            SEP,
            settings,
            SEP,
            act("mac:hide", "menu.hide"),
            act("mac:hide-others", "menu.hideOthers"),
            act("mac:show-all", "menu.showAll"),
            SEP,
            { id: QUIT_ACTION, label: t("menu.quitMac") },
          ],
        },
      ]
    : [];

  return [
    ...appMenu,
    {
      label: t("menu.file"),
      items: [
        sc("new-tab", "toolbar.newQuery.title"),
        act("tool:connections", "tool.connections.label"),
        SEP,
        sc("open-file"),
        // Ctrl+S saves the .sql on a query tab (#784): the same key.
        act("act:saveSql", "editor.saveFile", s.queryTab, "save-edits"),
        SEP,
        act("act:resume", "menu.resume", s.canResume),
        act("act:reconnect", "conn.reconnect", s.connected),
        act("act:disconnect", "conn.disconnect", s.connected),
        SEP,
        sc("close-tab", "sc.close-tab", s.hasTab),
        sc("close-all-tabs", "sc.close-all-tabs", s.hasTab),
        sc("reopen-tab"),
        ...(s.isMac ? [] : [SEP, settings, SEP, { id: QUIT_ACTION, label: t("menu.quit") }]),
      ],
    },
    {
      label: t("menu.edit"),
      items: [
        edit("edit:undo", "menu.undo", "Mod+Z"),
        edit("edit:redo", "menu.redo", s.isMac ? "Mod+Shift+Z" : "Mod+Y"),
        SEP,
        edit("edit:cut", "menu.cut", "Mod+X"),
        edit("edit:copy", "menu.copy", "Mod+C"),
        edit("edit:paste", "menu.paste", "Mod+V"),
        edit("edit:select-all", "menu.selectAll", "Mod+A"),
        SEP,
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
        sc("toggle-sidebar"),
        sc("focus-explorer"),
        sc("toggle-history"),
        SEP,
        act("act:objects", "toolbar.objects.title", s.connected && s.hasDb),
      ],
    },
    {
      label: t("menu.query"),
      items: [
        sc("run-query", "sc.run-query", s.connected),
        sc("run-script", "sc.run-script", s.connected),
        sc("explain", "sc.explain", s.connected),
        sc("format-sql"),
        SEP,
        act("act:newTable", "toolbar.newTable.title", s.connected),
      ],
    },
    {
      label: t("menu.tools"),
      items: TOOL_CATALOG.filter((tool) => tool.tool !== "connections").map((tool) =>
        act(`tool:${tool.tool}`, tool.label, s.connected && !toolUnsupported(tool, s.engine)),
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
      items: [
        sc("toggle-help", "status.shortcuts"),
        act("act:docs", "menu.docs"),
        SEP,
        act("act:updates", "menu.updates"),
        act("act:report", "menu.report"),
        ...(s.isMac ? [] : [SEP, about]),
      ],
    },
  ];
}

/**
 * The model with each label's access key marked the toolkit's way (R-41):
 * "&Archivo" for Win32, "_Archivo" for GTK, a literal marker doubled so it
 * stays a character. The menu titles share one set of letters and each
 * menu's items another, picked as accessKeys picks them for the app's own
 * bar. macOS has no access keys: its model goes out unmarked.
 */
export function withAccessKeys(model: Menu[], os: Os): Menu[] {
  if (os === "macos") return model;
  const mark = os === "windows" ? "&" : "_";
  const escape = (text: string) => text.split(mark).join(mark + mark);
  const marked = (labels: string[]): string[] => {
    const keys = accessKeys(labels);
    return labels.map((label, i) =>
      keys[i] < 0
        ? escape(label)
        : escape(label.slice(0, keys[i])) + mark + escape(label.slice(keys[i])),
    );
  };
  const tops = marked(model.map((m) => m.label));
  return model.map((menu, i) => {
    const labels = marked(menu.items.filter(isItem).map((it) => it.label));
    let n = 0;
    return {
      label: tops[i],
      items: menu.items.map((e) => (isItem(e) ? { ...e, label: labels[n++] } : e)),
    };
  });
}

interface ShellHost {
  quaeroSetMenu?: (json: string) => unknown;
}

/** True inside a shell that draws a native menu bar (Windows, Linux, macOS). */
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
