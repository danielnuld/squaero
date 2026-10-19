// Pure logic for user preferences (issue #181). The Settings panel edits these;
// they persist via settingsStore (kvStore). Theme lives in theme.ts (it needs
// live system tracking) and the history limit in history.ts/historyStore — both
// are reused by the panel rather than duplicated here, so this module owns only
// the NEW preferences: interface density, the slow-query threshold, and the
// check-for-updates-on-start toggle. Everything here is pure and tested.

import { clampFontSize, clampLineHeight, clampZoom, sanitizeFontFamily } from "./typography";

/**
 * Interface density (issue #682): how much fits. One setting for the whole app —
 * it scales spacing, control and band heights (typography.ts) and the grid's
 * row height (rowHeightFor below). Until #682 it was the grid's alone.
 */
export type Density = "comfortable" | "compact";

/**
 * How the result grid is READ (issue #540). Density is how much fits; this is
 * what the grid looks like.
 *
 * - `registro`: ink for text, colour kept for the types that are not text, the
 *   type under each column name, NULL as a tag. The default.
 * - `hoja`: full gridlines, colour on every type — a spreadsheet.
 * - `informe`: no vertical rules, the type's colour as a rule under the header,
 *   and dates written out. Numbers stay raw (rule 6): grouping them is the
 *   separate «Números · Formato regional» setting. No style changes the row
 *   height (R-40): that is the density's.
 */
export type GridStyle = "registro" | "hoja" | "informe";

/** What the app does with the last session when it opens (M14 SettingsGeneral). */
export type StartupMode = "resume" | "blank" | "ask";
/** What Ctrl/Cmd+Enter runs with nothing selected (M14 SettingsEditor). */
export type RunKeyScope = "statement" | "script";
/** How numbers read in the grid (R-13, audit rule 6): as stored, or grouped
    and with the decimal mark of the interface's language. */
export type NumberFormat = "raw" | "regional";

/** The longest text NULL can be shown as. */
export const MAX_NULL_TEXT = 16;

export interface Settings {
  /** On opening: resume the last session, start blank, or ask (the default). */
  startup: StartupMode;
  /** Ctrl/Cmd+Enter with nothing selected: the statement under the cursor
      (default) or the whole script. */
  runKeyScope: RunKeyScope;
  /** Highlight in the editor what the next run will execute. */
  highlightRun: boolean;
  /** Grid numbers: raw (default, rule 6) or regional. Display only. */
  numberFormat: NumberFormat;
  /** How a NULL cell reads (R-25); never confused with the text, as it is
      drawn dimmed and in italics. */
  nullText: string;
  /** The type on a second line under each column name (R-13). */
  headerTypes: boolean;
  /** The bar under the document tabs (R-40): with it off, a minimal one with
      the connection, Ejecutar and Más stays, so running is never hidden. */
  docBar: boolean;
  /** Interface density, the grid's rows included (#682). */
  density: Density;
  /** How the result grid is drawn and read (issue #540). */
  gridStyle: GridStyle;
  /** A query slower than this (ms) is flagged as slow (consumed by #179/#180).
      0 disables the mark. */
  slowThresholdMs: number;
  /** Check GitHub Releases for a newer version at startup (consumed by #182). */
  checkUpdatesOnStart: boolean;
  /**
   * Print a changed cell's original value struck through beside the new one,
   * instead of only in its tooltip (issues #688, #690). Off by default.
   */
  showOldValues: boolean;
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
   * The app's own title bar (issue #688) on Windows and macOS: on by default.
   * Off is the fallback when it misbehaves — the system's title bar (and on
   * Windows the native menu bar) comes back at once. Linux always keeps the
   * system's frame.
   */
  customTitleBar: boolean;
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
  startup: "ask",
  runKeyScope: "statement",
  highlightRun: true,
  numberFormat: "raw",
  nullText: "NULL",
  headerTypes: true,
  docBar: true,
  density: "comfortable",
  gridStyle: "registro",
  slowThresholdMs: 1000,
  checkUpdatesOnStart: true,
  showOldValues: false,
  colorTypes: true,
  editorDiagnostics: true,
  builtinTemplates: true,
  localHistoryVersions: 50,
  localHistoryDays: 30,
  nativeMenu: true,
  customTitleBar: true,
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
// One height per density whatever the style (R-40, audit rule 12): the style
// is how the grid reads, the density how much fits — two settings that both
// moved the rows left the user unsure which one was in charge.
const ROW_HEIGHT: Record<Density, number> = { comfortable: 28, compact: 24 };

/**
 * `scale` is the grid font × zoom factor (typography.ts gridScale): the heights
 * above were drawn for 12px text, and a bigger font or a zoomed interface needs
 * the row to grow with it — rounded, so a row never lands on a half pixel.
 */
export function rowHeightFor(_style: GridStyle, density: Density, scale = 1): number {
  return Math.max(1, Math.round(ROW_HEIGHT[density] * scale));
}

/** NULL's text as stored: trimmed, at most MAX_NULL_TEXT; blank → "NULL". */
export function cleanNullText(v: unknown): string {
  const text = typeof v === "string" ? v.trim().slice(0, MAX_NULL_TEXT) : "";
  return text || DEFAULT_SETTINGS.nullText;
}

const oneOf = <T extends string>(v: unknown, opts: readonly T[], fallback: T): T =>
  opts.includes(v as T) ? (v as T) : fallback;
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

/**
 * The density a stored blob asks for. `density` wins; a blob saved before #682
 * only has the grid's `gridDensity` ("normal" | "compact"), and that choice
 * becomes the app's, so nobody who had picked compact rows loses them.
 */
export function migrateDensity(obj: Record<string, unknown>): Density {
  if (obj.density === "comfortable" || obj.density === "compact") return obj.density;
  if (obj.gridDensity === "compact") return "compact";
  return DEFAULT_SETTINGS.density;
}

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
    startup: oneOf(obj.startup, ["resume", "blank", "ask"] as const, DEFAULT_SETTINGS.startup),
    runKeyScope: oneOf(obj.runKeyScope, ["statement", "script"] as const, DEFAULT_SETTINGS.runKeyScope),
    highlightRun: bool(obj.highlightRun, DEFAULT_SETTINGS.highlightRun),
    numberFormat: oneOf(obj.numberFormat, ["raw", "regional"] as const, DEFAULT_SETTINGS.numberFormat),
    nullText: obj.nullText === undefined ? DEFAULT_SETTINGS.nullText : cleanNullText(obj.nullText),
    headerTypes: bool(obj.headerTypes, DEFAULT_SETTINGS.headerTypes),
    docBar: bool(obj.docBar, DEFAULT_SETTINGS.docBar),
    density: migrateDensity(obj),
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
    showOldValues:
      typeof obj.showOldValues === "boolean"
        ? obj.showOldValues
        : DEFAULT_SETTINGS.showOldValues,
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
    customTitleBar:
      typeof obj.customTitleBar === "boolean"
        ? obj.customTitleBar
        : DEFAULT_SETTINGS.customTitleBar,
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
