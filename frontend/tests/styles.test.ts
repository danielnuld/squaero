import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
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
//
// Line endings NORMALISED, and that is load-bearing: the checkout on Windows has
// CRLF, so the `\n` marker below was never found, `slice(-1)` left a
// one-character string, and EVERY rule-level guard in this file silently
// inspected nothing. Green here, red in CI — twice, before anyone looked.
const CSS = readFileSync(resolve(process.cwd(), "src/styles.css"), "utf8").replace(/\r\n/g, "\n");

/** The `:root` blocks, where the literal values are supposed to live. */
const TOKEN_BLOCK_END = CSS.indexOf("* {\n  box-sizing: border-box;\n}");

// If the marker ever moves, every guard below would quietly inspect nothing.
// Fail loudly instead.
if (TOKEN_BLOCK_END < 0) {
  throw new Error("styles.test.ts: could not find the end of the token block");
}

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
      "--r-sm", "--r-md", "--r-lg", "--r-pill",
      "--fs-micro", "--fs-sm", "--fs-base", "--fs-md", "--fs-lg",
      "--h-micro", "--h-sm", "--h-md",
      "--band-sm", "--band-md", "--band-lg", "--band-xl",
      "--shadow-sm", "--shadow-lg", "--focus-ring",
      "--motion-fast",
      // Typography settings (#681): the editor's and the grid's own tokens.
      "--font-editor", "--fs-editor", "--lh-editor", "--liga-editor",
      "--font-grid", "--fs-grid",
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
      (v) => !/^(0|(var\(--r-(sm|md|lg|pill)\)\s*)+0?\s*0?)$/.test(v),
    );
    expect(literals).toEqual([]);
  });

  it("spaces everything from the spacing scale", () => {
    // 1px is a hairline rather than a space, `auto` centres, and a negative
    // margin is a deliberate overlap — none of them are scale steps.
    // 12vh centres a modal against the viewport, which no px scale can express.
    // 88px is the room a field leaves for the button overlaid on its right edge
    // ("Listar", "Examinar…"): it is the width of that button, not a space.
    const allowed = /^(0|auto|1px|-\d+px|12vh|88px|inherit|var\(--sp-[1-6]\))$/;
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

  // Issue #682: density acts on the height scales, so a control or a band
  // with its own px height would stay put while everything around it shrinks.
  it("sizes every control and band from the height scales", () => {
    // Under 20px is a glyph (a dot, a badge, a switch track), not a control;
    // 100px and up is a content area (an editor, a list) whose floor is about
    // content, not density. 68px is the style card's miniature window, a
    // drawing of the app rather than a piece of it.
    const offScale = declarations(RULES, "height") // also min-/max-/line-height
      .filter((v) => /^\d+px$/.test(v))
      .filter((v) => parseInt(v, 10) >= 20 && parseInt(v, 10) < 100 && v !== "68px");
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
      // Only exists once the user picks a text colour (#483/#540): its absence
      // is the signal, so it must NOT have a value in the stylesheet.
      "--cell-text-chosen",
      // ResultGrid sets this per column header: the type's colour, for the rule
      // the report style draws underneath (#540).
      "--k",
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

// Reported after v0.27.0 shipped: the connection form's footer buttons rendered
// with the OS chrome. The app's button look is reachable through a few
// selectors, and a footer that matched none of them fell back to the OS — the
// same trap that once left the filter panel's Apply unstyled.
/** App.tsx and every component, where the markup lives. */
const componentFiles = (): string[] => {
  const src = resolve(process.cwd(), "src");
  return [
    resolve(src, "App.tsx"),
    ...readdirSync(resolve(src, "components"))
      .filter((f) => f.endsWith(".tsx") && f !== "icons.tsx")
      .map((f) => resolve(src, "components", f)),
  ];
};

describe("every button surface reaches the app's button look", () => {
  const BUTTON_RULE = /\.cf-foot button,[\s\S]*?\{/;

  it("styles the buttons of the connection form's footer and every .btn", () => {
    const rule = CSS.match(BUTTON_RULE)?.[0] ?? "";
    expect(rule).toContain("button.btn,");
    expect(rule).toContain("button.primary");
  });

  // Issue #696: the legacy `.modal-actions` row gave way to the Dialog's
  // footer and the tool panels' `.panel-foot` (#769), in the OS order.
  it("has no legacy .modal-actions row left, in the CSS or the components", () => {
    expect(stripComments(CSS)).not.toContain("modal-actions");
    const using = componentFiles().filter((f) => readFileSync(f, "utf8").includes("modal-actions"));
    expect(using).toEqual([]);
  });

  // Issue #696: icons are the SVG set in components/icons.tsx, not characters
  // whose look depends on the font (or the emoji set) of the machine.
  it("draws no icon as a glyph or emoji in the components", () => {
    const GLYPHS = /[★☆●▲▼✓✔✕✖⚙]|\p{Extended_Pictographic}/u;
    const offenders = componentFiles().flatMap((f) =>
      stripComments(readFileSync(f, "utf8"))
        .replace(/^\s*\/\/.*$/gm, "")
        .split("\n")
        .filter((line) => GLYPHS.test(line))
        .map((line) => `${f.split(/[\\/]/).pop()}: ${line.trim()}`),
    );
    expect(offenders).toEqual([]);
  });

  // The "registro" grid style puts text cells back to plain ink, and that must
  // not override a colour the user picked on purpose (#483). The e2e caught it;
  // this is the cheap guard. `--cell-text` cannot answer "did the user choose
  // this?" because the theme defines it too, hence the separate variable.
  it("lets a chosen text colour through the registro style", () => {
    const rule = CSS.slice(CSS.indexOf(':root[data-grid-style="registro"] .cell-text'));
    expect(rule.slice(0, rule.indexOf("}"))).toContain("var(--cell-text-chosen, var(--text))");
  });

  it("draws the connection search as a floating balloon, not a sidebar panel", () => {
    // The sidebar clips (overflow:hidden), so an absolutely-positioned popover
    // wider than it would be cut off.
    const rule = CSS.slice(CSS.indexOf(".connbar-drop {"));
    expect(rule.slice(0, rule.indexOf("}"))).toMatch(/position: fixed/);
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

// Issue #687: the interface behaves like a desktop application, not a web page.
// Issue #694 (REDESIGN: sentence case everywhere): the editor's empty-state
// cards and the welcome's labels never shout.
describe("empty states and the welcome", () => {
  it("sets no label in capitals", () => {
    for (const sel of [".empty-card h4", ".welcome-label", ".empty-note-title"]) {
      const at = RULES.indexOf(`${sel} {`);
      expect(at, sel).toBeGreaterThan(-1);
      const body = RULES.slice(at, RULES.indexOf("}", at));
      expect(body, sel).not.toContain("uppercase");
    }
  });
});

// Issue #696 (REDESIGN: sentence case everywhere). No label shouts in capitals
// or letter-spaced caps; the label classes take their case from the theme's
// --label-case, which only C · Editorial sets (to lowercase).
describe("label case", () => {
  it("never sets text in capitals", () => {
    expect(stripComments(RULES)).not.toMatch(/text-transform:\s*uppercase/);
  });

  it("drops the letter-spacing that went with the capitals", () => {
    // A tight display title (negative) is not a caps label.
    const spaced = declarations(RULES, "letter-spacing").filter(
      (v) => v !== "inherit" && !v.startsWith("-"),
    );
    // The SUPER privilege chip and the notebook cell kind are literal
    // short codes, not labels.
    expect(spaced).toEqual(["0.04em", "0.04em"]);
  });

  it("cases the section and group labels from the theme", () => {
    for (const sel of [
      ".sidebar-header",
      ".sidebar-section-title",
      ".settings-section h3",
      ".field-group",
      ".cmdk-group-label",
      ".welcome-label",
      ".empty-card h4",
    ]) {
      const at = RULES.indexOf(`
${sel} {`);
      expect(at, sel).toBeGreaterThan(-1);
      const body = RULES.slice(at, RULES.indexOf("}", at));
      expect(body, sel).toContain("text-transform: var(--label-case);");
    }
  });
});

describe("styles.css desktop behaviour", () => {
  it("shows the arrow over controls and the hand only over real hyperlinks", () => {
    const pointers = Array.from(
      stripComments(RULES).matchAll(/([^{}]+)\{[^{}]*cursor:\s*pointer;/g),
      (m) => m[1].trim(),
    );
    expect(pointers).toEqual(["a[href]"]);
  });

  it("makes the chrome unselectable and re-enables selection where text is data", () => {
    expect(RULES).toMatch(/body \{[^}]*user-select: none;/);
    const selectable = RULES.match(/\n([^{}]*\.grid-cell,[^{}]*)\{[^}]*user-select: text;/);
    expect(selectable?.[1]).toContain("input,");
    expect(selectable?.[1]).toContain(".cm-editor,");
  });

  it("themes the scrollbars from the tokens", () => {
    expect(RULES).toMatch(/::-webkit-scrollbar-thumb \{\s+background: var\(--border\);/);
    expect(RULES).toContain("scrollbar-color: var(--border) transparent;");
  });
});

// Audit P4 (R-10, R-27, A-23, A-24, R-30): the accessibility floor.
describe("accessibility floor", () => {
  /** The body of the first rule whose selector list ends with `selector`. */
  const ruleBody = (selector: string): string => {
    const at = RULES.indexOf(`${selector} {\n`);
    expect(at, `${selector} has no rule`).toBeGreaterThanOrEqual(0);
    return RULES.slice(at, RULES.indexOf("}", at));
  };

  it("sets no text under 11px", () => {
    expect(CSS).toMatch(/ {2}--fs-micro: 11px;/);
    expect(CSS).not.toMatch(/font-size:\s*(?:[0-9]|10)px/);
  });

  it("draws the edge of every text field, dropdown and button with the 3:1 border", () => {
    for (const sel of [".field textarea", ":where(.dropdown)", ".field .dropdown", ".td-in", ".rd-nav-btn", ".grid-filter-input"]) {
      expect(ruleBody(sel), sel).toMatch(/border: 1px solid var\(--border-strong\);/);
    }
    // .edit-btn and .td-in are in those selector lists.
    expect(RULES).toMatch(/\.edit-btn,\n\.panel-icon-btn,\n\.rd-nav-btn \{/);
    expect(RULES).toMatch(/\.td-in,\n\.field input,/);
  });

  it("gives the explorer's and the toasts' icon buttons a 24px target", () => {
    expect(CSS).toContain("  --target-min: 24px;");
    for (const sel of [".objtree-refresh", ".app-toast-close"]) {
      const body = ruleBody(sel);
      expect(body, sel).toContain("min-width: var(--target-min);");
      expect(body, sel).toContain("min-height: var(--target-min);");
    }
  });

  it("keeps the toasts above the grid's pagination", () => {
    expect(ruleBody(".app-toast")).toContain("bottom: 64px;");
  });
});
