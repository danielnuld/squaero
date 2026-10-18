import { describe, it, expect } from "vitest";
import {
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

const indigo = BUILTIN_THEMES[0];

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
