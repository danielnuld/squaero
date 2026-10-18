import { describe, it, expect } from "vitest";
import {
  THEME_ID_KEY,
  CUSTOM_THEMES_KEY,
  LEGACY_SKIN_KEY,
  addCustomTheme,
  customThemeId,
  findTheme,
  loadCustomThemes,
  loadThemeChoice,
  migrateLegacyChoice,
  parseCustomThemes,
  removeCustomTheme,
  saveCustomThemes,
  saveThemeId,
  serializeCustomThemes,
} from "../../src/utils/themeStore";
import { THEME_KEY } from "../../src/utils/theme";
import { BUILTIN_THEMES } from "../../src/utils/themes";
import type { Theme } from "../../src/utils/themeSchema";

function memStore(seed: Record<string, string> = {}) {
  const m = new Map(Object.entries(seed));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    _m: m,
  };
}

const mine: Theme = { ...BUILTIN_THEMES[0], id: "mine", name: "Mine" };

describe("migrateLegacyChoice", () => {
  it("keeps an accent skin and the mode as they were", () => {
    expect(migrateLegacyChoice("indigo", "system")).toEqual({ themeId: "indigo", mode: "system" });
    expect(migrateLegacyChoice("blue", "light")).toEqual({ themeId: "blue", mode: "light" });
  });

  it("moves a dark-only skin to dark mode, which is what it was showing", () => {
    expect(migrateLegacyChoice("terminal", "light")).toEqual({ themeId: "terminal", mode: "dark" });
    expect(migrateLegacyChoice("ciruela", "system")).toEqual({ themeId: "ciruela", mode: "dark" });
    expect(migrateLegacyChoice("pizarra", "dark")).toEqual({ themeId: "pizarra", mode: "dark" });
  });

  it("falls back to the brand default for nothing or nonsense", () => {
    expect(migrateLegacyChoice(null, "dark")).toEqual({ themeId: "indigo", mode: "dark" });
    expect(migrateLegacyChoice(undefined, "system")).toEqual({ themeId: "indigo", mode: "system" });
    expect(migrateLegacyChoice("bogus", "light")).toEqual({ themeId: "indigo", mode: "light" });
  });
});

describe("loadThemeChoice", () => {
  it("reads the new key when present", () => {
    const s = memStore({ [THEME_ID_KEY]: "mine", [THEME_KEY]: "light", [LEGACY_SKIN_KEY]: "terminal" });
    expect(loadThemeChoice(s)).toEqual({ themeId: "mine", mode: "light" });
  });

  it("migrates the old skin once, writing the id and a forced mode", () => {
    const s = memStore({ [LEGACY_SKIN_KEY]: "terminal", [THEME_KEY]: "light" });
    expect(loadThemeChoice(s)).toEqual({ themeId: "terminal", mode: "dark" });
    expect(s._m.get(THEME_ID_KEY)).toBe("terminal");
    expect(s._m.get(THEME_KEY)).toBe("dark");
  });

  it("does not touch the mode when the skin did not force it", () => {
    const s = memStore({ [LEGACY_SKIN_KEY]: "blue", [THEME_KEY]: "light" });
    expect(loadThemeChoice(s)).toEqual({ themeId: "blue", mode: "light" });
    expect(s._m.get(THEME_KEY)).toBe("light");
  });

  it("defaults without storage and never throws", () => {
    expect(loadThemeChoice(undefined)).toEqual({ themeId: "indigo", mode: "system" });
    const broken = {
      getItem: () => {
        throw new Error("nope");
      },
      setItem: () => {},
    };
    expect(loadThemeChoice(broken)).toEqual({ themeId: "indigo", mode: "system" });
  });

  it("round-trips the id", () => {
    const s = memStore();
    saveThemeId("contrast", s);
    expect(loadThemeChoice(s).themeId).toBe("contrast");
  });
});

describe("custom themes", () => {
  it("round-trips through storage", () => {
    const s = memStore();
    saveCustomThemes([mine], s);
    expect(loadCustomThemes(s)).toEqual([mine]);
    expect(s._m.get(CUSTOM_THEMES_KEY)).toBe(serializeCustomThemes([mine]));
  });

  it("drops entries that no longer validate, and tolerates junk", () => {
    const bad = { ...mine, id: "bad", dark: { ...mine.dark, bg: "red" } };
    expect(parseCustomThemes(JSON.stringify([mine, bad, 7, null]))).toEqual([mine]);
    expect(parseCustomThemes("{")).toEqual([]);
    expect(parseCustomThemes("{}")).toEqual([]);
    expect(parseCustomThemes(null)).toEqual([]);
    expect(loadCustomThemes(undefined)).toEqual([]);
  });

  it("adds, replaces by id, and renames an exported built-in", () => {
    const list = addCustomTheme([], mine);
    expect(list.map((t) => t.id)).toEqual(["mine"]);
    const again = addCustomTheme(list, { ...mine, name: "Mine v2" });
    expect(again).toHaveLength(1);
    expect(again[0].name).toBe("Mine v2");
    const edited = addCustomTheme(again, { ...BUILTIN_THEMES[1], name: "My blue" });
    expect(edited.map((t) => t.id)).toEqual(["mine", "blue-custom"]);
    expect(customThemeId("blue")).toBe("blue-custom");
    expect(customThemeId("mine")).toBe("mine");
  });

  it("removes by id", () => {
    expect(removeCustomTheme([mine], "mine")).toEqual([]);
    expect(removeCustomTheme([mine], "other")).toEqual([mine]);
  });

  it("finds built-in first, then imported, else the default", () => {
    expect(findTheme("blue", [mine]).id).toBe("blue");
    expect(findTheme("mine", [mine]).id).toBe("mine");
    expect(findTheme("gone", [mine]).id).toBe("indigo");
  });
});
