import { describe, it, expect, beforeEach, vi } from "vitest";

const KEY = "quaero.shortcuts";

// shortcutStore captures its backing store at import time, so reset the module
// registry and re-import after arranging localStorage.
async function freshModule() {
  return import("../../src/utils/shortcutStore");
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe("shortcutStore", () => {
  it("has no overrides when nothing is stored", async () => {
    const { loadShortcutOverrides } = await freshModule();
    expect(loadShortcutOverrides()).toEqual({});
  });

  it("persists and reloads the overrides", async () => {
    const { loadShortcutOverrides, saveShortcutOverrides } = await freshModule();
    saveShortcutOverrides({ refresh: "Mod+R" });
    expect(localStorage.getItem(KEY)).toBe('{"refresh":"Mod+R"}');
    expect(loadShortcutOverrides()).toEqual({ refresh: "Mod+R" });
  });

  it("has no overrides for a corrupt blob", async () => {
    localStorage.setItem(KEY, "{broken");
    const { loadShortcutOverrides } = await freshModule();
    expect(loadShortcutOverrides()).toEqual({});
  });
});

describe("shortcutStore — migration (R-17)", () => {
  it("migrates a version-1 map once and records the version", async () => {
    // Version 1: no version key. The user had put the help on Ctrl+Shift+H.
    localStorage.setItem(KEY, '{"toggle-help":"Mod+Shift+H"}');
    const { loadShortcutOverrides } = await freshModule();
    expect(loadShortcutOverrides()).toEqual({ "toggle-help": "Mod+Shift+H", "toggle-history": "" });
    expect(localStorage.getItem("quaero.shortcuts.version")).toBe("2");
    expect(JSON.parse(localStorage.getItem(KEY)!)).toEqual({ "toggle-help": "Mod+Shift+H", "toggle-history": "" });
  });

  it("leaves a current map as it is", async () => {
    localStorage.setItem(KEY, '{"toggle-help":"Mod+Shift+H"}');
    localStorage.setItem("quaero.shortcuts.version", "2");
    const { loadShortcutOverrides } = await freshModule();
    expect(loadShortcutOverrides()).toEqual({ "toggle-help": "Mod+Shift+H" });
  });
});
