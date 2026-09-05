import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The design-system guard (issue #386).
 *
 * `styles.css` had colour tokens and nothing else: space, type, radii, shadows
 * and control heights were decided in each rule, and that produced 19 text
 * sizes, 12 radii, ~60 padding combinations and 7 control heights across 477
 * class namespaces. The scales now live in `:root`; these tests are what stops
 * the next rule from inventing a value outside them.
 *
 * A value that genuinely has to sit off-scale is fine — add it to the allow
 * list here with the reason, so the exception is a decision and not a drift.
 */

// Resolved from the cwd, not from `import.meta.url`: the jsdom environment
// replaces the global URL, and fileURLToPath then rejects its output.
const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8");

/** The `:root` blocks, where the literal values are supposed to live. */
const TOKEN_BLOCK_END = CSS.indexOf("* {\n  box-sizing: border-box;\n}");

/** Everything after the token definitions: the rules that must use them. */
const RULES = CSS.slice(TOKEN_BLOCK_END);

/** Strips comments so issue references like `#386` never read as colours. */
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `prop: value;` pair for one property, declarations only. */
const declarations = (css: string, prop: string): string[] =>
  Array.from(
    stripComments(css).matchAll(new RegExp(`\\b${prop}:\\s*([^;{}]+);`, "g")),
    (m) => m[1].trim(),
  );

describe("styles.css scales", () => {
  it("defines every scale it claims", () => {
    for (const token of [
      "--sp-1", "--sp-2", "--sp-3", "--sp-4", "--sp-5", "--sp-6",
      "--r-sm", "--r-md", "--r-pill",
      "--fs-micro", "--fs-sm", "--fs-base", "--fs-md", "--fs-lg",
      "--h-micro", "--h-sm", "--h-md",
      "--band-sm", "--band-md", "--band-lg",
      "--shadow-sm", "--shadow-lg", "--focus-ring",
      "--motion-fast",
    ]) {
      expect(CSS, `${token} is not defined`).toContain(`  ${token}:`);
    }
  });

  it("sizes all text from the type scale", () => {
    const literals = declarations(RULES, "font-size").filter(
      (v) => !v.startsWith("var(--fs-") && v !== "inherit",
    );
    expect(literals).toEqual([]);
  });

  it("rounds every corner from the radius scale", () => {
    const literals = declarations(RULES, "border-radius").filter(
      (v) => !/^(0|(var\(--r-(sm|md|pill)\)\s*)+0?\s*0?)$/.test(v),
    );
    expect(literals).toEqual([]);
  });

  it("spaces everything from the spacing scale", () => {
    // 1px is a hairline rather than a space, `auto` centres, and a negative
    // margin is a deliberate overlap — none of them are scale steps.
    // 12vh centres a modal against the viewport, which no px scale can express.
    const allowed = /^(0|auto|1px|-\d+px|12vh|inherit|var\(--sp-[1-6]\))$/;
    const offScale: string[] = [];
    const sides = ["top", "right", "bottom", "left"];
    const props = ["padding", "gap", "row-gap", "column-gap", "margin"].concat(
      ...["padding", "margin"].map((p) => sides.map((s) => `${p}-${s}`)),
    );
    for (const prop of props) {
      for (const value of declarations(RULES, prop)) {
        if (value.includes("(") && !value.includes("var(--sp-")) continue;
        for (const part of value.split(/\s+/)) {
          if (!allowed.test(part)) offScale.push(`${prop}: ${value}`);
        }
      }
    }
    expect(offScale).toEqual([]);
  });

  it("draws every drop shadow from the two shadow tokens", () => {
    // `inset` rings and `0 0 0` outlines are markers drawn on an element, not
    // the elevation of a surface above the page.
    const literals = declarations(RULES, "box-shadow").filter(
      (v) => !v.startsWith("var(--shadow-") && !v.startsWith("inset") && !v.startsWith("0 0 0"),
    );
    expect(literals).toEqual([]);
  });
});

describe("styles.css colour", () => {
  it("keeps every colour in a token", () => {
    const hex = stripComments(RULES)
      .replace(/url\("data:[^"]*"\)/g, "")
      .match(/#[0-9a-fA-F]{3,8}\b/g);
    expect(hex ?? []).toEqual([]);
  });

  it("references only custom properties that exist", () => {
    // Four variables were referenced but never defined anywhere — --danger,
    // --mono, --faint and --surface-2 — so what those rules actually painted
    // was the fallback beside them. That is how a second red got into the
    // palette and how the cancel button for a running query ended up with no
    // fill at all, in the one place a button has to stay visible.
    const RUNTIME_SET = [
      "--grid-row-h", // ResultGrid sets this inline per row height
      "--conn-accent", // App sets this per connection section (#444)
    ];
    const defined = new Set(
      Array.from(CSS.matchAll(/^\s*(--[a-z0-9-]+):/gm), (m) => m[1]),
    );
    const missing = Array.from(
      new Set(Array.from(CSS.matchAll(/var\((--[a-z0-9-]+)/g), (m) => m[1])),
    ).filter((v) => !defined.has(v) && !RUNTIME_SET.includes(v));
    expect(missing).toEqual([]);
  });

  it("never gives a custom property a fallback value", () => {
    // Every `var(--x, #hex)` here fell back to the LIGHT theme's colour, so on
    // the day the variable went missing it would paint the wrong theme. The
    // variables all exist; the fallbacks were dead code hiding a real bug —
    // `--danger` was never defined at all, so its fallback was the colour.
    const fallbacks = stripComments(CSS).match(/var\(--[a-z0-9-]+,\s*#[0-9a-fA-F]+\)/g);
    expect(fallbacks ?? []).toEqual([]);
  });
});

describe("styles.css keyboard focus", () => {
  it("suppresses the focus outline in exactly one place", () => {
    // Twelve scattered `outline: none` rules removed the keyboard focus ring;
    // only three put anything back. One pair of rules now owns the behaviour.
    const suppressions = stripComments(CSS).match(/outline:\s*none/g);
    expect(suppressions).toHaveLength(1);
  });

  it("draws a ring on :focus-visible", () => {
    expect(CSS).toMatch(/:focus-visible \{\s+outline: 2px solid var\(--accent\);/);
  });
});

// Issue #386: the app had exactly one transition in 105 KB of CSS, which reads
// as an oversight rather than as the decision it is. The decision — chrome does
// not animate — only holds if it stays written down and the exceptions go
// through the token.
describe("motion", () => {
  it("times every transition from the motion token", () => {
    const durations = Array.from(
      stripComments(RULES).matchAll(/transition(?:-duration)?:\s*([^;{}]+);/g),
      (m) => m[1].trim(),
    ).filter((v) => !v.includes("var(--motion-") && !v.includes("0.01ms"));
    expect(durations).toEqual([]);
  });

  it("honours prefers-reduced-motion", () => {
    expect(CSS).toContain("@media (prefers-reduced-motion: reduce)");
  });
});

/**
 * The colour themes that own their surfaces (issue #473).
 *
 * A skin that only swaps the accent inherits everything else from the theme it
 * layers over, so it cannot go wrong on its own. These three replace the
 * surfaces too — which means each one has to clear the contrast bar BY ITSELF,
 * and nothing else in the app checks that. The numbers were measured when the
 * palettes were designed; this is what keeps them true after the next tweak.
 */
describe("themes that bring their own surfaces", () => {
  const DARK_SKINS = ["ciruela", "pizarra", "terminal"];
  const SURFACES = ["--bg", "--bg-elev", "--bg-elev2"];
  /** Tokens that are drawn AS TEXT on those surfaces, so AA applies to them. */
  const AS_TEXT = ["--text", "--text-dim", "--accent-text", "--null", "--number", "--error"];

  const block = (skin: string): Record<string, string> => {
    const start = CSS.indexOf(`:root[data-skin="${skin}"] {`);
    expect(start).toBeGreaterThan(-1);
    const body = CSS.slice(start, CSS.indexOf("}", start));
    const out: Record<string, string> = {};
    for (const m of body.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
      out[m[1]] = m[2];
    }
    return out;
  };

  const luminance = (hex: string) => {
    const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const [r, g, b] = ch.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it("defines the whole palette, not half of it", () => {
    const required = [
      ...SURFACES,
      "--border",
      ...AS_TEXT,
      "--accent",
      "--accent-fg",
      "--accent-hover",
    ];
    for (const skin of DARK_SKINS) {
      const t = block(skin);
      for (const token of required) {
        expect(`${skin}:${token}=${t[token] ?? "MISSING"}`).toMatch(/#[0-9a-f]{6}$/i);
      }
    }
  });

  it("clears AA for every token drawn as text, on all three surfaces", () => {
    for (const skin of DARK_SKINS) {
      const t = block(skin);
      for (const token of AS_TEXT) {
        for (const surface of SURFACES) {
          const ratio = contrast(t[token], t[surface]);
          expect(`${skin} ${token} on ${surface}: ${ratio.toFixed(2)}`).toBe(
            `${skin} ${token} on ${surface}: ${Math.max(ratio, 4.5).toFixed(2)}`,
          );
        }
      }
    }
  });

  it("keeps the ink on an accent fill readable", () => {
    for (const skin of DARK_SKINS) {
      const t = block(skin);
      expect(contrast(t["--accent-fg"], t["--accent"])).toBeGreaterThanOrEqual(4.5);
    }
  });
});
