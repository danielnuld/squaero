import { describe, it, expect, beforeEach, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings } from "../../src/utils/settings";

const KEY = "quaero.settings";

// settingsStore captures its backing store at import time, so reset the module
// registry and re-import after arranging localStorage.
async function freshModule() {
  return import("../../src/utils/settingsStore");
}

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

describe("settingsStore", () => {
  it("returns defaults when nothing is stored", async () => {
    const { loadSettings } = await freshModule();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("persists and reloads a settings object", async () => {
    const { loadSettings, saveSettings } = await freshModule();
    const s: Settings = { gridDensity: "compact", slowThresholdMs: 900, checkUpdatesOnStart: false };
    saveSettings(s);
    expect(localStorage.getItem(KEY)).toBeTruthy();
    expect(loadSettings()).toEqual(s);
  });

  it("falls back to defaults for a corrupt blob", async () => {
    localStorage.setItem(KEY, "{broken");
    const { loadSettings } = await freshModule();
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
