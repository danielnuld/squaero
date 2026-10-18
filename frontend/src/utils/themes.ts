// The built-in themes as data (issue #680). These are the palettes that lived in
// styles.css as `:root[data-theme]` / `:root[data-skin]` blocks, value for value:
// nothing here looks different from before, it is only expressed as tokens.
//
// How the old model maps onto this one:
//
//  - "indigo" (brand) and "blue" were ACCENT skins over light or dark → two
//    themes, each with both variants (blue = indigo with its accent swapped).
//  - "ciruela", "pizarra" and "terminal" owned their surfaces and had NO light
//    variant (the preference was held at dark). A half-made light Terminal would
//    be worse than none, and the visual direction (#678) is not decided, so their
//    light variant is PAIRED with the default light palette; themeStore's
//    migration moves those users to dark mode so they keep seeing what they saw.
//  - "contrast" is new: light and dark, AAA for text where reasonable.
//
// Syntax tokens did not exist before — the editor read `--accent-text`,
// `--number`, `--null`, `--text-dim`, `--text` and `--error` directly — so
// `withSyntax` fills them from exactly those, which is why the editor paints the
// same colours it did.

import type { Theme, ThemeTokens, TokenName } from "./themeSchema";

type Base = Omit<ThemeTokens, (typeof SYNTAX)[number]>;

const SYNTAX = [
  "syntax-keyword",
  "syntax-string",
  "syntax-number",
  "syntax-null",
  "syntax-comment",
  "syntax-operator",
  "syntax-type",
  "syntax-name",
  "syntax-invalid",
] as const satisfies readonly TokenName[];

/** The editor's colours as they were: each syntax role on the token it used. */
function withSyntax(t: Base): ThemeTokens {
  return {
    ...t,
    "syntax-keyword": t["accent-text"],
    "syntax-string": t.number,
    "syntax-number": t.number,
    "syntax-null": t.null,
    "syntax-comment": t["text-dim"],
    "syntax-operator": t["text-dim"],
    "syntax-type": t["accent-text"],
    "syntax-name": t.text,
    "syntax-invalid": t.error,
  };
}

/* Categorical chart palette (issue #149): the validated 8-hue dataviz theme.
   Assigned to series in fixed order, never cycled. */
const CHART_DARK = {
  "chart-1": "#3987e5",
  "chart-2": "#199e70",
  "chart-3": "#c98500",
  "chart-4": "#008300",
  "chart-5": "#9085e9",
  "chart-6": "#e66767",
  "chart-7": "#d55181",
  "chart-8": "#d95926",
};
const CHART_LIGHT = {
  "chart-1": "#2a78d6",
  "chart-2": "#1baf7a",
  "chart-3": "#eda100",
  "chart-4": "#008300",
  "chart-5": "#4a3aa7",
  "chart-6": "#e34948",
  "chart-7": "#e87ba4",
  "chart-8": "#eb6834",
};

/* Brand indigo, dark. --accent-fg is dark ink on the light-indigo accent (4.75,
   AA); --accent-text is the lighter indigo that clears 4.5 as TEXT on the
   lightest dark surface (#220). The cell colours were measured against the
   three surfaces (#483). */
const INDIGO_DARK: Base = {
  bg: "#1e1e24",
  "bg-elev": "#26262e",
  "bg-elev2": "#2e2e38",
  "bg-overlay": "#2e2e38",
  border: "#3a3a46",
  text: "#e6e6ec",
  "text-dim": "#9a9aa6",
  accent: "#7c7cf0",
  "accent-fg": "#1e1e24",
  "accent-hover": "#9a9aff",
  "accent-text": "#9090f5",
  error: "#f08a8a",
  "error-fg": "#1e1e24",
  null: "#d98a4b",
  number: "#8fd0a0",
  "cell-null": "#d98a4b",
  "cell-number": "#8fd0a0",
  "cell-text": "#6ba1c7",
  "cell-temporal": "#b987d1",
  "cell-bool": "#c49331",
  "cell-blob": "#55a6ad",
  ...CHART_DARK,
};

/* Brand indigo, light. The data canvas is the white that holds the eye and the
   chrome sits on a tinted grey — the relation the dark theme already had. */
const INDIGO_LIGHT: Base = {
  bg: "#ffffff",
  "bg-elev": "#f2f4f7",
  "bg-elev2": "#e6e9ef",
  "bg-overlay": "#ffffff",
  border: "#d3d3dc",
  text: "#1e1e24",
  "text-dim": "#63636f",
  accent: "#5b5bd6",
  "accent-fg": "#ffffff",
  "accent-hover": "#4a4ac4",
  "accent-text": "#4a4ac4",
  error: "#c62828",
  "error-fg": "#ffffff",
  null: "#9c5416",
  number: "#1d6e3f",
  "cell-null": "#9c5416",
  "cell-number": "#1d6e3f",
  "cell-text": "#266999",
  "cell-temporal": "#9438c2",
  "cell-bool": "#8d5a14",
  "cell-blob": "#2e6d7a",
  ...CHART_LIGHT,
};

const indigo: Theme = {
  id: "indigo",
  name: "Squaero (indigo)",
  light: withSyntax(INDIGO_LIGHT),
  dark: withSyntax(INDIGO_DARK),
};

/* A professional blue over the same surfaces: only the accent tokens differ.
   White on #2f6fed = 4.55; dark ink on #5b9bff = 6.9 (#220 discipline). */
const blue: Theme = {
  id: "blue",
  name: "Blue",
  light: withSyntax({
    ...INDIGO_LIGHT,
    accent: "#2f6fed",
    "accent-fg": "#ffffff",
    "accent-hover": "#245fd0",
    "accent-text": "#2861d6",
  }),
  dark: withSyntax({
    ...INDIGO_DARK,
    accent: "#5b9bff",
    "accent-fg": "#0c1015",
    "accent-hover": "#7db0ff",
    "accent-text": "#7fb2ff",
  }),
};

/* Ciruela: dark pink. The tint lives in the chrome — tree, headers, bars — and
   the data canvas stays below it (#473). */
const ciruela: Theme = {
  id: "ciruela",
  name: "Ciruela",
  light: indigo.light,
  dark: withSyntax({
    bg: "#20141b",
    "bg-elev": "#2b1a25",
    "bg-elev2": "#3a2231",
    "bg-overlay": "#3a2231",
    border: "#573349",
    text: "#f7e6ef",
    "text-dim": "#c39cae",
    accent: "#ff8ec2",
    "accent-fg": "#20141b",
    "accent-hover": "#ffb3d5",
    "accent-text": "#ff9ecb",
    error: "#ff9494",
    "error-fg": "#20141b",
    null: "#e2a05e",
    number: "#83d9b1",
    "cell-null": "#e2a05e",
    "cell-number": "#83d9b1",
    "cell-text": "#c381a2",
    "cell-temporal": "#ba7ece",
    "cell-bool": "#c68831",
    "cell-blob": "#6f9bb1",
    ...CHART_DARK,
  }),
};

/* Pizarra: cold graphite, no brand tint, a muted steel blue that does not
   compete with the data. */
const pizarra: Theme = {
  id: "pizarra",
  name: "Pizarra",
  light: indigo.light,
  dark: withSyntax({
    bg: "#181b1f",
    "bg-elev": "#1f2329",
    "bg-elev2": "#282d34",
    "bg-overlay": "#282d34",
    border: "#3a4149",
    text: "#e3e7ec",
    "text-dim": "#99a3ad",
    accent: "#79b0d8",
    "accent-fg": "#111418",
    "accent-hover": "#9bc6e4",
    "accent-text": "#8dbbe0",
    error: "#f08a8a",
    "error-fg": "#111418",
    null: "#d69a56",
    number: "#8ed0ad",
    "cell-null": "#d69a56",
    "cell-number": "#8ed0ad",
    "cell-text": "#729dbb",
    "cell-temporal": "#ad8ac7",
    "cell-bool": "#bb923e",
    "cell-blob": "#67a1ad",
    ...CHART_DARK,
  }),
};

/* Terminal: near black with phosphor green; cyan numbers and amber NULL from a
   terminal's vocabulary, and the whole UI in monospace (half the effect). */
const terminal: Theme = {
  id: "terminal",
  name: "Terminal",
  monoUi: true,
  light: indigo.light,
  dark: withSyntax({
    bg: "#0a0e0d",
    "bg-elev": "#101715",
    "bg-elev2": "#16211d",
    "bg-overlay": "#16211d",
    border: "#243b32",
    text: "#d3e6d8",
    "text-dim": "#7fa38c",
    accent: "#35e07f",
    "accent-fg": "#08120c",
    "accent-hover": "#5cf09a",
    "accent-text": "#4fd98d",
    error: "#ff7b7b",
    "error-fg": "#08120c",
    null: "#e0a13c",
    number: "#58d3e8",
    "cell-null": "#e0a13c",
    "cell-number": "#58d3e8",
    "cell-text": "#529875",
    "cell-temporal": "#3a998a",
    "cell-bool": "#968d2c",
    "cell-blob": "#43969d",
    ...CHART_DARK,
  }),
};

/* High contrast (new in #680). Every text token clears AAA (7:1) on every
   surface; the ink on the accent and error fills clears AAA too. Borders are
   real lines here (≥ 3:1), not hairlines. */
const contrast: Theme = {
  id: "contrast",
  name: "High contrast",
  light: withSyntax({
    bg: "#ffffff",
    "bg-elev": "#f2f2f2",
    "bg-elev2": "#e4e4e4",
    "bg-overlay": "#ffffff",
    border: "#5c5c5c",
    text: "#000000",
    "text-dim": "#333333",
    accent: "#2b2bb0",
    "accent-fg": "#ffffff",
    "accent-hover": "#1e1e8c",
    "accent-text": "#2424a4",
    error: "#8c0000",
    "error-fg": "#ffffff",
    null: "#703700",
    number: "#004d22",
    "cell-null": "#703700",
    "cell-number": "#004d22",
    "cell-text": "#00457a",
    "cell-temporal": "#60008a",
    "cell-bool": "#5e3c00",
    "cell-blob": "#004a52",
    "chart-1": "#1a5db5",
    "chart-2": "#0c7a52",
    "chart-3": "#8a5a00",
    "chart-4": "#006000",
    "chart-5": "#4a3aa7",
    "chart-6": "#b3302f",
    "chart-7": "#a8336a",
    "chart-8": "#b2451b",
  }),
  dark: withSyntax({
    bg: "#000000",
    "bg-elev": "#101010",
    "bg-elev2": "#1c1c1c",
    "bg-overlay": "#1c1c1c",
    border: "#9a9a9a",
    text: "#ffffff",
    "text-dim": "#d4d4d4",
    accent: "#a8a8ff",
    "accent-fg": "#000000",
    "accent-hover": "#c6c6ff",
    "accent-text": "#b8b8ff",
    error: "#ff9d9d",
    "error-fg": "#000000",
    null: "#ffb870",
    number: "#9df2b4",
    "cell-null": "#ffb870",
    "cell-number": "#9df2b4",
    "cell-text": "#9ccfff",
    "cell-temporal": "#e2b3ff",
    "cell-bool": "#ffd36b",
    "cell-blob": "#8ee7ee",
    "chart-1": "#7fb4ff",
    "chart-2": "#6fe0b0",
    "chart-3": "#ffc44d",
    "chart-4": "#7ee07e",
    "chart-5": "#c0b8ff",
    "chart-6": "#ff9d9d",
    "chart-7": "#ff9ac0",
    "chart-8": "#ffa07a",
  }),
};

/** The built-in themes in picker order. */
export const BUILTIN_THEMES: readonly Theme[] = [indigo, blue, ciruela, pizarra, terminal, contrast];

/** The brand default. */
export const DEFAULT_THEME_ID = "indigo";

export const isBuiltinTheme = (id: string): boolean => BUILTIN_THEMES.some((t) => t.id === id);
