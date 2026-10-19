// Typography and interface zoom (issue #681). Pure: the zoom steps, the type
// scale a base size and a zoom produce, the row heights the virtualized lists
// derive from them, and the sanitizer that turns what the user typed into a
// CSS font-family list that cannot carry anything but family names. App writes
// the result inline on the root (applyTypography), so the stylesheet keeps its
// own values as the default and nothing changes until a setting does.

import type { Density, Settings } from "./settings";

/** Zoom steps, in percent. Ctrl+= / Ctrl+- walk this list; Ctrl+0 goes to 100. */
export const ZOOM_STEPS: readonly number[] = [80, 90, 100, 110, 125, 150, 175, 200];
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
export const DEFAULT_ZOOM = 100;

/** Clamp a zoom percentage to [MIN_ZOOM, MAX_ZOOM]; non-finite → 100. */
export function clampZoom(z: number): number {
  if (!Number.isFinite(z)) return DEFAULT_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(z)));
}

/** The next step above `z` (MAX_ZOOM when already at or past the top). */
export function nextZoom(z: number): number {
  const cur = clampZoom(z);
  return ZOOM_STEPS.find((s) => s > cur) ?? MAX_ZOOM;
}

/** The step below `z` (MIN_ZOOM when already at or below the bottom). */
export function prevZoom(z: number): number {
  const cur = clampZoom(z);
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i--) {
    if (ZOOM_STEPS[i] < cur) return ZOOM_STEPS[i];
  }
  return MIN_ZOOM;
}

/** Bounds for a font size setting (px) and for the editor's line height. */
export const MIN_FONT_PX = 8;
export const MAX_FONT_PX = 32;
export const MIN_LINE_HEIGHT = 1;
export const MAX_LINE_HEIGHT = 2.5;

export function clampFontSize(px: number, fallback: number): number {
  if (!Number.isFinite(px)) return fallback;
  return Math.min(MAX_FONT_PX, Math.max(MIN_FONT_PX, Math.round(px)));
}

export function clampLineHeight(lh: number, fallback: number): number {
  if (!Number.isFinite(lh)) return fallback;
  return Math.min(MAX_LINE_HEIGHT, Math.max(MIN_LINE_HEIGHT, Math.round(lh * 100) / 100));
}

/** A length scaled by a zoom percentage, to whole pixels (no blurry rules). */
export function scalePx(px: number, zoom: number): number {
  return Math.max(1, Math.round((px * clampZoom(zoom)) / 100));
}

/**
 * The stylesheet's type scale (`--fs-*`), as it exists at 12px / 100%: every
 * other size keeps its ratio to the base. 12 and 100 give back exactly the
 * values in styles.css, which is what keeps the default look unchanged.
 */
export const BASE_FONT_PX = 12;
const TYPE_RATIOS = { micro: 11, sm: 11, base: 12, md: 13, lg: 15 } as const;
export type TypeScale = Record<keyof typeof TYPE_RATIOS, number>;

export function typeScale(uiFontPx: number, zoom: number): TypeScale {
  const factor = (clampFontSize(uiFontPx, BASE_FONT_PX) * clampZoom(zoom)) / 100 / BASE_FONT_PX;
  const out = {} as TypeScale;
  for (const k of Object.keys(TYPE_RATIOS) as (keyof TypeScale)[]) {
    out[k] = Math.max(1, Math.round(TYPE_RATIOS[k] * factor));
  }
  return out;
}

/**
 * How much the grid's rows grow: its font relative to the 12px the row heights
 * in settings.ts were drawn for, times the zoom. Passed to rowHeightFor so the
 * virtualization math and the painted row agree.
 */
export function gridScale(s: Pick<Settings, "gridFontSize" | "zoom">): number {
  return (clampFontSize(s.gridFontSize, BASE_FONT_PX) / BASE_FONT_PX) * (clampZoom(s.zoom) / 100);
}

/**
 * The spacing, control-height and band-height scales per density (issue #682),
 * in px at 100 %. `comfortable` is exactly what styles.css declares; `compact`
 * takes each step down about one notch, so the tree, bars, tabs, dialogs and
 * forms all tighten together instead of each rule deciding its own "compact".
 * The grid's rows follow the same setting through rowHeightFor (28 → 24).
 */
export const DENSITY_SCALES: Readonly<Record<Density, Readonly<Record<string, number>>>> = {
  comfortable: {
    "--sp-1": 2, "--sp-2": 4, "--sp-3": 8, "--sp-4": 12, "--sp-5": 16, "--sp-6": 24,
    "--h-micro": 20, "--h-sm": 24, "--h-md": 28,
    "--band-sm": 28, "--band-md": 32, "--band-lg": 40, "--band-xl": 48,
  },
  compact: {
    "--sp-1": 2, "--sp-2": 3, "--sp-3": 6, "--sp-4": 8, "--sp-5": 12, "--sp-6": 16,
    "--h-micro": 18, "--h-sm": 20, "--h-md": 24,
    "--band-sm": 24, "--band-md": 28, "--band-lg": 34, "--band-xl": 40,
  },
};

/** The object tree's row: `--h-sm` under the density and the zoom, as the CSS paints it. */
export function treeRowHeight(zoom: number, density: Density = "comfortable"): number {
  return scalePx(DENSITY_SCALES[density]["--h-sm"], zoom);
}

/** What a user's family is prepended to, never left alone: the theme's own
 *  stacks (#747), which themeSchema.ts writes as these two properties. */
export const UI_FALLBACK = "var(--font-theme-ui)";
export const MONO_FALLBACK = "var(--font-mono)";

/** Safe choices offered in the pickers; free text is accepted as well. */
export const UI_FONT_CHOICES: readonly string[] = [
  "Segoe UI",
  "Inter",
  "IBM Plex Sans",
  "Roboto",
  "Noto Sans",
  "Ubuntu",
  "Cantarell",
  "Helvetica Neue",
  "Arial",
  "Verdana",
];
export const MONO_FONT_CHOICES: readonly string[] = [
  "JetBrains Mono",
  "Cascadia Code",
  "Cascadia Mono",
  "Consolas",
  "Fira Code",
  "IBM Plex Mono",
  "Source Code Pro",
  "Menlo",
  "SF Mono",
  "DejaVu Sans Mono",
  "Ubuntu Mono",
  "Courier New",
];

const GENERIC_FAMILIES = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
]);

/** A family name: letters, digits, spaces, dashes and dots — nothing CSS reads. */
const FAMILY_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u;

/**
 * Turn free text into a CSS font-family list, or "" when nothing in it is a
 * family name. Each entry is a quoted name or a generic keyword; quotes,
 * semicolons, braces, parentheses, slashes and `var(`/`url(` never survive, so
 * the result can go straight into a custom property.
 */
export function sanitizeFontFamily(input: string): string {
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const name = raw.trim().replace(/^["']+|["']+$/g, "").replace(/\s+/g, " ").trim();
    if (!name) continue;
    const lower = name.toLowerCase();
    const entry = GENERIC_FAMILIES.has(lower) ? lower : FAMILY_NAME.test(name) ? `"${name}"` : null;
    if (entry && !out.includes(entry)) out.push(entry);
  }
  return out.join(", ");
}

/** The user's (already sanitized) list ahead of the shipped stack. */
export function fontStack(user: string, fallback: string): string {
  return user ? `${user}, ${fallback}` : fallback;
}

/**
 * Every custom property the typography settings drive, by name. Defaults give
 * back exactly what styles.css declares, so applying them is a no-op on a fresh
 * install. Spacing, control and band heights follow the density and the zoom;
 * the type scale follows the UI font size and the zoom.
 */
export function typographyVars(s: Settings): Record<string, string> {
  const z = s.zoom;
  const fs = typeScale(s.uiFontSize, z);
  const px = (n: number) => `${scalePx(n, z)}px`;
  return {
    "--fs-micro": `${fs.micro}px`,
    "--fs-sm": `${fs.sm}px`,
    "--fs-base": `${fs.base}px`,
    "--fs-md": `${fs.md}px`,
    "--fs-lg": `${fs.lg}px`,
    ...Object.fromEntries(
      Object.entries(DENSITY_SCALES[s.density]).map(([name, v]) => [name, px(v)]),
    ),
    "--font-system": fontStack(s.uiFont, UI_FALLBACK),
    "--font-editor": fontStack(s.editorFont, MONO_FALLBACK),
    "--fs-editor": `${scalePx(clampFontSize(s.editorFontSize, 13), z)}px`,
    "--lh-editor": String(s.editorLineHeight),
    "--liga-editor": s.editorLigatures ? "normal" : "none",
    "--font-grid": fontStack(s.gridFont, MONO_FALLBACK),
    "--fs-grid": `${scalePx(clampFontSize(s.gridFontSize, BASE_FONT_PX), z)}px`,
  };
}

/** Write the variables inline on the root (the same route as cell colours). */
export function applyTypography(
  style: { setProperty(name: string, value: string): void },
  vars: Record<string, string>,
): void {
  for (const [name, value] of Object.entries(vars)) style.setProperty(name, value);
}
