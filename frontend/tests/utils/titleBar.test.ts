import { describe, it, expect, vi, afterEach } from "vitest";
import {
  WINDOW_EVENT,
  accessKeys,
  detectOs,
  hasWindowBinding,
  menuForKey,
  onWindowEvent,
  parseWindowState,
  titleBarLayout,
  windowCommand,
  type WindowState,
} from "../../src/utils/titleBar";

const host = globalThis as { quaeroWindow?: unknown };

afterEach(() => {
  delete host.quaeroWindow;
});

const WIN: WindowState = { os: "windows", frameless: true, maximized: false, backdrop: "mica" };

describe("detectOs", () => {
  it("names the three desktop systems from platform or user-agent text", () => {
    expect(detectOs("Win32")).toBe("windows");
    expect(detectOs("MacIntel")).toBe("macos");
    expect(detectOs("Linux x86_64")).toBe("linux");
    expect(detectOs("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("windows");
  });

  it("falls back to Linux for anything unknown or empty", () => {
    expect(detectOs("")).toBe("linux");
    expect(detectOs("FreeBSD amd64")).toBe("linux");
  });
});

describe("parseWindowState", () => {
  it("takes the shell's state as an object or as its JSON text", () => {
    expect(parseWindowState(WIN)).toEqual(WIN);
    expect(parseWindowState(JSON.stringify(WIN))).toEqual(WIN);
  });

  it("reads an unknown backdrop as none", () => {
    expect(parseWindowState({ ...WIN, backdrop: "acrylic" })?.backdrop).toBe("none");
    expect(parseWindowState({ os: "macos", frameless: false, maximized: true })?.backdrop).toBe("none");
  });

  it("refuses anything that is not a state", () => {
    expect(parseWindowState(null)).toBeNull();
    expect(parseWindowState("not json")).toBeNull();
    expect(parseWindowState({ ...WIN, os: "beos" })).toBeNull();
    expect(parseWindowState({ ...WIN, frameless: "yes" })).toBeNull();
    expect(parseWindowState({ os: "windows", frameless: true })).toBeNull();
    expect(parseWindowState(42)).toBeNull();
  });
});

describe("titleBarLayout", () => {
  it("Windows with its own bar: menu, window buttons, draggable", () => {
    expect(titleBarLayout("windows", WIN, true)).toEqual({
      os: "windows",
      menu: true,
      windowButtons: true,
      trafficLights: false,
      draggable: true,
    });
  });

  it("Windows with the menu setting off keeps the window buttons only", () => {
    const l = titleBarLayout("windows", WIN, false);
    expect(l.menu).toBe(false);
    expect(l.windowButtons).toBe(true);
  });

  it("macOS with its own bar leaves room for the traffic lights, no menu", () => {
    const l = titleBarLayout("macos", { ...WIN, os: "macos" }, true);
    expect(l).toMatchObject({ menu: false, windowButtons: false, trafficLights: true, draggable: true });
  });

  it("the system frame (fallback, Linux, browser) draws an in-app bar only", () => {
    const off = { menu: false, windowButtons: false, trafficLights: false, draggable: false };
    expect(titleBarLayout("windows", { ...WIN, frameless: false }, true)).toMatchObject(off);
    expect(titleBarLayout("linux", null, true)).toMatchObject(off);
    expect(titleBarLayout("macos", null, true)).toMatchObject(off);
  });
});

describe("accessKeys", () => {
  it("gives each menu its first letter not taken, as Windows does", () => {
    const es = ["Archivo", "Editar", "Ver", "Consulta", "Herramientas", "Ventana", "Ayuda"];
    const keys = accessKeys(es);
    expect(keys.map((k, i) => es[i][k])).toEqual(["A", "E", "V", "C", "H", "n", "y"]);
    const en = ["File", "Edit", "View", "Query", "Tools", "Window", "Help"];
    expect(accessKeys(en).map((k, i) => en[i][k])).toEqual(["F", "E", "V", "Q", "T", "W", "H"]);
  });

  it("is case-insensitive, skips spaces and symbols, and gives up with -1", () => {
    expect(accessKeys(["ab", "Ab", "a b"])).toEqual([0, 1, -1]);
    expect(accessKeys(["", "…"])).toEqual([-1, -1]);
    expect(accessKeys(["Éxito", "éter"])).toEqual([0, 1]);
  });
});

describe("menuForKey", () => {
  it("finds the menu whose access key was pressed, any case", () => {
    const labels = ["Archivo", "Editar", "Ayuda"];
    const keys = accessKeys(labels);
    expect(menuForKey(labels, keys, "a")).toBe(0);
    expect(menuForKey(labels, keys, "E")).toBe(1);
    expect(menuForKey(labels, keys, "y")).toBe(2);
    expect(menuForKey(labels, keys, "z")).toBe(-1);
    expect(menuForKey(["…"], [-1], "…")).toBe(-1);
  });
});

describe("the quaeroWindow binding", () => {
  it("is absent outside the shell: no binding, commands resolve to null", async () => {
    expect(hasWindowBinding()).toBe(false);
    await expect(windowCommand("state")).resolves.toBeNull();
  });

  it("sends the command with its arguments and returns the state", async () => {
    const fn = vi.fn().mockResolvedValue(WIN);
    host.quaeroWindow = fn;
    expect(hasWindowBinding()).toBe(true);
    await expect(windowCommand("snap", 1, 2, 3, 4)).resolves.toEqual(WIN);
    expect(fn).toHaveBeenCalledWith("snap", 1, 2, 3, 4);
  });

  it("turns a refused command into null", async () => {
    host.quaeroWindow = vi.fn().mockRejectedValue("unknown window command");
    await expect(windowCommand("fly")).resolves.toBeNull();
  });

  it("routes the shell's events: states and the maximize button's hover", () => {
    const target = new EventTarget();
    const onState = vi.fn();
    const onHover = vi.fn();
    const off = onWindowEvent(target, onState, onHover);
    target.dispatchEvent(new CustomEvent(WINDOW_EVENT, { detail: { ...WIN, maximized: true } }));
    target.dispatchEvent(new CustomEvent(WINDOW_EVENT, { detail: { maxHover: true } }));
    target.dispatchEvent(new CustomEvent(WINDOW_EVENT, { detail: "junk" }));
    expect(onState).toHaveBeenCalledWith({ ...WIN, maximized: true });
    expect(onHover).toHaveBeenCalledWith(true);
    expect(onState).toHaveBeenCalledTimes(1);
    off();
    target.dispatchEvent(new CustomEvent(WINDOW_EVENT, { detail: { maxHover: false } }));
    expect(onHover).toHaveBeenCalledTimes(1);
  });
});
