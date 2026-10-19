import { describe, it, expect, afterEach, vi } from "vitest";
import {
  MENU_EVENT,
  QUIT_ACTION,
  buildMenuModel,
  hasShellMenu,
  onShellMenu,
  setShellMenu,
  type MenuItem,
  type MenuState,
} from "../../src/utils/nativeMenu";
import { SHORTCUTS } from "../../src/utils/shortcuts";
import { TOOL_CATALOG } from "../../src/utils/toolCatalog";

const host = globalThis as { quaeroSetMenu?: unknown };

afterEach(() => {
  delete host.quaeroSetMenu;
});

// Keys come back as themselves, so a label is its catalog key.
const t = (key: string) => key;

const ALL: MenuState = { connected: true, hasDb: true, hasTab: true, isMac: false };
const NONE: MenuState = { connected: false, hasDb: false, hasTab: false, isMac: false };

const items = (s: MenuState): MenuItem[] =>
  buildMenuModel(t, s)
    .flatMap((m) => m.items)
    .filter((e): e is MenuItem => !("separator" in e));

describe("buildMenuModel", () => {
  it("has the seven menus, in order, labelled through i18n", () => {
    expect(buildMenuModel(t, ALL).map((m) => m.label)).toEqual([
      "menu.file",
      "menu.edit",
      "menu.view",
      "menu.query",
      "menu.tools",
      "menu.window",
      "menu.help",
    ]);
  });

  it("binds every item to the action catalog — a shortcut, a palette action or a tool", () => {
    const catalog = new Set<string>([
      ...SHORTCUTS.map((sc) => sc.id),
      ...TOOL_CATALOG.map((tool) => `tool:${tool.tool}`),
      "act:reconnect",
      "act:disconnect",
      "act:settings",
      "act:objects",
      "act:newTable",
      QUIT_ACTION,
    ]);
    const ids = items(ALL).map((i) => i.id);
    expect(ids.length).toBeGreaterThan(20);
    for (const id of ids) expect(catalog.has(id), id).toBe(true);
    // No id twice: the shell maps a click back to exactly one action.
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shows each shortcut's keys in the platform's spelling", () => {
    // The menu's translator names the keys too (here it echoes the catalog key).
    const run = items(ALL).find((i) => i.id === "run-query")!;
    expect(run.accel).toBe("Ctrl+key.enter");
    expect(items({ ...ALL, isMac: true }).find((i) => i.id === "run-query")!.accel).toBe("⌘↩");
    expect(items(ALL).find((i) => i.id === "refresh")!.accel).toBe("F5");
    // The script and the plan are the editor's keys too (issue #691).
    expect(items(ALL).find((i) => i.id === "run-script")!.accel).toBe("Ctrl+key.shift+key.enter");
    expect(items(ALL).find((i) => i.id === "explain")!.accel).toBe("Ctrl+key.shift+E");
    // A palette action lends the keys of its shortcut (Ctrl+,); the theme has none.
    expect(items(ALL).find((i) => i.id === "act:settings")!.accel).toBe("Ctrl+,");
    expect(items(ALL).find((i) => i.id === "toggle-theme")!.accel).toBeUndefined();
  });

  it("shows the keys in force, not the defaults", () => {
    const shortcuts = SHORTCUTS.map((sc) => (sc.id === "refresh" ? { ...sc, keys: "Mod+R" } : sc));
    expect(items({ ...ALL, shortcuts }).find((i) => i.id === "refresh")!.accel).toBe("Ctrl+R");
  });

  it("disables what needs a connection, a database or a tab", () => {
    const off = items(NONE);
    const enabled = (id: string) => off.find((i) => i.id === id)!.enabled !== false;
    expect(enabled("act:reconnect")).toBe(false);
    expect(enabled("act:disconnect")).toBe(false);
    expect(enabled("run-query")).toBe(false);
    expect(enabled("run-script")).toBe(false);
    expect(enabled("tool:monitor")).toBe(false);
    expect(enabled("act:objects")).toBe(false);
    expect(enabled("close-tab")).toBe(false);
    expect(enabled("next-tab")).toBe(false);
    // Always there: a new query, the connections, settings, help, quit.
    for (const id of ["new-tab", "tool:connections", "act:settings", "toggle-help", QUIT_ACTION])
      expect(enabled(id), id).toBe(true);

    // Connected to a server with no database picked: everything but the object list.
    const noDb = items({ ...ALL, hasDb: false });
    expect(noDb.find((i) => i.id === "act:objects")!.enabled).toBe(false);
    expect(noDb.find((i) => i.id === "tool:monitor")!.enabled).toBeUndefined();

    // Everything on: the `enabled` key is simply absent.
    for (const i of items(ALL)) expect(i.enabled, i.id).toBeUndefined();
  });

  it("disables the tools the connected engine cannot run (audit A-18)", () => {
    const sqlite = items({ ...ALL, engine: "sqlite" });
    const on = (id: string) => sqlite.find((i) => i.id === id)!.enabled !== false;
    expect(on("tool:monitor")).toBe(false);
    expect(on("tool:users")).toBe(false);
    expect(on("tool:routines")).toBe(false);
    expect(on("tool:erDiagram")).toBe(true);
    expect(on("tool:triggers")).toBe(true);
    // MySQL runs them all.
    for (const i of items({ ...ALL, engine: "mysql" })) expect(i.enabled, i.id).toBeUndefined();
  });

  it("puts the tools under Tools, except the connections which open from File", () => {
    const tools = buildMenuModel(t, ALL).find((m) => m.label === "menu.tools")!;
    expect(tools.items.map((i) => (i as MenuItem).id)).toEqual(
      TOOL_CATALOG.filter((tool) => tool.tool !== "connections").map((tool) => `tool:${tool.tool}`),
    );
    const file = buildMenuModel(t, ALL).find((m) => m.label === "menu.file")!;
    expect(file.items.some((i) => (i as MenuItem).id === "tool:connections")).toBe(true);
    expect((file.items[file.items.length - 1] as MenuItem).id).toBe(QUIT_ACTION);
  });
});

describe("the shell binding", () => {
  it("is absent in a plain browser, so nothing is sent", () => {
    expect(hasShellMenu()).toBe(false);
    expect(() => setShellMenu(buildMenuModel(t, ALL))).not.toThrow();
  });

  it("sends the model as JSON, and [] to hide the bar", () => {
    const native = vi.fn();
    host.quaeroSetMenu = native;
    expect(hasShellMenu()).toBe(true);
    const model = buildMenuModel(t, ALL);
    setShellMenu(model);
    expect(native).toHaveBeenCalledWith(JSON.stringify(model));
    expect(JSON.parse(native.mock.calls[0][0])).toEqual(model);
    setShellMenu([]);
    expect(native).toHaveBeenLastCalledWith("[]");
  });
});

describe("onShellMenu", () => {
  it("hands the clicked id to the handler and uninstalls", () => {
    const target = new EventTarget();
    const handler = vi.fn();
    const off = onShellMenu(target, handler);
    target.dispatchEvent(new CustomEvent(MENU_EVENT, { detail: "run-query" }));
    expect(handler).toHaveBeenCalledWith("run-query");
    // Not a string, or empty: ignored.
    target.dispatchEvent(new CustomEvent(MENU_EVENT, { detail: 7 }));
    target.dispatchEvent(new CustomEvent(MENU_EVENT, { detail: "" }));
    target.dispatchEvent(new Event(MENU_EVENT));
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    target.dispatchEvent(new CustomEvent(MENU_EVENT, { detail: "refresh" }));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
