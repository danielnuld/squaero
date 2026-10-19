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
//
// The four M14 styles (#747, decided in #678 — docs/design/m14/) come first:
// B · Nativo (the default), A · Quiet pro, C · Editorial and Rosa pastel. Each is
// written in the prototype's vocabulary (`theme-helmet.txt`, chrome / content /
// danger…) and mapped onto the app's tokens by `fromStyle`. The prototype only
// drew one variant of each; the other one is derived here and held to the same
// AA checks (tests/utils/themeSchema.test.ts).

import {
  withOptionalTokens,
  type Theme,
  type ThemeTokens,
  type TokenName,
} from "./themeSchema";

type Extended = "border-strong" | "text-faint" | "warn" | "ok";
type Base = Omit<ThemeTokens, (typeof SYNTAX)[number] | Extended> & Partial<Pick<ThemeTokens, Extended>>;

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
  return withOptionalTokens({
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
  });
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

// --- The M14 styles (#747) ---------------------------------------------------

/** One variant of a style, in the prototype's names (theme-helmet.txt). */
interface StylePalette {
  chrome: string;
  "chrome-2": string;
  content: string;
  overlay: string;
  border: string;
  "border-strong": string;
  text: string;
  "text-dim": string;
  "text-faint": string;
  accent: string;
  "accent-fg": string;
  "accent-text": string;
  danger: string;
  "danger-fg": string;
  warn: string;
  ok: string;
  null: string;
  "type-dot-bool": string;
  "syntax-keyword": string;
  "syntax-string": string;
  "syntax-number": string;
  "syntax-comment": string;
  "syntax-function": string;
}

/**
 * Prototype names → app tokens. The data canvas is `content` (`--bg`), the
 * chrome around it `--bg-elev` and its hover step `--bg-elev2`. Values in the
 * grid read in the text colour, as the prototype draws them; only NULL, booleans
 * and binary keep a colour of their own.
 */
function fromStyle(p: StylePalette, charts: Record<string, string>): ThemeTokens {
  return {
    bg: p.content,
    "bg-elev": p.chrome,
    "bg-elev2": p["chrome-2"],
    "bg-overlay": p.overlay,
    border: p.border,
    text: p.text,
    "text-dim": p["text-dim"],
    accent: p.accent,
    "accent-fg": p["accent-fg"],
    "accent-hover": p["accent-text"],
    "accent-text": p["accent-text"],
    error: p.danger,
    "error-fg": p["danger-fg"],
    null: p.null,
    number: p["syntax-number"],
    "border-strong": p["border-strong"],
    "text-faint": p["text-faint"],
    warn: p.warn,
    ok: p.ok,
    "cell-null": p.null,
    "cell-number": p.text,
    "cell-text": p.text,
    "cell-temporal": p.text,
    "cell-bool": p["type-dot-bool"],
    "cell-blob": p["text-dim"],
    "syntax-keyword": p["syntax-keyword"],
    "syntax-string": p["syntax-string"],
    "syntax-number": p["syntax-number"],
    "syntax-null": p.null,
    "syntax-comment": p["syntax-comment"],
    "syntax-operator": p["text-dim"],
    "syntax-type": p["syntax-function"],
    "syntax-name": p.text,
    "syntax-invalid": p.danger,
    ...charts,
  } as ThemeTokens;
}

/* B · Nativo: light and plain, the system's own font. Light is the prototype's
   (with the contrast fixes of audit R-09/R-10: text-faint and the control
   border darkened), plus one more step on danger, ok/string and the function
   colour so they also clear 4.5:1 on the hover surface (--bg-elev2), which the
   prototype did not measure. Dark is derived: a neutral graphite in the spirit of the
   Windows/macOS dark chrome, with the same teal lifted until it reads. */
const nativo: Theme = {
  id: "nativo",
  name: "B · Nativo",
  fontUi: '"Segoe UI Variable Text", "Segoe UI", -apple-system, BlinkMacSystemFont, system-ui, Cantarell, sans-serif',
  fontMono: '"JetBrains Mono", ui-monospace, monospace',
  radius: { sm: 6, md: 8, lg: 12 },
  light: fromStyle(
    {
      chrome: "#e9edf1",
      "chrome-2": "#dfe5ea",
      content: "#ffffff",
      overlay: "#ffffff",
      border: "#dde2e7",
      "border-strong": "#7a838e",
      text: "#1b1f24",
      "text-dim": "#59626e",
      "text-faint": "#5b646e",
      accent: "#0f7b72",
      "accent-fg": "#ffffff",
      "accent-text": "#0c6b63",
      danger: "#b42a25",
      "danger-fg": "#ffffff",
      warn: "#8f4400",
      ok: "#1a6f38",
      null: "#59626e",
      "type-dot-bool": "#a14d00",
      "syntax-keyword": "#1f4fd1",
      "syntax-string": "#1a6f38",
      "syntax-number": "#a14d00",
      "syntax-comment": "#5b646e",
      "syntax-function": "#0c6b63",
    },
    CHART_LIGHT,
  ),
  dark: fromStyle(
    {
      chrome: "#1f2226",
      "chrome-2": "#2a2e33",
      content: "#191b1f",
      overlay: "#262a2f",
      border: "#33383f",
      "border-strong": "#737c87",
      text: "#e6e9ed",
      "text-dim": "#a3abb5",
      "text-faint": "#959ea9",
      accent: "#2eb3a5",
      "accent-fg": "#04201c",
      "accent-text": "#4fc9bc",
      danger: "#f28b82",
      "danger-fg": "#2a0a0c",
      warn: "#f0a868",
      ok: "#7fcf9a",
      null: "#a3abb5",
      "type-dot-bool": "#f0a868",
      "syntax-keyword": "#82aaff",
      "syntax-string": "#9ccf8a",
      "syntax-number": "#f0a868",
      "syntax-comment": "#959ea9",
      "syntax-function": "#4fc9bc",
    },
    CHART_DARK,
  ),
};

/* A · Quiet pro: cold dark for long days, Geist. Dark is the prototype's; light
   is derived — the same cool greys inverted, the teal deepened for white ink. */
const quiet: Theme = {
  id: "quiet",
  name: "A · Quiet pro",
  fontUi: '"Geist", system-ui, sans-serif',
  fontMono: '"Geist Mono", ui-monospace, monospace',
  radius: { sm: 4, md: 6, lg: 8 },
  light: fromStyle(
    {
      chrome: "#eceff2",
      "chrome-2": "#e1e5ea",
      content: "#fafbfc",
      overlay: "#ffffff",
      border: "#d9dee4",
      "border-strong": "#757f8b",
      text: "#14181e",
      "text-dim": "#535d6a",
      "text-faint": "#59636f",
      accent: "#0e746b",
      "accent-fg": "#ffffff",
      "accent-text": "#0b635b",
      danger: "#bf2f38",
      "danger-fg": "#ffffff",
      warn: "#8f4400",
      ok: "#1d7340",
      null: "#535d6a",
      "type-dot-bool": "#94470a",
      "syntax-keyword": "#2f55c8",
      "syntax-string": "#2c6e1f",
      "syntax-number": "#94470a",
      "syntax-comment": "#59636f",
      "syntax-function": "#0b635b",
    },
    CHART_LIGHT,
  ),
  dark: fromStyle(
    {
      chrome: "#0c0f12",
      "chrome-2": "#13171c",
      content: "#0f1216",
      overlay: "#1a1f26",
      border: "#232a33",
      "border-strong": "#5f6a78",
      text: "#e6e9ee",
      "text-dim": "#939dab",
      "text-faint": "#828c99",
      accent: "#3fb8a9",
      "accent-fg": "#04201c",
      "accent-text": "#5fd0c2",
      danger: "#f07178",
      "danger-fg": "#2a0a0c",
      warn: "#f5a97f",
      ok: "#8fd6a8",
      null: "#939dab",
      "type-dot-bool": "#f5a97f",
      "syntax-keyword": "#7aa2f7",
      "syntax-string": "#a6d189",
      "syntax-number": "#f5a97f",
      "syntax-comment": "#828c99",
      "syntax-function": "#3fb8a9",
    },
    CHART_DARK,
  ),
};

/* C · Editorial: warm dark, technical, IBM Plex, square corners. Dark is the
   prototype's; light is derived — warm paper with the amber taken down to an
   ochre that carries white ink. */
const editorial: Theme = {
  id: "editorial",
  name: "C · Editorial",
  fontUi: '"IBM Plex Sans", system-ui, sans-serif',
  fontMono: '"IBM Plex Mono", ui-monospace, monospace',
  radius: { sm: 2, md: 2, lg: 2 },
  light: fromStyle(
    {
      chrome: "#f1ebdf",
      "chrome-2": "#e8dfcf",
      content: "#fbf8f2",
      overlay: "#fffdf9",
      border: "#e0d6c4",
      "border-strong": "#8a7a5c",
      text: "#2a2318",
      "text-dim": "#63573f",
      "text-faint": "#665b47",
      accent: "#875800",
      "accent-fg": "#ffffff",
      "accent-text": "#744b00",
      danger: "#ad3520",
      "danger-fg": "#ffffff",
      warn: "#8f400f",
      ok: "#47661c",
      null: "#63573f",
      "type-dot-bool": "#744b00",
      "syntax-keyword": "#744b00",
      "syntax-string": "#47661c",
      "syntax-number": "#1f5a85",
      "syntax-comment": "#665b47",
      "syntax-function": "#7a4f12",
    },
    CHART_LIGHT,
  ),
  dark: fromStyle(
    {
      chrome: "#120f0b",
      "chrome-2": "#1b1712",
      content: "#17140f",
      overlay: "#221d16",
      border: "#2f281f",
      "border-strong": "#75684f",
      text: "#efe6d6",
      "text-dim": "#ab9f87",
      "text-faint": "#958a74",
      accent: "#e0a43c",
      "accent-fg": "#1d1505",
      "accent-text": "#ecb85e",
      danger: "#e46a4f",
      "danger-fg": "#1d0905",
      warn: "#d9905a",
      ok: "#a9c77e",
      null: "#ab9f87",
      "type-dot-bool": "#e0a43c",
      "syntax-keyword": "#e0a43c",
      "syntax-string": "#a9c77e",
      "syntax-number": "#8fc1e3",
      "syntax-comment": "#958a74",
      "syntax-function": "#e6c07b",
    },
    CHART_DARK,
  ),
};

/* Rosa pastel: light and soft, Figtree, wide corners. Light is the prototype's,
   with text-faint/comments, keyword, function and the control border a step
   darker so they clear AA on --bg-elev2 too. Dark is derived — a deep plum with the pink lifted to a pastel that reads. */
const rosa: Theme = {
  id: "rosa",
  name: "Rosa pastel",
  fontUi: '"Figtree", system-ui, sans-serif',
  fontMono: '"JetBrains Mono", ui-monospace, monospace',
  radius: { sm: 8, md: 12, lg: 16 },
  light: fromStyle(
    {
      chrome: "#fbe7ef",
      "chrome-2": "#f7dbe6",
      content: "#fffafc",
      overlay: "#ffffff",
      border: "#f0d6e1",
      "border-strong": "#98708a",
      text: "#3b2430",
      "text-dim": "#77566a",
      "text-faint": "#785868",
      accent: "#c2477a",
      "accent-fg": "#ffffff",
      "accent-text": "#9a3060",
      danger: "#b8322b",
      "danger-fg": "#ffffff",
      warn: "#9a4520",
      ok: "#24684b",
      null: "#77566a",
      "type-dot-bool": "#9a4520",
      "syntax-keyword": "#a8346b",
      "syntax-string": "#24684b",
      "syntax-number": "#9a4520",
      "syntax-comment": "#785868",
      "syntax-function": "#7046bf",
    },
    CHART_LIGHT,
  ),
  dark: fromStyle(
    {
      chrome: "#2a1a22",
      "chrome-2": "#35222c",
      content: "#22151c",
      overlay: "#311f29",
      border: "#47313d",
      "border-strong": "#8c6a7c",
      text: "#f6e6ee",
      "text-dim": "#cda9bb",
      "text-faint": "#c09cae",
      accent: "#f08cb5",
      "accent-fg": "#2a0f1b",
      "accent-text": "#f6a6c8",
      danger: "#ff8a80",
      "danger-fg": "#2a0a0c",
      warn: "#f2ab7e",
      ok: "#8fd3b0",
      null: "#cda9bb",
      "type-dot-bool": "#f2ab7e",
      "syntax-keyword": "#f08cb5",
      "syntax-string": "#8fd3b0",
      "syntax-number": "#f2ab7e",
      "syntax-comment": "#c09cae",
      "syntax-function": "#c9a8ff",
    },
    CHART_DARK,
  ),
};

/** The four M14 styles, in the order Settings › Appearance shows them. */
export const STYLE_THEME_IDS: readonly string[] = ["nativo", "quiet", "editorial", "rosa"];

/** The built-in themes in picker order: the M14 styles, then the earlier themes. */
export const BUILTIN_THEMES: readonly Theme[] = [
  nativo,
  quiet,
  editorial,
  rosa,
  indigo,
  blue,
  ciruela,
  pizarra,
  terminal,
  contrast,
];

/** The default for a new install (#747): B · Nativo. */
export const DEFAULT_THEME_ID = "nativo";

export const isBuiltinTheme = (id: string): boolean => BUILTIN_THEMES.some((t) => t.id === id);
