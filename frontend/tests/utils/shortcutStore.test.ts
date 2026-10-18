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
