import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BUILTIN_THEMES, DEFAULT_THEME_ID, STYLE_THEME_IDS, isBuiltinTheme } from "../../src/utils/themes";
import { TOKEN_GROUPS, contrastIssues, themeVariables, validateTheme } from "../../src/utils/themeSchema";
import { AA_NORMAL, contrastRatio, mixHex } from "../../src/utils/contrast";

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
  // brand light palette rather than half-designed while #678 was open.
  it("pair the once dark-only themes with the indigo light palette", () => {
    const indigo = BUILTIN_THEMES.find((t) => t.id === "indigo")!;
    for (const id of ["ciruela", "pizarra", "terminal"]) {
      expect(BUILTIN_THEMES.find((t) => t.id === id)!.light).toEqual(indigo.light);
    }
  });

  it("only Terminal draws the UI in monospace", () => {
    expect(BUILTIN_THEMES.filter((t) => t.monoUi).map((t) => t.id)).toEqual(["terminal"]);
  });

  // The stylesheet keeps the default theme's light variant as the baseline for
  // the first paint; it is the one place a theme value is still written in CSS,
  // and this is what stops it from drifting away from the data.
  it("match the stylesheet's baseline block, token for token", () => {
    const def = BUILTIN_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!;
    expect(baseline()).toEqual(themeVariables(def, "light"));
  });
});

// The M14 styles (#747, docs/design/m14/).
describe("the M14 styles", () => {
  const styles = STYLE_THEME_IDS.map((id) => BUILTIN_THEMES.find((t) => t.id === id)!);

  it("are built in, first in picker order, with B · Nativo the default", () => {
    expect(BUILTIN_THEMES.slice(0, 4).map((t) => t.id)).toEqual(["nativo", "quiet", "editorial", "rosa"]);
    expect(DEFAULT_THEME_ID).toBe("nativo");
  });

  it("keep every earlier theme", () => {
    for (const id of ["indigo", "blue", "ciruela", "pizarra", "terminal", "contrast"]) {
      expect(isBuiltinTheme(id), id).toBe(true);
    }
  });

  it("carry their own typography and radii", () => {
    const byId = Object.fromEntries(styles.map((t) => [t.id, t]));
    expect(byId.nativo.fontUi).toContain("Segoe UI Variable");
    expect(byId.quiet.fontUi).toMatch(/^"Geist"/);
    expect(byId.quiet.fontMono).toMatch(/^"Geist Mono"/);
    expect(byId.editorial.fontUi).toMatch(/^"IBM Plex Sans"/);
    expect(byId.editorial.fontMono).toMatch(/^"IBM Plex Mono"/);
    expect(byId.rosa.fontUi).toMatch(/^"Figtree"/);
    expect(byId.nativo.radius).toEqual({ sm: 6, md: 8, lg: 12 });
    expect(byId.quiet.radius).toEqual({ sm: 4, md: 6, lg: 8 });
    expect(byId.editorial.radius).toEqual({ sm: 2, md: 2, lg: 2 });
    expect(byId.rosa.radius).toEqual({ sm: 8, md: 12, lg: 16 });
  });

  // The prototype's own variant, value for value where it already met AA on
  // every surface the app paints text on.
  it("keep the prototype's surfaces and accents", () => {
    const byId = Object.fromEntries(styles.map((t) => [t.id, t]));
    expect(byId.nativo.light).toMatchObject({ bg: "#ffffff", "bg-elev": "#e9edf1", accent: "#0f7b72", "border-strong": "#7a838e" });
    expect(byId.quiet.dark).toMatchObject({ bg: "#0f1216", "bg-elev": "#0c0f12", accent: "#3fb8a9", "border-strong": "#5f6a78" });
    expect(byId.editorial.dark).toMatchObject({ bg: "#17140f", accent: "#e0a43c", "text-faint": "#958a74" });
    expect(byId.rosa.light).toMatchObject({ bg: "#fffafc", "bg-elev": "#fbe7ef", accent: "#c2477a" });
  });

  // The light and the dark of each style, every pair contrastIssues measures:
  // text 4.5:1 on all four surfaces, ink on fills 4.5:1, accent and the control
  // border 3:1.
  it.each(STYLE_THEME_IDS)("%s meets WCAG AA in both variants", (id) => {
    expect(contrastIssues(BUILTIN_THEMES.find((t) => t.id === id)!)).toEqual([]);
  });

  // #801: «Registro» colours what is not text, so numbers and dates must not be
  // the ink — and stay AA on the data and on the hover/zebra step.
  it("give numbers and dates a colour of their own, readable", () => {
    for (const t of styles) {
      for (const mode of ["light", "dark"] as const) {
        const v = t[mode];
        for (const k of ["cell-number", "cell-temporal"] as const) {
          expect(v[k], `${t.id} ${mode} ${k}`).not.toBe(v.text);
          for (const surface of ["bg", "bg-elev2"] as const) {
            expect(contrastRatio(v[k], v[surface]), `${t.id} ${mode} ${k} on ${surface}`).toBeGreaterThanOrEqual(AA_NORMAL);
          }
        }
      }
    }
  });

  it("read light-first or dark-first as designed", () => {
    const lum = (hex: string) => parseInt(hex.slice(1, 3), 16);
    for (const t of styles) {
      expect(lum(t.light.bg), t.id).toBeGreaterThan(200);
      expect(lum(t.dark.bg), t.id).toBeLessThan(60);
    }
  });
});

// The SQL editor paints bands under the text (issue #691): the statement that
// will run (accent at 9%), the line that failed (error at 10%) and the current
// line (accent at 5%). The syntax colours must stay AA on them, in every style.
describe("syntax colours on the editor's bands", () => {
  const bands = [
    ["accent", 0.09],
    ["error", 0.1],
    ["accent", 0.05],
  ] as const;
  it.each(BUILTIN_THEMES.map((t) => t.id))("%s keeps AA for code on the run and error bands", (id) => {
    const theme = BUILTIN_THEMES.find((t) => t.id === id)!;
    const low: string[] = [];
    for (const mode of ["light", "dark"] as const) {
      const v = theme[mode];
      for (const [tint, w] of bands) {
        const band = mixHex(v[tint], v.bg, w);
        for (const fg of [...TOKEN_GROUPS.syntax, "text"] as const) {
          const r = contrastRatio(v[fg], band);
          if (r < AA_NORMAL) low.push(`${mode} ${fg} on ${tint} ${w}: ${r.toFixed(2)}`);
        }
      }
    }
    expect(low).toEqual([]);
  });
});
