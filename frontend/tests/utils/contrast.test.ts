import { describe, it, expect } from "vitest";
import {
  hexToRgb,
  relativeLuminance,
  contrastRatio,
  AA_NORMAL,
} from "../../src/utils/contrast";

// The palette tokens under test (keep in sync with styles.css). This locks the
// issue #220 fix: --accent-text must clear AA on every elevated surface it is
// painted on, in both themes.
const DARK = {
  accentText: "#9090f5",
  accent: "#7c7cf0",
  surfaces: ["#1e1e24", "#26262e", "#2e2e38"], // --bg, --bg-elev, --bg-elev2
};
const LIGHT = {
  accentText: "#4a4ac4",
  accent: "#5b5bd6",
  surfaces: ["#f7f7fa", "#ffffff", "#ececf1"],
};

describe("contrast math", () => {
  it("parses shorthand and full hex", () => {
    expect(hexToRgb("#fff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#2e2e38")).toEqual({ r: 46, g: 46, b: 56 });
  });

  it("rejects malformed hex", () => {
    expect(() => hexToRgb("#12")).toThrow();
    expect(() => hexToRgb("nope")).toThrow();
  });

  it("luminance is 0 for black and ~1 for white", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it("black on white is the maximal 21:1", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });
});

describe("accent-text meets WCAG AA on elevated surfaces (issue #220)", () => {
  for (const surface of DARK.surfaces) {
    it(`dark --accent-text on ${surface}`, () => {
      expect(contrastRatio(DARK.accentText, surface)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  }
  for (const surface of LIGHT.surfaces) {
    it(`light --accent-text on ${surface}`, () => {
      expect(contrastRatio(LIGHT.accentText, surface)).toBeGreaterThanOrEqual(AA_NORMAL);
    });
  }

  it("regression: plain --accent WAS sub-AA on the lightest dark surface", () => {
    // Documents why the token exists: #7c7cf0 on #2e2e38 is ~3.8 < 4.5.
    expect(contrastRatio(DARK.accent, "#2e2e38")).toBeLessThan(AA_NORMAL);
    expect(contrastRatio(DARK.accent, "#2e2e38")).toBeGreaterThan(3.5);
  });
});
