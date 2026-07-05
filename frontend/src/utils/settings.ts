// Pure logic for user preferences (issue #181). The Settings panel edits these;
// they persist via settingsStore (kvStore). Theme lives in theme.ts (it needs
// live system tracking) and the history limit in history.ts/historyStore — both
// are reused by the panel rather than duplicated here, so this module owns only
// the NEW preferences: grid density, the slow-query threshold, and the
// check-for-updates-on-start toggle. Everything here is pure and tested.

/** Row density of the result grid. */
export type GridDensity = "normal" | "compact";

export interface Settings {
  /** Result-grid row density. */
  gridDensity: GridDensity;
  /** A query slower than this (ms) is flagged as slow (consumed by #179/#180).
      0 disables the mark. */
  slowThresholdMs: number;
  /** Check GitHub Releases for a newer version at startup (consumed by #182). */
  checkUpdatesOnStart: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  gridDensity: "normal",
  slowThresholdMs: 500,
  checkUpdatesOnStart: true,
};

/** Bounds for the slow-query threshold (ms): 0 (off) up to one hour. */
export const MIN_SLOW_MS = 0;
export const MAX_SLOW_MS = 3_600_000;

/** Clamp an arbitrary number to a valid slow threshold; NaN → the default. */
export function clampSlowThreshold(ms: number): number {
  if (!Number.isFinite(ms)) return DEFAULT_SETTINGS.slowThresholdMs;
  return Math.min(MAX_SLOW_MS, Math.max(MIN_SLOW_MS, Math.round(ms)));
}

/** Row height (px) for a density. Single source shared by the grid component
    (virtualization math) and the CSS, so they never drift apart. */
export function rowHeightFor(density: GridDensity): number {
  return density === "compact" ? 22 : 28;
}

const isDensity = (v: unknown): v is GridDensity => v === "normal" || v === "compact";

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
    slowThresholdMs:
      typeof obj.slowThresholdMs === "number"
        ? clampSlowThreshold(obj.slowThresholdMs)
        : DEFAULT_SETTINGS.slowThresholdMs,
    checkUpdatesOnStart:
      typeof obj.checkUpdatesOnStart === "boolean"
        ? obj.checkUpdatesOnStart
        : DEFAULT_SETTINGS.checkUpdatesOnStart,
  };
}

/** Serialize settings for storage (already-valid input assumed). */
export function serializeSettings(s: Settings): string {
  return JSON.stringify(s);
}
