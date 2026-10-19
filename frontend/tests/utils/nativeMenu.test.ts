import { describe, it, expect, afterEach, vi } from "vitest";
import {
  EDIT_ACTIONS,
  MENU_EVENT,
  QUIT_ACTION,
  buildMenuModel,
  hasShellMenu,
  onShellMenu,
  setShellMenu,
  withAccessKeys,
  type Menu,
  type MenuItem,
  type MenuState,
} from "../../src/utils/nativeMenu";
import { APP_NAME } from "../../src/utils/shell";
import { SHORTCUTS } from "../../src/utils/shortcuts";
import { TOOL_CATALOG } from "../../src/utils/toolCatalog";

const host = globalThis as { quaeroSetMenu?: unknown };

afterEach(() => {
  delete host.quaeroSetMenu;
});

// Keys come back as themselves, so a label is its catalog key.
const t = (key: string) => key;

const ALL: MenuState = {
  connected: true,
  hasDb: true,
  hasTab: true,
  queryTab: true,
  canResume: true,
  isMac: false,
};
const NONE: MenuState = {
  connected: false,
  hasDb: false,
  hasTab: false,
  queryTab: false,
  canResume: false,
  isMac: false,
};
const MAC: MenuState = { ...ALL, isMac: true };

const items = (s: MenuState): MenuItem[] =>
  buildMenuModel(t, s)
    .flatMap((m) => m.items)
    .filter((e): e is MenuItem => !("separator" in e));

const ids = (m: Menu | undefined): string[] =>
  (m?.items ?? []).filter((e): e is MenuItem => !("separator" in e)).map((i) => i.id);
const menu = (s: MenuState, label: string) => buildMenuModel(t, s).find((m) => m.label === label);

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
      "act:saveSql",
      "act:resume",
      "act:about",
      "act:docs",
      "act:updates",
      "act:report",
      ...EDIT_ACTIONS,
      "mac:hide",
      "mac:hide-others",
      "mac:show-all",
      QUIT_ACTION,
    ]);
    for (const s of [ALL, MAC]) {
      const all = items(s).map((i) => i.id);
      expect(all.length).toBeGreaterThan(20);
      for (const id of all) expect(catalog.has(id), id).toBe(true);
      // No id twice: the shell maps a click back to exactly one action.
      expect(new Set(all).size).toBe(all.length);
    }
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
    // Save .sql is Ctrl+S on a query tab (#784), whatever it is rebound to.
    expect(items(ALL).find((i) => i.id === "act:saveSql")!.accel).toBe("Ctrl+S");
    const saveOnF9 = SHORTCUTS.map((sc) => (sc.id === "save-edits" ? { ...sc, keys: "F9" } : sc));
    expect(items({ ...ALL, shortcuts: saveOnF9 }).find((i) => i.id === "act:saveSql")!.accel).toBe("F9");
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
    for (const id of [
      "new-tab",
      "tool:connections",
      "open-file",
      "act:settings",
      "toggle-help",
      "act:docs",
      "act:updates",
      "act:report",
      "act:about",
      ...EDIT_ACTIONS,
      QUIT_ACTION,
    ])
      expect(enabled(id), id).toBe(true);
    // Saving .sql needs a query tab; resuming, a session left to resume.
    expect(enabled("act:saveSql")).toBe(false);
    expect(enabled("act:resume")).toBe(false);
    const toolTab = items({ ...ALL, queryTab: false, canResume: false });
    expect(toolTab.find((i) => i.id === "act:saveSql")!.enabled).toBe(false);
    expect(toolTab.find((i) => i.id === "act:resume")!.enabled).toBe(false);

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

describe("buildMenuModel — the standard menus (A-11)", () => {
  it("opens Edit with the standard commands, with each platform's keys", () => {
    expect(ids(menu(ALL, "menu.edit")).slice(0, 6)).toEqual([...EDIT_ACTIONS]);
    const accel = (s: MenuState, id: string) => items(s).find((i) => i.id === id)!.accel;
    expect(accel(ALL, "edit:undo")).toBe("Ctrl+Z");
    expect(accel(ALL, "edit:redo")).toBe("Ctrl+Y");
    expect(accel(ALL, "edit:paste")).toBe("Ctrl+V");
    expect(accel(MAC, "edit:undo")).toBe("⌘Z");
    expect(accel(MAC, "edit:redo")).toBe("⇧⌘Z");
    expect(accel(MAC, "edit:select-all")).toBe("⌘A");
  });

  it("gives File open/save .sql and resume, and Help its documentation, updates, report", () => {
    const file = ids(menu(ALL, "menu.file"));
    for (const id of ["open-file", "act:saveSql", "act:resume", "act:disconnect", "reopen-tab", "close-all-tabs"])
      expect(file, id).toContain(id);
    expect(ids(menu(ALL, "menu.help"))).toEqual([
      "toggle-help",
      "act:docs",
      "act:updates",
      "act:report",
      "act:about",
    ]);
  });

  it("closes File with Settings and Exit, and Help with About, off a Mac", () => {
    expect(ids(menu(ALL, "menu.file")).slice(-2)).toEqual(["act:settings", QUIT_ACTION]);
    expect(buildMenuModel(t, ALL)[0].label).toBe("menu.file");
  });

  it("puts About, Settings, Hide and Quit in a Mac's app menu, first", () => {
    const model = buildMenuModel(t, MAC);
    expect(model[0].label).toBe(APP_NAME);
    expect(ids(model[0])).toEqual([
      "act:about",
      "act:settings",
      "mac:hide",
      "mac:hide-others",
      "mac:show-all",
      QUIT_ACTION,
    ]);
    expect(model[0].items.find((i) => (i as MenuItem).id === QUIT_ACTION)).toEqual({
      id: QUIT_ACTION,
      label: "menu.quitMac",
    });
    // …and nowhere else.
    expect(ids(menu(MAC, "menu.file"))).not.toContain("act:settings");
    expect(ids(menu(MAC, "menu.file"))).not.toContain(QUIT_ACTION);
    expect(ids(menu(MAC, "menu.help"))).not.toContain("act:about");
    expect(model.slice(1).map((m) => m.label)).toEqual(buildMenuModel(t, ALL).map((m) => m.label));
  });
});

describe("withAccessKeys (R-41)", () => {
  const es: Menu[] = ["Archivo", "Editar", "Ver", "Consulta", "Herramientas", "Ventana", "Ayuda"].map(
    (label) => ({ label, items: [] }),
  );

  it("marks the menu titles with Win32's & and GTK's _", () => {
    expect(withAccessKeys(es, "windows").map((m) => m.label)).toEqual([
      "&Archivo",
      "&Editar",
      "&Ver",
      "&Consulta",
      "&Herramientas",
      "Ve&ntana",
      "A&yuda",
    ]);
    expect(withAccessKeys(es, "linux").map((m) => m.label)).toEqual([
      "_Archivo",
      "_Editar",
      "_Ver",
      "_Consulta",
      "_Herramientas",
      "Ve_ntana",
      "A_yuda",
    ]);
  });

  it("picks each menu's item keys on their own, past separators, keeping the rest", () => {
    const file: Menu = {
      label: "Archivo",
      items: [
        { id: "new-tab", label: "Nueva consulta", accel: "Ctrl+T" },
        { separator: true },
        { id: "act:openSql", label: "Abrir .sql" },
        { id: "act:saveSql", label: "Guardar .sql", enabled: false },
        { id: "act:resume", label: "Abrir otra vez" },
      ],
    };
    const [out] = withAccessKeys([file], "windows");
    expect(out.label).toBe("&Archivo");
    expect(out.items).toEqual([
      { id: "new-tab", label: "&Nueva consulta", accel: "Ctrl+T" },
      { separator: true },
      { id: "act:openSql", label: "&Abrir .sql" },
      { id: "act:saveSql", label: "&Guardar .sql", enabled: false },
      { id: "act:resume", label: "A&brir otra vez" },
    ]);
    // The model it was given is left alone (the app's own bar draws it).
    expect((file.items[0] as MenuItem).label).toBe("Nueva consulta");
  });

  it("doubles a literal marker so it stays a character", () => {
    const m: Menu[] = [{ label: "R&D", items: [{ id: "a", label: "snake_case & co" }] }];
    expect(withAccessKeys(m, "windows")[0]).toEqual({
      label: "&R&&D",
      items: [{ id: "a", label: "&snake_case && co" }],
    });
    expect(withAccessKeys(m, "linux")[0]).toEqual({
      label: "_R&D",
      items: [{ id: "a", label: "_snake__case & co" }],
    });
  });

  it("leaves a label with no free letter unmarked", () => {
    const m: Menu[] = [
      { label: "Ab", items: [] },
      { label: "ba", items: [] },
      { label: "…", items: [] },
    ];
    expect(withAccessKeys(m, "windows").map((x) => x.label)).toEqual(["&Ab", "&ba", "…"]);
  });

  it("sends a Mac's model unmarked: AppKit has no access keys", () => {
    const model = buildMenuModel(t, MAC);
    expect(withAccessKeys(model, "macos")).toEqual(model);
  });

  it("marks every title and item of the real model once", () => {
    for (const m of withAccessKeys(buildMenuModel(t, ALL), "windows")) {
      expect(m.label).toMatch(/^[^&]*&[^&]/);
      for (const e of m.items) if (!("separator" in e)) expect(e.label, e.id).toMatch(/^[^&]*&[^&]/);
    }
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
