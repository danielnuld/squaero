// Pure logic for user preferences (issue #181). The Settings panel edits these;
// they persist via settingsStore (kvStore). Theme lives in theme.ts (it needs
// live system tracking) and the history limit in history.ts/historyStore — both
// are reused by the panel rather than duplicated here, so this module owns only
// the NEW preferences: grid density, the slow-query threshold, and the
// check-for-updates-on-start toggle. Everything here is pure and tested.

import { clampFontSize, clampLineHeight, clampZoom, sanitizeFontFamily } from "./typography";

/** Row density of the result grid. */
export type GridDensity = "normal" | "compact";

/**
 * How the result grid is READ (issue #540). Density is how much fits; this is
 * what the grid looks like.
 *
 * - `registro`: ink for text, colour kept for the types that are not text, the
 *   type under each column name, NULL as a tag. The default.
 * - `hoja`: full gridlines, shorter rows, colour on every type — a spreadsheet.
 * - `informe`: no vertical rules, taller rows, the type's colour as a rule under
 *   the header, and thousands and dates FORMATTED on screen.
 */
export type GridStyle = "registro" | "hoja" | "informe";

export interface Settings {
  /** Result-grid row density. */
  gridDensity: GridDensity;
  /** How the result grid is drawn and read (issue #540). */
  gridStyle: GridStyle;
  /** A query slower than this (ms) is flagged as slow (consumed by #179/#180).
      0 disables the mark. */
  slowThresholdMs: number;
  /** Check GitHub Releases for a newer version at startup (consumed by #182). */
  checkUpdatesOnStart: boolean;
  /**
   * Show the strip of tool icons under the tabs (issue #386).
   *
   * On by default. The ribbon it replaced was 68 px and duplicated the tab bar,
   * but it did carry one thing worth keeping: you could SEE that the monitor,
   * the notebook and the snippets existed without knowing to look. The strip is
   * that, at 40 px and icons only, and folding it away is a decision the user
   * makes once — which is why it lives here and not in a signal.
   */
  toolStrip: boolean;
  /**
   * Colour the grid's cells by their column's type (issue #483).
   *
   * On by default: telling a date from a number from a string is the reason the
   * types are known at all, and doing it by colour is faster than reading. It is
   * a switch because a grid of five colours is not what everyone wants to stare
   * at all day, and turning it off has to be one click, not six resets.
   */
  colorTypes: boolean;
  /** Mark problems (unknown names, UPDATE without WHERE…) in the SQL editor
      before running it (issue #662). Never blocks a run; on by default. */
  editorDiagnostics: boolean;
  /** Offer the shipped editor templates (`sel`, `ins`, `upd`, `del`, `cte`;
      issue #665). The user's own, from snippets with an abbreviation, stay. */
  builtinTemplates: boolean;
  /**
   * Local history of the editor tabs (issue #674): how many versions each tab
   * keeps, newest first. 0 turns the history off (and clears what it held).
   */
  localHistoryVersions: number;
  /** Days a version is kept. 0 = no age limit, only the count above. */
  localHistoryDays: number;
  /**
   * Show the native menu bar the shell draws on Windows and Linux (issue #686).
   *
   * On by default: it is where someone who does not know the shortcuts finds
   * the actions. Off for a style that carries its own in-app menu. macOS keeps
   * its menu bar regardless (the panel hides the toggle there).
   */
  nativeMenu: boolean;
  /**
   * Typography (issue #681). A font is a sanitized CSS family list ("" = the
   * stack styles.css ships); sizes are px before zoom; the zoom is a percentage
   * that scales the type scale, spacing and control heights (typography.ts).
   * The defaults reproduce the stylesheet exactly, so nothing changes until
   * the user does — the default typeface is #678's decision, not this one.
   */
  uiFont: string;
  uiFontSize: number;
  editorFont: string;
  editorFontSize: number;
  editorLineHeight: number;
  editorLigatures: boolean;
  gridFont: string;
  gridFontSize: number;
  zoom: number;
}

export const DEFAULT_SETTINGS: Settings = {
  gridDensity: "normal",
  gridStyle: "registro",
  slowThresholdMs: 1000,
  checkUpdatesOnStart: true,
  toolStrip: true,
  colorTypes: true,
  editorDiagnostics: true,
  builtinTemplates: true,
  localHistoryVersions: 50,
  localHistoryDays: 30,
  nativeMenu: true,
  uiFont: "",
  uiFontSize: 12,
  editorFont: "",
  editorFontSize: 13,
  // CodeMirror's own default; the editor never set one before.
  editorLineHeight: 1.4,
  editorLigatures: true,
  gridFont: "",
  gridFontSize: 12,
  zoom: 100,
};

/** Bounds for the slow-query threshold (ms): 0 (off) up to one hour. */
export const MIN_SLOW_MS = 0;
export const MAX_SLOW_MS = 3_600_000;

/** Clamp an arbitrary number to a valid slow threshold; NaN → the default. */
export function clampSlowThreshold(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_SETTINGS.slowThresholdMs;
  return Math.min(MAX_SLOW_MS, Math.max(MIN_SLOW_MS, Math.round(ms)));
}

/** Bounds for the local-history retention (issue #674). */
export const MAX_LOCAL_VERSIONS = 500;
export const MAX_LOCAL_DAYS = 365;

/** Clamp a versions-per-tab count into 0..MAX_LOCAL_VERSIONS; NaN → the default. */
export function clampLocalVersions(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.localHistoryVersions;
  return Math.min(MAX_LOCAL_VERSIONS, Math.max(0, Math.floor(n)));
}

/** Clamp a retention age (days) into 0..MAX_LOCAL_DAYS; NaN → the default. */
export function clampLocalDays(n: number): number {
  if (!Number.isFinite(n)) return DEFAULT_SETTINGS.localHistoryDays;
  return Math.min(MAX_LOCAL_DAYS, Math.max(0, Math.floor(n)));
}

/**
 * Row height (px) per style and density. Single source shared by the grid
 * component (virtualization math), gridNav (scrolling a cell into view) and the
 * CSS via `--grid-row-h`, so the three can never drift apart — which is exactly
 * what a virtualized list punishes: rows that measure one thing and paint
 * another leave gaps or overlap as you scroll.
 */
const ROW_HEIGHT: Record<GridStyle, Record<GridDensity, number>> = {
  registro: { normal: 28, compact: 22 },
  hoja: { normal: 22, compact: 20 },
  informe: { normal: 32, compact: 28 },
};

/**
 * `scale` is the grid font × zoom factor (typography.ts gridScale): the heights
 * above were drawn for 12px text, and a bigger font or a zoomed interface needs
 * the row to grow with it — rounded, so a row never lands on a half pixel.
 */
export function rowHeightFor(style: GridStyle, density: GridDensity, scale = 1): number {
  return Math.max(1, Math.round(ROW_HEIGHT[style][density] * scale));
}

const isDensity = (v: unknown): v is GridDensity => v === "normal" || v === "compact";

const isGridStyle = (v: unknown): v is GridStyle =>
  v === "registro" || v === "hoja" || v === "informe";

/**
 * Parse persisted settings, tolerantly. Unknown/missing/ill-typed fields fall
 * back to their default, so a partial or corrupt blob never throws and always
 * yields a complete, valid Settings.
 */
export function parseSettings(raw: string | null | undefined): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    obj =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  return {
    gridDensity: isDensity(obj.gridDensity) ? obj.gridDensity : DEFAULT_SETTINGS.gridDensity,
    // Absent (settings saved before #540) or unknown → the default style.
    gridStyle: isGridStyle(obj.gridStyle) ? obj.gridStyle : DEFAULT_SETTINGS.gridStyle,
    slowThresholdMs:
      typeof obj.slowThresholdMs === "number"
        ? clampSlowThreshold(obj.slowThresholdMs)
        : DEFAULT_SETTINGS.slowThresholdMs,
    checkUpdatesOnStart:
      typeof obj.checkUpdatesOnStart === "boolean"
        ? obj.checkUpdatesOnStart
        : DEFAULT_SETTINGS.checkUpdatesOnStart,
    toolStrip:
      typeof obj.toolStrip === "boolean" ? obj.toolStrip : DEFAULT_SETTINGS.toolStrip,
    colorTypes:
      typeof obj.colorTypes === "boolean" ? obj.colorTypes : DEFAULT_SETTINGS.colorTypes,
    editorDiagnostics:
      typeof obj.editorDiagnostics === "boolean"
        ? obj.editorDiagnostics
        : DEFAULT_SETTINGS.editorDiagnostics,
    builtinTemplates:
      typeof obj.builtinTemplates === "boolean"
        ? obj.builtinTemplates
        : DEFAULT_SETTINGS.builtinTemplates,
    localHistoryVersions:
      typeof obj.localHistoryVersions === "number"
        ? clampLocalVersions(obj.localHistoryVersions)
        : DEFAULT_SETTINGS.localHistoryVersions,
    localHistoryDays:
      typeof obj.localHistoryDays === "number"
        ? clampLocalDays(obj.localHistoryDays)
        : DEFAULT_SETTINGS.localHistoryDays,
    nativeMenu:
      typeof obj.nativeMenu === "boolean" ? obj.nativeMenu : DEFAULT_SETTINGS.nativeMenu,
    // Typography (#681): a font is re-sanitized on read — the blob is only as
    // trustworthy as whatever last wrote it — and every number is clamped.
    uiFont: font(obj.uiFont),
    uiFontSize: num(obj.uiFontSize, (v) => clampFontSize(v, DEFAULT_SETTINGS.uiFontSize)),
    editorFont: font(obj.editorFont),
    editorFontSize: num(obj.editorFontSize, (v) =>
      clampFontSize(v, DEFAULT_SETTINGS.editorFontSize),
    ),
    editorLineHeight: num(obj.editorLineHeight, (v) =>
      clampLineHeight(v, DEFAULT_SETTINGS.editorLineHeight),
    ),
    editorLigatures:
      typeof obj.editorLigatures === "boolean"
        ? obj.editorLigatures
        : DEFAULT_SETTINGS.editorLigatures,
    gridFont: font(obj.gridFont),
    gridFontSize: num(obj.gridFontSize, (v) => clampFontSize(v, DEFAULT_SETTINGS.gridFontSize)),
    zoom: num(obj.zoom, clampZoom),
  };
}

const font = (v: unknown): string => (typeof v === "string" ? sanitizeFontFamily(v) : "");

/** A persisted number through its clamp; anything else is the clamp's fallback. */
const num = (v: unknown, clamp: (n: number) => number): number =>
  clamp(typeof v === "number" ? v : NaN);

/** Serialize settings for storage (already-valid input assumed). */
export function serializeSettings(s: Settings): string {
  return JSON.stringify(s);
}
