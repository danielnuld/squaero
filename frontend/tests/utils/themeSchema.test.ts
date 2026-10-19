import { describe, it, expect } from "vitest";
import {
  OPTIONAL_TOKENS,
  TOKEN_NAMES,
  TOKEN_GROUPS,
  contrastIssues,
  normalizeHex,
  parseThemeJson,
  serializeTheme,
  themeCss,
  themeVariables,
  validateTheme,
  type Theme,
} from "../../src/utils/themeSchema";
import { BUILTIN_THEMES } from "../../src/utils/themes";
import { contrastRatio } from "../../src/utils/contrast";

const indigo = BUILTIN_THEMES.find((t) => t.id === "indigo")!;

/** A valid theme file body to break in one place at a time. */
const valid = (): Record<string, unknown> => JSON.parse(serializeTheme(indigo));

describe("token schema", () => {
  it("lists every token once, in group order", () => {
    expect(new Set(TOKEN_NAMES).size).toBe(TOKEN_NAMES.length);
    expect(TOKEN_NAMES.slice(0, 5)).toEqual([...TOKEN_GROUPS.surfaces]);
    expect(TOKEN_NAMES.at(-1)).toBe("chart-8");
  });

  it("normalises hex colours and refuses anything else", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex(" #6BA1C7 ")).toBe("#6ba1c7");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
    expect(normalizeHex("rgb(1,2,3)")).toBeNull();
  });
});

describe("validateTheme", () => {
  it("accepts every built-in theme", () => {
    for (const t of BUILTIN_THEMES) expect(validateTheme(JSON.parse(serializeTheme(t)))).toEqual([]);
  });

  it("rejects what is not an object", () => {
    expect(validateTheme(null)).toEqual([{ code: "not-object", path: "" }]);
    expect(validateTheme([1])).toEqual([{ code: "not-object", path: "" }]);
    expect(validateTheme("x")).toEqual([{ code: "not-object", path: "" }]);
  });

  it("names a missing token by its path", () => {
    const d = valid();
    delete (d.dark as Record<string, unknown>)["bg"];
    expect(validateTheme(d)).toEqual([{ code: "missing", path: "dark.bg" }]);
  });

  it("names an unknown key, at the top level and inside a variant", () => {
    const d = valid();
    d.extra = 1;
    (d.light as Record<string, unknown>)["bg-weird"] = "#000000";
    expect(validateTheme(d)).toEqual([
      { code: "unknown", path: "extra" },
      { code: "unknown", path: "light.bg-weird" },
    ]);
  });

  it("rejects a colour that is not #rgb / #rrggbb, showing the value", () => {
    const d = valid();
    (d.light as Record<string, unknown>)["accent"] = "blue";
    (d.light as Record<string, unknown>)["text"] = 12;
    expect(validateTheme(d)).toEqual([
      { code: "color", path: "light.text", value: "12" },
      { code: "color", path: "light.accent", value: "blue" },
    ]);
  });

  it("requires a slug id, a name and a boolean monoUi", () => {
    const d = valid();
    d.id = "Not A Slug";
    d.name = "   ";
    d.monoUi = "yes";
    expect(validateTheme(d)).toEqual([
      { code: "id", path: "id", value: "Not A Slug" },
      { code: "type", path: "name" },
      { code: "type", path: "monoUi", value: "string" },
    ]);
  });

  // Files exported before #747 have no border-strong, text-faint, warn or ok.
  it("accepts a file without the optional tokens", () => {
    const d = valid();
    for (const key of Object.keys(OPTIONAL_TOKENS)) delete (d.light as Record<string, unknown>)[key];
    expect(validateTheme(d)).toEqual([]);
  });

  it("accepts font stacks and radii, and refuses what could escape the style block", () => {
    const d = valid();
    d.fontUi = '"Geist", system-ui, sans-serif';
    d.fontMono = "Menlo, monospace";
    d.radius = { sm: 2, md: 4, lg: 6 };
    expect(validateTheme(d)).toEqual([]);
    d.fontUi = "x; } body { color: red";
    d.fontMono = 3;
    d.radius = { sm: -1, md: 4.5, lg: 99, xl: 1 };
    expect(validateTheme(d)).toEqual([
      { code: "type", path: "fontUi", value: "x; } body { color: red" },
      { code: "type", path: "fontMono", value: "3" },
      { code: "unknown", path: "radius.xl" },
      { code: "type", path: "radius.sm", value: "-1" },
      { code: "type", path: "radius.md", value: "4.5" },
      { code: "type", path: "radius.lg", value: "99" },
    ]);
    d.radius = "big";
    expect(validateTheme({ ...d, fontUi: undefined, fontMono: undefined })).toEqual([
      { code: "type", path: "radius", value: "string" },
    ]);
  });

  it("reports a variant that is missing altogether as one error, not forty", () => {
    const d = valid();
    delete d.light;
    expect(validateTheme(d)).toEqual([{ code: "type", path: "light" }]);
  });
});

describe("parseThemeJson / serializeTheme", () => {
  it("round-trips a built-in theme", () => {
    for (const t of BUILTIN_THEMES) {
      const { theme, errors } = parseThemeJson(serializeTheme(t));
      expect(errors).toEqual([]);
      expect(theme).toEqual(t);
    }
  });

  it("normalises short and upper-case colours on the way in", () => {
    const d = valid();
    (d.dark as Record<string, unknown>)["bg"] = "#ABC";
    const { theme } = parseThemeJson(JSON.stringify(d));
    expect(theme?.dark.bg).toBe("#aabbcc");
  });

  it("reports malformed JSON as such", () => {
    expect(parseThemeJson("{nope")).toEqual({ theme: null, errors: [{ code: "json", path: "" }] });
  });

  it("returns no theme when there are errors", () => {
    const d = valid();
    delete d.id;
    const r = parseThemeJson(JSON.stringify(d));
    expect(r.theme).toBeNull();
    expect(r.errors).toEqual([{ code: "id", path: "id" }]);
  });

  it("fills a missing optional token from its fallback", () => {
    const d = valid();
    for (const key of Object.keys(OPTIONAL_TOKENS)) delete (d.dark as Record<string, unknown>)[key];
    const { theme } = parseThemeJson(JSON.stringify(d));
    for (const [key, from] of Object.entries(OPTIONAL_TOKENS)) {
      expect(theme!.dark[key as keyof Theme["dark"]]).toBe(indigo.dark[from]);
    }
  });

  it("round-trips fonts and radii, and writes them only when set", () => {
    expect(serializeTheme(indigo)).not.toMatch(/fontUi|fontMono|radius/);
    const rosa = BUILTIN_THEMES.find((t) => t.id === "rosa")!;
    const data = JSON.parse(serializeTheme(rosa));
    expect(data.fontUi).toBe(rosa.fontUi);
    expect(data.radius).toEqual({ sm: 8, md: 12, lg: 16 });
    expect(parseThemeJson(serializeTheme(rosa)).theme).toEqual(rosa);
  });

  it("writes monoUi only when set", () => {
    expect(serializeTheme(indigo)).not.toContain("monoUi");
    const terminal = BUILTIN_THEMES.find((t) => t.id === "terminal")!;
    expect(JSON.parse(serializeTheme(terminal)).monoUi).toBe(true);
  });
});

describe("themeVariables / themeCss", () => {
  it("emits every token as a custom property plus the derived ones", () => {
    const vars = themeVariables(indigo, "dark");
    for (const name of TOKEN_NAMES) expect(vars[`--${name}`]).toBe(indigo.dark[name]);
    expect(vars["--focus-ring"]).toBe("rgba(124, 124, 240, 0.4)");
    expect(vars["--shadow-sm"]).toBe("0 4px 16px rgba(0, 0, 0, 0.35)");
    expect(vars["--font-ui"]).toBe("var(--font-system)");
  });

  it("derives the light focus ring and shadows by mode", () => {
    const vars = themeVariables(indigo, "light");
    expect(vars["--focus-ring"]).toBe("rgba(91, 91, 214, 0.32)");
    expect(vars["--shadow-lg"]).toBe("0 12px 40px rgba(20, 22, 30, 0.18)");
  });

  it("emits the theme's fonts and radii, or the defaults", () => {
    const quiet = BUILTIN_THEMES.find((t) => t.id === "quiet")!;
    const q = themeVariables(quiet, "dark");
    expect(q["--font-theme-ui"]).toBe(quiet.fontUi);
    expect(q["--font-mono"]).toBe(quiet.fontMono);
    expect([q["--r-sm"], q["--r-md"], q["--r-lg"]]).toEqual(["4px", "6px", "8px"]);
    const i = themeVariables(indigo, "light");
    expect(i["--font-theme-ui"]).toBe('system-ui, "Segoe UI", sans-serif');
    expect(i["--font-mono"]).toBe('"Cascadia Code", "Consolas", ui-monospace, monospace');
    expect([i["--r-sm"], i["--r-md"], i["--r-lg"]]).toEqual(["4px", "8px", "12px"]);
  });

  it("derives the soft tints from their colours, by mode", () => {
    expect(themeVariables(indigo, "light")["--accent-soft"]).toBe("rgba(91, 91, 214, 0.1)");
    expect(themeVariables(indigo, "dark")["--error-soft"]).toBe("rgba(240, 138, 138, 0.14)");
  });

  it("puts the UI in monospace for a monoUi theme", () => {
    const terminal = BUILTIN_THEMES.find((t) => t.id === "terminal")!;
    expect(themeVariables(terminal, "dark")["--font-ui"]).toBe("var(--font-mono)");
  });

  it("renders one :root block", () => {
    const css = themeCss(indigo, "dark");
    expect(css.startsWith(":root {\n")).toBe(true);
    expect(css).toContain("  --bg: #1e1e24;\n");
    expect(css.trimEnd().endsWith("}")).toBe(true);
  });
});

describe("contrastIssues", () => {
  it("passes every built-in theme, both variants", () => {
    for (const t of BUILTIN_THEMES) {
      expect(contrastIssues(t), t.id).toEqual([]);
    }
  });

  it("reports the failing pair with its ratio and the bar it missed", () => {
    const grey: Theme = {
      ...indigo,
      dark: { ...indigo.dark, "text-dim": "#55555f" },
    };
    const issues = contrastIssues(grey);
    expect(issues.length).toBeGreaterThan(0);
    const onBg = issues.find((i) => i.fg === "text-dim" && i.bg === "bg")!;
    expect(onBg.mode).toBe("dark");
    expect(onBg.min).toBe(4.5);
    expect(onBg.ratio).toBeLessThan(4.5);
    expect(onBg.ratio).toBeGreaterThan(1);
  });

  it("holds the control border to 3:1 and the faint text to 4.5:1", () => {
    const soft: Theme = {
      ...indigo,
      light: { ...indigo.light, "border-strong": "#d3d3dc", "text-faint": "#a0a0a8" },
    };
    const issues = contrastIssues(soft);
    expect(issues).toContainEqual(expect.objectContaining({ fg: "border-strong", bg: "bg", min: 3 }));
    expect(issues).toContainEqual(expect.objectContaining({ fg: "text-faint", bg: "bg", min: 4.5 }));
  });

  it("holds the accent to 3:1 as a UI colour and its ink to 4.5:1", () => {
    const faint: Theme = {
      ...indigo,
      light: { ...indigo.light, accent: "#dcdcf5", "accent-fg": "#ffffff" },
    };
    const issues = contrastIssues(faint);
    expect(issues).toContainEqual(expect.objectContaining({ fg: "accent", bg: "bg", min: 3 }));
    expect(issues).toContainEqual(expect.objectContaining({ fg: "accent-fg", bg: "accent", min: 4.5 }));
  });
});

// AAA where reasonable: every text token at 7:1 on every surface in both
// variants, and the ink on the accent and error fills too.
describe("the high-contrast theme", () => {
  const hc = BUILTIN_THEMES.find((t) => t.id === "contrast")!;
  const surfaces = ["bg", "bg-elev", "bg-elev2", "bg-overlay"] as const;
  const text = [
    ...TOKEN_GROUPS.text,
    "accent-text",
    "error",
    "null",
    "number",
    ...TOKEN_GROUPS.cells,
    ...TOKEN_GROUPS.syntax,
  ] as const;

  it("clears AAA for text on every surface", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const fg of text) {
        for (const bg of surfaces) {
          const r = contrastRatio(hc[mode][fg], hc[mode][bg]);
          expect(r, `${mode} ${fg} on ${bg}`).toBeGreaterThanOrEqual(7);
        }
      }
      expect(contrastRatio(hc[mode]["accent-fg"], hc[mode].accent)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(hc[mode]["error-fg"], hc[mode].error)).toBeGreaterThanOrEqual(7);
      expect(contrastRatio(hc[mode].border, hc[mode].bg)).toBeGreaterThanOrEqual(3);
    }
  });
});
