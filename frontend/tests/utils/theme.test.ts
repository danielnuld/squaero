import { describe, it, expect } from "vitest";
import {
  nextTheme,
  resolveTheme,
  themeLabel,
  themeIcon,
  loadTheme,
  saveTheme,
  applyTheme,
  THEME_KEY,
} from "../../src/utils/theme";

describe("theme preference cycle", () => {
  it("cycles system → light → dark → system", () => {
    expect(nextTheme("system")).toBe("light");
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("system");
  });
});

describe("resolveTheme", () => {
  it("passes through explicit preferences", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
  it("follows the OS when system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
});

describe("labels", () => {
  it("labels each preference", () => {
    expect(themeLabel("light")).toMatch(/claro/);
    expect(themeLabel("dark")).toMatch(/oscuro/);
    expect(themeLabel("system")).toMatch(/sistema/);
  });
  it("gives a distinct icon per preference", () => {
    const icons = new Set([themeIcon("system"), themeIcon("light"), themeIcon("dark")]);
    expect(icons.size).toBe(3);
  });
});

describe("persistence", () => {
  it("round-trips through a storage stub", () => {
    const store: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => {
        store[k] = v;
      },
    };
    saveTheme("dark", storage);
    expect(store[THEME_KEY]).toBe("dark");
    expect(loadTheme(storage)).toBe("dark");
  });
  it("defaults to system for missing/garbage/no storage", () => {
    expect(loadTheme(undefined)).toBe("system");
    expect(loadTheme({ getItem: () => null })).toBe("system");
    expect(loadTheme({ getItem: () => "purple" })).toBe("system");
  });
  it("swallows a throwing storage", () => {
    const bad = {
      getItem: () => {
        throw new Error("blocked");
      },
    };
    expect(loadTheme(bad)).toBe("system");
    expect(() =>
      saveTheme("light", {
        setItem: () => {
          throw new Error("blocked");
        },
      }),
    ).not.toThrow();
  });
});

describe("applyTheme", () => {
  it("stamps the resolved theme on the root and returns it", () => {
    let attr: string | undefined;
    const root = { setAttribute: (_n: string, v: string) => (attr = v) };
    expect(applyTheme("system", root, true)).toBe("dark");
    expect(attr).toBe("dark");
    expect(applyTheme("light", root, true)).toBe("light");
    expect(attr).toBe("light");
  });
});

// Issue #473: a theme that owns its surfaces has the last word over the
// light/dark preference — without touching the preference itself, which is what
// comes back when the user returns to an accent skin.
describe("theme fixed by a dark-only skin", () => {
  it("resolves to dark whatever the preference says", () => {
    expect(resolveTheme("light", false, true)).toBe("dark");
    expect(resolveTheme("system", false, true)).toBe("dark");
    expect(resolveTheme("dark", true, true)).toBe("dark");
  });

  it("leaves the preference alone when nothing forces it", () => {
    expect(resolveTheme("light", true, false)).toBe("light");
    expect(resolveTheme("system", false, false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("stamps the forced theme on the root", () => {
    let attr: [string, string] | null = null;
    const root = { setAttribute: (k: string, v: string) => (attr = [k, v]) };
    expect(applyTheme("light", root, false, true)).toBe("dark");
    expect(attr).toEqual(["data-theme", "dark"]);
    expect(applyTheme("light", root, false, false)).toBe("light");
    expect(attr).toEqual(["data-theme", "light"]);
  });
});
