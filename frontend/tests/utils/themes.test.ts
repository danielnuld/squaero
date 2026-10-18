import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILTIN_THEMES, DEFAULT_THEME_ID, isBuiltinTheme } from "../../src/utils/themes";
import { themeVariables, validateTheme } from "../../src/utils/themeSchema";

const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8").replace(/\r\n/g, "\n");

/** The first `:root { … }` block of the stylesheet, as name → value. */
function baseline(): Record<string, string> {
  const start = CSS.indexOf(":root {");
  const body = CSS.slice(start, CSS.indexOf("}", start)).replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

describe("built-in themes", () => {
  it("are valid against the schema, with unique ids and the default among them", () => {
    const ids = BUILTIN_THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(DEFAULT_THEME_ID);
    for (const t of BUILTIN_THEMES) expect(validateTheme(JSON.parse(JSON.stringify(t))), t.id).toEqual([]);
  });

  it("knows which ids are built in", () => {
    expect(isBuiltinTheme("terminal")).toBe(true);
    expect(isBuiltinTheme("mine")).toBe(false);
  });

  // Ciruela, Pizarra and Terminal had no light variant (#473): paired with the
  // default light palette rather than half-designed while #678 is open.
  it("pair the once dark-only themes with the default light palette", () => {
    const indigo = BUILTIN_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
    for (const id of ["ciruela", "pizarra", "terminal"]) {
      expect(BUILTIN_THEMES.find((t) => t.id === id)!.light).toEqual(indigo.light);
    }
  });

  it("only Terminal draws the UI in monospace", () => {
    expect(BUILTIN_THEMES.filter((t) => t.monoUi).map((t) => t.id)).toEqual(["terminal"]);
  });

  // The stylesheet keeps the brand dark palette as the baseline for the first
  // paint; it is the one place a theme value is still written in CSS, and this
  // is what stops it from drifting away from the data.
  it("match the stylesheet's baseline block, token for token", () => {
    const indigo = BUILTIN_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
    expect(baseline()).toEqual(themeVariables(indigo, "dark"));
  });
});
