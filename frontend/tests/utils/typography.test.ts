import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyTypography,
  clampFontSize,
  clampLineHeight,
  clampZoom,
  fontStack,
  gridScale,
  MAX_ZOOM,
  MIN_ZOOM,
  MONO_FALLBACK,
  nextZoom,
  prevZoom,
  sanitizeFontFamily,
  scalePx,
  treeRowHeight,
  DENSITY_SCALES,
  typeScale,
  typographyVars,
  UI_FALLBACK,
  ZOOM_STEPS,
} from "../../src/utils/typography";
import { DEFAULT_SETTINGS, rowHeightFor } from "../../src/utils/settings";

const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8").replace(/\r\n/g, "\n");

describe("zoom steps", () => {
  it("clamps to the step range, rounds, and falls back to 100 for junk", () => {
    expect(clampZoom(10)).toBe(MIN_ZOOM);
    expect(clampZoom(999)).toBe(MAX_ZOOM);
    expect(clampZoom(124.6)).toBe(125);
    expect(clampZoom(NaN)).toBe(100);
    expect(clampZoom(Infinity)).toBe(100);
  });

  it("walks the steps up and down and stops at the ends", () => {
    expect(nextZoom(100)).toBe(110);
    expect(prevZoom(100)).toBe(90);
    expect(nextZoom(MAX_ZOOM)).toBe(MAX_ZOOM);
    expect(prevZoom(MIN_ZOOM)).toBe(MIN_ZOOM);
    // A value between steps (an old blob, a future step) lands on a real step.
    expect(nextZoom(105)).toBe(110);
    expect(prevZoom(105)).toBe(100);
  });

  it("has 100 as a step and is sorted", () => {
    expect(ZOOM_STEPS).toContain(100);
    expect([...ZOOM_STEPS].sort((a, b) => a - b)).toEqual([...ZOOM_STEPS]);
  });
});

describe("clamps", () => {
  it("keeps font sizes within [8, 32] px and whole", () => {
    expect(clampFontSize(3, 12)).toBe(8);
    expect(clampFontSize(80, 12)).toBe(32);
    expect(clampFontSize(13.4, 12)).toBe(13);
    expect(clampFontSize(NaN, 12)).toBe(12);
  });
  it("keeps the line height within [1, 2.5] to two decimals", () => {
    expect(clampLineHeight(0.2, 1.4)).toBe(1);
    expect(clampLineHeight(9, 1.4)).toBe(2.5);
    expect(clampLineHeight(1.456, 1.4)).toBe(1.46);
    expect(clampLineHeight(NaN, 1.4)).toBe(1.4);
  });
});

describe("typeScale", () => {
  it("reproduces the stylesheet at 12px / 100%", () => {
    expect(typeScale(12, 100)).toEqual({ micro: 11, sm: 11, base: 12, md: 13, lg: 15 });
  });
  it("scales every step with the base and the zoom, to whole pixels", () => {
    expect(typeScale(12, 200)).toEqual({ micro: 22, sm: 22, base: 24, md: 26, lg: 30 });
    expect(typeScale(16, 100).base).toBe(16);
    expect(typeScale(12, 110).base).toBe(13);
    for (const v of Object.values(typeScale(8, 80))) expect(Number.isInteger(v)).toBe(true);
  });
  it("never yields a size under 1px", () => {
    for (const v of Object.values(typeScale(-5, -5))) expect(v).toBeGreaterThanOrEqual(1);
  });
});

describe("row heights follow the zoom and the font", () => {
  it("scalePx rounds and never collapses to 0", () => {
    expect(scalePx(24, 100)).toBe(24);
    expect(scalePx(24, 125)).toBe(30);
    expect(scalePx(2, 80)).toBe(2);
    expect(scalePx(1, 80)).toBe(1);
  });
  it("the tree row equals --h-sm under the zoom", () => {
    expect(treeRowHeight(100)).toBe(24);
    expect(treeRowHeight(150)).toBe(36);
    expect(typographyVars({ ...DEFAULT_SETTINGS, zoom: 150 })["--h-sm"]).toBe("36px");
  });
  it("the tree row and --h-sm follow the density (#682)", () => {
    expect(treeRowHeight(100, "compact")).toBe(20);
    expect(treeRowHeight(150, "compact")).toBe(30);
    const compact = typographyVars({ ...DEFAULT_SETTINGS, density: "compact" });
    expect(compact["--h-sm"]).toBe(`${treeRowHeight(100, "compact")}px`);
  });
  it("the grid scale is the font over 12px times the zoom", () => {
    expect(gridScale({ gridFontSize: 12, zoom: 100 })).toBe(1);
    expect(gridScale({ gridFontSize: 18, zoom: 100 })).toBe(1.5);
    expect(gridScale({ gridFontSize: 12, zoom: 200 })).toBe(2);
    expect(rowHeightFor("registro", "comfortable", gridScale({ gridFontSize: 12, zoom: 200 }))).toBe(56);
    expect(rowHeightFor("hoja", "compact", gridScale({ gridFontSize: 15, zoom: 100 }))).toBe(25);
  });
});

describe("density scales (#682)", () => {
  const steps = (d: "comfortable" | "compact") => Object.values(DENSITY_SCALES[d]);
  it("comfortable is exactly what styles.css declares", () => {
    for (const [name, px] of Object.entries(DENSITY_SCALES.comfortable)) {
      expect(CSS, name).toContain(`  ${name}: ${px}px;`);
    }
  });
  it("compact covers the same tokens and is never larger, never collapsing", () => {
    expect(Object.keys(DENSITY_SCALES.compact)).toEqual(Object.keys(DENSITY_SCALES.comfortable));
    const c = steps("compact");
    steps("comfortable").forEach((v, i) => {
      expect(c[i]).toBeLessThanOrEqual(v);
      expect(c[i]).toBeGreaterThan(0);
    });
  });
  it("compact grid rows are the REDESIGN's 28/24", () => {
    expect(rowHeightFor("registro", "comfortable")).toBe(28);
    expect(rowHeightFor("registro", "compact")).toBe(24);
  });
  it("typographyVars writes the density's scale under the zoom", () => {
    const v = typographyVars({ ...DEFAULT_SETTINGS, density: "compact", zoom: 200 });
    expect(v["--band-lg"]).toBe(`${DENSITY_SCALES.compact["--band-lg"] * 2}px`);
    expect(v["--sp-3"]).toBe(`${DENSITY_SCALES.compact["--sp-3"] * 2}px`);
    // Density never touches the type scale: compact is less air, not smaller text.
    expect(v["--fs-base"]).toBe(typographyVars({ ...DEFAULT_SETTINGS, zoom: 200 })["--fs-base"]);
  });
});

describe("sanitizeFontFamily", () => {
  it("quotes names, keeps generic keywords bare, and strips quotes it was given", () => {
    expect(sanitizeFontFamily("Fira Code")).toBe('"Fira Code"');
    expect(sanitizeFontFamily("'Fira Code', monospace")).toBe('"Fira Code", monospace');
    expect(sanitizeFontFamily('"JetBrains Mono" , Sans-Serif')).toBe('"JetBrains Mono", sans-serif');
  });
  it("drops anything that is not a family name, so nothing reaches the CSS", () => {
    expect(sanitizeFontFamily("Arial; color: red")).toBe("");
    expect(sanitizeFontFamily("url(http://x), Arial")).toBe('"Arial"');
    expect(sanitizeFontFamily("var(--x)")).toBe("");
    expect(sanitizeFontFamily("}body{display:none}")).toBe("");
    expect(sanitizeFontFamily("Arial\\")).toBe("");
    expect(sanitizeFontFamily("")).toBe("");
    expect(sanitizeFontFamily(" , , ")).toBe("");
  });
  it("collapses whitespace, dedupes and caps the length", () => {
    expect(sanitizeFontFamily("Fira   Code, Fira Code")).toBe('"Fira Code"');
    expect(sanitizeFontFamily("a".repeat(65))).toBe("");
    expect(sanitizeFontFamily("Noto Sans CJK JP")).toBe('"Noto Sans CJK JP"');
  });
  it("always has a fallback appended by fontStack", () => {
    expect(fontStack("", MONO_FALLBACK)).toBe(MONO_FALLBACK);
    expect(fontStack('"Fira Code"', MONO_FALLBACK)).toBe(`"Fira Code", ${MONO_FALLBACK}`);
  });
  // The fallbacks are the theme's stacks (#747), which the theme writes.
  it("keeps the fallback stacks equal to the stylesheet's", () => {
    expect(CSS).toContain(`--font-system: ${UI_FALLBACK};`);
    expect(CSS).toContain(`--font-editor: ${MONO_FALLBACK};`);
    expect(CSS).toContain("--font-theme-ui: ");
    expect(CSS).toContain("--font-mono: ");
  });
});

describe("typographyVars", () => {
  it("reproduces the stylesheet's tokens for the default settings", () => {
    const vars = typographyVars(DEFAULT_SETTINGS);
    for (const [name, value] of Object.entries(vars)) {
      if (name === "--font-editor" || name === "--font-grid") {
        expect(value).toBe(MONO_FALLBACK);
      } else if (name === "--fs-editor") {
        expect(value).toBe("13px"); // --fs-md
      } else if (name === "--fs-grid") {
        expect(value).toBe("12px"); // --fs-base
      } else {
        expect(CSS, `${name}: ${value}`).toContain(`  ${name}: ${value};`);
      }
    }
  });
  it("prepends the user's fonts and sizes the editor and grid under the zoom", () => {
    const vars = typographyVars({
      ...DEFAULT_SETTINGS,
      editorFont: '"Fira Code"',
      editorFontSize: 14,
      editorLineHeight: 1.6,
      editorLigatures: false,
      gridFont: '"JetBrains Mono"',
      gridFontSize: 11,
      uiFont: '"Inter"',
      zoom: 150,
    });
    expect(vars["--font-editor"]).toBe(`"Fira Code", ${MONO_FALLBACK}`);
    expect(vars["--font-grid"]).toBe(`"JetBrains Mono", ${MONO_FALLBACK}`);
    expect(vars["--font-system"]).toBe(`"Inter", ${UI_FALLBACK}`);
    expect(vars["--fs-editor"]).toBe("21px");
    expect(vars["--fs-grid"]).toBe("17px");
    expect(vars["--lh-editor"]).toBe("1.6");
    expect(vars["--liga-editor"]).toBe("none");
    expect(vars["--sp-3"]).toBe("12px");
    expect(vars["--band-lg"]).toBe("60px");
  });
  it("applyTypography writes every variable through setProperty", () => {
    const written: Record<string, string> = {};
    applyTypography({ setProperty: (n, v) => (written[n] = v) }, { "--a": "1", "--b": "2" });
    expect(written).toEqual({ "--a": "1", "--b": "2" });
  });
});
