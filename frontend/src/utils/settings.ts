// Pure logic for user preferences (issue #181). The Settings panel edits these;
// they persist via settingsStore (kvStore). Theme lives in theme.ts (it needs
// live system tracking) and the history limit in history.ts/historyStore — both
// are reused by the panel rather than duplicated here, so this module owns only
// the NEW preferences: grid density, the slow-query threshold, and the
// check-for-updates-on-start toggle. Everything here is pure and tested.

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
}

export const DEFAULT_SETTINGS: Settings = {
  gridDensity: "normal",
  gridStyle: "registro",
  slowThresholdMs: 1000,
  checkUpdatesOnStart: true,
  toolStrip: true,
  colorTypes: true,
};

/** Bounds for the slow-query threshold (ms): 0 (off) up to one hour. */
export const MIN_SLOW_MS = 0;
export const MAX_SLOW_MS = 3_600_000;

/** Clamp an arbitrary number to a valid slow threshold; NaN → the default. */
export function clampSlowThreshold(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_SETTINGS.slowThresholdMs;
  return Math.min(MAX_SLOW_MS, Math.max(MIN_SLOW_MS, Math.round(ms)));
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

export function rowHeightFor(style: GridStyle, density: GridDensity): number {
  return ROW_HEIGHT[style][density];
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
  };
}

/** Serialize settings for storage (already-valid input assumed). */
export function serializeSettings(s: Settings): string {
  return JSON.stringify(s);
}
