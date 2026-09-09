// Colour per data type in the result grid (issue #483), and the user's own
// choices on top of it.
//
// The grid already stamps `cell-<kind>` on every cell, and styles.css gives each
// kind a colour that was measured against that palette's surfaces. This module
// is the part that can be changed at runtime: which CSS variable each kind
// reads, what the user overrode, and how a set of overrides is stored, applied
// and taken back off.
//
// Overrides are kept PER LOOK, not once for the app. A blue that reads well on
// the light theme is a blue nobody can find on Terminal, so "adapt them across
// themes" cannot mean one value carried everywhere: each look keeps its own set,
// and switching themes goes back to what that theme was given.

import type { CellKind } from "./format";
import { contrastRatio, AA_NORMAL } from "./contrast";
import type { ResolvedTheme } from "./theme";
import type { SkinPref } from "./skin";
import { isDarkOnly } from "./skin";

/**
 * The CSS variable each kind reads.
 *
 * `--cell-null` and `--cell-number` exist rather than reusing `--null` and
 * `--number`, which hold the same values: those two are also the app's amber
 * warning and its "connected" green, so overriding the number column here would
 * otherwise have recoloured the connection dot.
 */
export const CELL_VAR: Record<CellKind, string> = {
  null: "--cell-null",
  number: "--cell-number",
  text: "--cell-text",
  temporal: "--cell-temporal",
  bool: "--cell-bool",
  blob: "--cell-blob",
};

/** The kinds in the order the settings panel lists them. */
export const CELL_KINDS: CellKind[] = ["text", "number", "temporal", "bool", "blob", "null"];

/** One look's overrides: only the kinds the user actually changed. */
export type CellColors = Partial<Record<CellKind, string>>;

/** Every look's overrides, by palette key. */
export type CellColorStore = Record<string, CellColors>;

/** localStorage key for the overrides. */
export const CELL_COLORS_KEY = "quaero.cellColors";

/**
 * Which palette a look uses: a theme that brings its own surfaces answers with
 * its own name, everything else with light or dark. That is exactly the set of
 * palettes styles.css defines, so an override can never land on a look that has
 * no colours of its own.
 */
export function paletteKey(theme: ResolvedTheme, skin: SkinPref): string {
  return isDarkOnly(skin) ? skin : theme;
}

/** `#rgb` / `#rrggbb` (any case) normalised to lowercase `#rrggbb`, or null. */
export function normalizeHex(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(raw)) {
    return "#" + raw.slice(1).split("").map((c) => c + c).join("");
  }
  return /^#[0-9a-f]{6}$/.test(raw) ? raw : null;
}

/**
 * Whether `colour` can be read on `background`.
 *
 * A colour picker will happily hand back grey on grey, and the app has a rule
 * about that already (the palettes are measured, not guessed). The setting is
 * not blocked — it is the user's grid — but it is flagged, because a column
 * that has silently gone invisible is indistinguishable from a bug.
 */
export function isReadable(colour: string, background: string): boolean {
  const c = normalizeHex(colour);
  const b = normalizeHex(background);
  if (c === null || b === null) return true; // nothing to judge: do not cry wolf
  return contrastRatio(c, b) >= AA_NORMAL;
}

/** The overrides for one look, dropping anything that is not a colour. */
export function colorsFor(store: CellColorStore, key: string): CellColors {
  const out: CellColors = {};
  for (const [kind, value] of Object.entries(store[key] ?? {})) {
    const hex = typeof value === "string" ? normalizeHex(value) : null;
    if (hex !== null && kind in CELL_VAR) out[kind as CellKind] = hex;
  }
  return out;
}

/** `store` with `colors` as the overrides of `key` (an empty set removes it). */
export function withColors(
  store: CellColorStore,
  key: string,
  colors: CellColors,
): CellColorStore {
  const next = { ...store };
  if (Object.keys(colors).length === 0) delete next[key];
  else next[key] = colors;
  return next;
}

/** Parses the stored JSON, dropping anything malformed. Never throws. */
export function parseCellColors(raw: string | null): CellColorStore {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) return {};
  const out: CellColorStore = {};
  for (const key of Object.keys(data as Record<string, unknown>)) {
    const colors = colorsFor(data as CellColorStore, key);
    if (Object.keys(colors).length > 0) out[key] = colors;
  }
  return out;
}

/** The store as JSON for the kvStore. */
export function serializeCellColors(store: CellColorStore): string {
  return JSON.stringify(store);
}

/** What applyCellColors writes to and reads from: the document root, in tests a stub. */
export interface StyleTarget {
  setProperty: (name: string, value: string) => void;
  removeProperty: (name: string) => void;
}

/**
 * Put `colors` on the root as inline custom properties, and take off the ones
 * that are no longer overridden.
 *
 * Every kind is touched on every call, the unset ones by removal: switching to a
 * look with fewer overrides has to give the earlier one's colours back, and a
 * property nobody removes stays for the rest of the session.
 */
export function applyCellColors(target: StyleTarget, colors: CellColors): void {
  for (const kind of CELL_KINDS) {
    const value = colors[kind];
    if (value === undefined) target.removeProperty(CELL_VAR[kind]);
    else target.setProperty(CELL_VAR[kind], value);
  }
}
