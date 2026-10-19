// A theme as data (issue #680). Until now a theme was a loose CSS block keyed on
// `data-theme`/`data-skin`, and two ideas coexisted: light/dark and "skins". Here
// a theme is ONE object with a complete light and a complete dark set of tokens;
// the stylesheet keeps reading `var(--x)` and the app writes the values of the
// active variant into a generated `<style>` block (see `themeCss`).
//
// Token names ARE the CSS custom properties without the `--`, so a theme file
// reads like the stylesheet does. Three properties are derived rather than
// stored, by a rule written down in `themeCss`: `--focus-ring` (the accent at an
// alpha), the two shadows (elevation is a matter of light/dark, not of theme)
// and `--font-ui` (from the `monoUi` flag).
//
// Everything here is pure: schema, validation, contrast checks and CSS
// generation. Persistence lives in themeStore.ts, the palettes in themes.ts.

import { contrastRatio, AA_NORMAL } from "./contrast";

/** The token groups, in the order a theme file lists them. */
export const TOKEN_GROUPS = {
  surfaces: ["bg", "bg-elev", "bg-elev2", "bg-overlay", "border"],
  text: ["text", "text-dim"],
  accent: ["accent", "accent-fg", "accent-hover", "accent-text"],
  states: ["error", "error-fg", "null", "number"],
  // Added with the M14 styles (#747): the control border that has to clear 3:1
  // (the hairline `border` is decorative), a third text level and the warning /
  // success colours. Optional in a theme file — see OPTIONAL_TOKENS.
  extended: ["border-strong", "text-faint", "warn", "ok"],
  cells: ["cell-null", "cell-number", "cell-text", "cell-temporal", "cell-bool", "cell-blob"],
  syntax: [
    "syntax-keyword",
    "syntax-string",
    "syntax-number",
    "syntax-null",
    "syntax-comment",
    "syntax-operator",
    "syntax-type",
    "syntax-name",
    "syntax-invalid",
  ],
  charts: ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6", "chart-7", "chart-8"],
} as const;

export type TokenName = (typeof TOKEN_GROUPS)[keyof typeof TOKEN_GROUPS][number];

/** Every token, flat, in group order. */
export const TOKEN_NAMES: readonly TokenName[] = Object.values(TOKEN_GROUPS).flat();

/** One variant: a `#rrggbb` colour per token. */
export type ThemeTokens = Record<TokenName, string>;

export type ThemeMode = "light" | "dark";

type ExtendedToken = (typeof TOKEN_GROUPS.extended)[number];

/**
 * The tokens a theme file may leave out, each with the older token it falls
 * back to. Files exported before #747 do not have them; every fallback already
 * meets the bar its token is held to (text-dim is text at 4.5:1, so it also
 * clears 3:1 as a control border).
 */
export const OPTIONAL_TOKENS: Readonly<Record<ExtendedToken, TokenName>> = {
  "border-strong": "text-dim",
  "text-faint": "text-dim",
  warn: "null",
  ok: "number",
};

/** A variant without the optional tokens, completed from their fallbacks. */
export function withOptionalTokens(
  t: Omit<ThemeTokens, ExtendedToken> & Partial<Record<ExtendedToken, string>>,
): ThemeTokens {
  const out = { ...t } as ThemeTokens;
  for (const [key, from] of Object.entries(OPTIONAL_TOKENS) as [ExtendedToken, TokenName][]) {
    out[key] ??= out[from];
  }
  return out;
}

/** Corner radii in px: controls, containers, dialogs. */
export interface ThemeRadius {
  sm: number;
  md: number;
  lg: number;
}

/** What a theme without its own typography or radii gets. */
export const DEFAULT_FONT_UI = 'system-ui, "Segoe UI", sans-serif';
export const DEFAULT_FONT_MONO = '"Cascadia Code", "Consolas", ui-monospace, monospace';
export const DEFAULT_RADIUS: ThemeRadius = { sm: 4, md: 8, lg: 12 };

export interface Theme {
  /** Stable slug, what settings store and what a palette key is built from. */
  id: string;
  /** Display name. Built-in themes are shown through i18n (`theme.<id>`). */
  name: string;
  /** Draw the whole UI in the monospace font (Terminal's half of the effect). */
  monoUi?: boolean;
  /** CSS font-family stacks for the UI and for code (#747); default stacks when absent. */
  fontUi?: string;
  fontMono?: string;
  /** Corner radii (#747); DEFAULT_RADIUS when absent. */
  radius?: ThemeRadius;
  /** How section and group labels are cased (#696): C · Editorial writes them
   *  in lowercase; absent = as written, in sentence case. Never uppercase. */
  labelCase?: "lowercase";
  light: ThemeTokens;
  dark: ThemeTokens;
}

/** Top-level keys a theme file may carry. */
const THEME_KEYS = ["id", "name", "monoUi", "fontUi", "fontMono", "radius", "labelCase", "light", "dark"];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const HEX_RE = /^#[0-9a-f]{6}$/;
/** A font-family list: names, quotes, commas. Nothing that could close the
 *  declaration it is written into (`;`, `}`, `(`…), since it lands in a <style>. */
const FONT_RE = /^[A-Za-z0-9 ,"'-]{1,200}$/;
const RADIUS_MAX = 24;

/** `#rgb` / `#rrggbb` (any case) normalised to lowercase `#rrggbb`, or null. */
export function normalizeHex(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return "#" + raw.slice(1).split("").map((c) => c + c).join("");
  }
  return HEX_RE.test(raw) ? raw : null;
}

// --- Validation -------------------------------------------------------------

/**
 * One thing wrong with a theme file. `code` is what the UI translates; `path`
 * says where (`dark.bg`, `light`, `id`…) and `value` what was found, when there
 * was something to show.
 */
export interface ThemeError {
  code: "json" | "not-object" | "missing" | "unknown" | "type" | "color" | "id";
  path: string;
  value?: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function validateTokens(data: unknown, path: string, errors: ThemeError[]): void {
  if (!isRecord(data)) {
    errors.push({ code: "type", path, value: data === undefined ? undefined : typeof data });
    return;
  }
  for (const key of TOKEN_NAMES) {
    if (!(key in data) && !(key in OPTIONAL_TOKENS)) errors.push({ code: "missing", path: `${path}.${key}` });
  }
  for (const [key, value] of Object.entries(data)) {
    const p = `${path}.${key}`;
    if (!(TOKEN_NAMES as readonly string[]).includes(key)) {
      errors.push({ code: "unknown", path: p });
    } else if (typeof value !== "string" || normalizeHex(value) === null) {
      errors.push({ code: "color", path: p, value: String(value) });
    }
  }
}

function validateRadius(data: unknown, errors: ThemeError[]): void {
  if (!isRecord(data)) {
    errors.push({ code: "type", path: "radius", value: typeof data });
    return;
  }
  for (const key of Object.keys(data)) {
    if (!["sm", "md", "lg"].includes(key)) errors.push({ code: "unknown", path: `radius.${key}` });
  }
  for (const key of ["sm", "md", "lg"]) {
    const v = data[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > RADIUS_MAX) {
      errors.push({ code: "type", path: `radius.${key}`, value: String(v) });
    }
  }
}

/**
 * Everything wrong with `data` as a theme: unknown keys, missing keys, colours
 * that are not `#rgb`/`#rrggbb`, a malformed id. An empty list means valid.
 */
export function validateTheme(data: unknown): ThemeError[] {
  const errors: ThemeError[] = [];
  if (!isRecord(data)) return [{ code: "not-object", path: "" }];
  for (const key of Object.keys(data)) {
    if (!THEME_KEYS.includes(key)) errors.push({ code: "unknown", path: key });
  }
  if (typeof data.id !== "string" || !ID_RE.test(data.id)) {
    errors.push({ code: "id", path: "id", value: data.id === undefined ? undefined : String(data.id) });
  }
  if (typeof data.name !== "string" || data.name.trim() === "") {
    errors.push({ code: "type", path: "name" });
  }
  if (data.monoUi !== undefined && typeof data.monoUi !== "boolean") {
    errors.push({ code: "type", path: "monoUi", value: typeof data.monoUi });
  }
  for (const key of ["fontUi", "fontMono"]) {
    const v = data[key];
    if (v !== undefined && (typeof v !== "string" || !FONT_RE.test(v))) {
      errors.push({ code: "type", path: key, value: String(v) });
    }
  }
  if (data.radius !== undefined) validateRadius(data.radius, errors);
  if (data.labelCase !== undefined && data.labelCase !== "lowercase") {
    errors.push({ code: "type", path: "labelCase", value: String(data.labelCase) });
  }
  validateTokens(data.light, "light", errors);
  validateTokens(data.dark, "dark", errors);
  return errors;
}

/** Parse a theme file. Valid → the theme with colours normalised; else the errors. */
export function parseThemeJson(text: string): { theme: Theme | null; errors: ThemeError[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { theme: null, errors: [{ code: "json", path: "" }] };
  }
  const errors = validateTheme(data);
  if (errors.length > 0) return { theme: null, errors };
  const d = data as Record<string, unknown>;
  const norm = (tokens: Record<string, string>): ThemeTokens => {
    const out = {} as ThemeTokens;
    for (const key of TOKEN_NAMES) if (key in tokens) out[key] = normalizeHex(tokens[key])!;
    return withOptionalTokens(out);
  };
  const theme: Theme = {
    id: d.id as string,
    name: (d.name as string).trim(),
    light: norm(d.light as Record<string, string>),
    dark: norm(d.dark as Record<string, string>),
  };
  if (d.monoUi === true) theme.monoUi = true;
  if (typeof d.fontUi === "string") theme.fontUi = d.fontUi;
  if (typeof d.fontMono === "string") theme.fontMono = d.fontMono;
  if (d.radius !== undefined) {
    const r = d.radius as ThemeRadius;
    theme.radius = { sm: r.sm, md: r.md, lg: r.lg };
  }
  if (d.labelCase === "lowercase") theme.labelCase = "lowercase";
  return { theme, errors: [] };
}

/** The theme as a file: stable key order, two-space indent. */
export function serializeTheme(theme: Theme): string {
  const ordered = (t: ThemeTokens) =>
    Object.fromEntries(TOKEN_NAMES.map((k) => [k, t[k]]));
  return JSON.stringify(
    {
      id: theme.id,
      name: theme.name,
      ...(theme.monoUi ? { monoUi: true } : {}),
      ...(theme.fontUi ? { fontUi: theme.fontUi } : {}),
      ...(theme.fontMono ? { fontMono: theme.fontMono } : {}),
      ...(theme.radius ? { radius: theme.radius } : {}),
      ...(theme.labelCase ? { labelCase: theme.labelCase } : {}),
      light: ordered(theme.light),
      dark: ordered(theme.dark),
    },
    null,
    2,
  );
}

// --- Contrast ----------------------------------------------------------------

/** Where text is painted; every text token has to read on all of them. */
const SURFACES: TokenName[] = ["bg", "bg-elev", "bg-elev2", "bg-overlay"];

/** Tokens drawn AS TEXT on the surfaces (so AA normal text, 4.5:1, applies). */
const AS_TEXT: TokenName[] = [
  ...TOKEN_GROUPS.text,
  "accent-text",
  ...TOKEN_GROUPS.states.filter((t) => t !== "error-fg"),
  "text-faint",
  "warn",
  "ok",
  ...TOKEN_GROUPS.cells,
  ...TOKEN_GROUPS.syntax,
];

/** Minimum for non-text UI (focus ring, accent borders): WCAG 1.4.11. */
export const AA_UI = 3;

export interface ContrastIssue {
  mode: ThemeMode;
  fg: TokenName;
  bg: TokenName;
  ratio: number;
  min: number;
}

/**
 * Every key pair of `theme` that falls under WCAG AA: text tokens on each
 * surface (4.5:1), the ink on an accent/error fill (4.5:1) and the accent itself
 * on each surface as the focus ring and accent borders, and `border-strong` as
 * the edge of a control (3:1). Empty = passes.
 *
 * Deliberately NOT checked: `border` (a decorative hairline, every theme today
 * is under 3:1 by design) and the chart series (fills judged against each other
 * by the dataviz palette, not against the canvas as text).
 */
export function contrastIssues(theme: Theme): ContrastIssue[] {
  const out: ContrastIssue[] = [];
  const check = (mode: ThemeMode, fg: TokenName, bg: TokenName, min: number) => {
    const t = theme[mode];
    const ratio = contrastRatio(t[fg], t[bg]);
    if (ratio < min) out.push({ mode, fg, bg, ratio: Math.round(ratio * 100) / 100, min });
  };
  for (const mode of ["light", "dark"] as ThemeMode[]) {
    for (const surface of SURFACES) {
      for (const fg of AS_TEXT) check(mode, fg, surface, AA_NORMAL);
      check(mode, "accent", surface, AA_UI);
      check(mode, "border-strong", surface, AA_UI);
    }
    check(mode, "accent-fg", "accent", AA_NORMAL);
    check(mode, "error-fg", "error", AA_NORMAL);
  }
  return out;
}

// --- CSS ---------------------------------------------------------------------

/** `#rrggbb` → `rgba(r, g, b, alpha)`. */
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * The custom properties one variant sets on `:root`: every token as `--<name>`,
 * plus the derived ones.
 *
 *  - `--focus-ring`: the accent at 0.4 alpha in dark, 0.32 in light — the
 *    values every palette used by hand.
 *  - `--shadow-sm` / `--shadow-lg`: by mode. On a light canvas a black shadow at
 *    50 % reads as dirt, not elevation, so light is neutral-cool and softer.
 *  - `--font-ui`: the monospace stack when `monoUi`, else the system one.
 *  - `--font-theme-ui` / `--font-mono`: the theme's stacks (#747). The user's
 *    own font, when set, goes in front of them (typography.ts).
 *  - `--r-sm` / `--r-md` / `--r-lg`: the theme's radii.
 *  - `--label-case`: `text-transform` for the label classes (#696), `none`
 *    unless the theme asks for lowercase.
 *  - `--accent-soft`, `--error-soft`, `--warn-soft`, `--ok-soft`: the colour at
 *    a low alpha, for a tinted background under text of that colour.
 */
export function themeVariables(theme: Theme, mode: ThemeMode): Record<string, string> {
  const t = theme[mode];
  const vars: Record<string, string> = {};
  for (const key of TOKEN_NAMES) vars[`--${key}`] = t[key];
  vars["--focus-ring"] = withAlpha(t.accent, mode === "dark" ? 0.4 : 0.32);
  if (mode === "dark") {
    vars["--shadow-sm"] = "0 4px 16px rgba(0, 0, 0, 0.35)";
    vars["--shadow-lg"] = "0 12px 40px rgba(0, 0, 0, 0.5)";
  } else {
    vars["--shadow-sm"] = "0 4px 16px rgba(20, 22, 30, 0.12)";
    vars["--shadow-lg"] = "0 12px 40px rgba(20, 22, 30, 0.18)";
  }
  vars["--font-ui"] = theme.monoUi ? "var(--font-mono)" : "var(--font-system)";
  vars["--font-theme-ui"] = theme.fontUi ?? DEFAULT_FONT_UI;
  vars["--font-mono"] = theme.fontMono ?? DEFAULT_FONT_MONO;
  const r = theme.radius ?? DEFAULT_RADIUS;
  vars["--r-sm"] = `${r.sm}px`;
  vars["--r-md"] = `${r.md}px`;
  vars["--r-lg"] = `${r.lg}px`;
  vars["--label-case"] = theme.labelCase ?? "none";
  const soft = mode === "dark" ? 0.14 : 0.1;
  for (const key of ["accent", "error", "warn", "ok"] as const) {
    vars[`--${key}-soft`] = withAlpha(t[key], soft);
  }
  return vars;
}

/** A `:root { … }` block with `themeVariables`, for a generated `<style>`. */
export function themeCss(theme: Theme, mode: ThemeMode): string {
  const body = Object.entries(themeVariables(theme, mode))
    .map(([k, v]) => `  ${k}: ${v};`)
    .join("\n");
  return `:root {\n${body}\n}\n`;
}
