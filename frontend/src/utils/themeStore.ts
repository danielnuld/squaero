// Which theme is in use, and the ones the user imported (issue #680).
//
// Storage keys: `quaero.themeId` (the theme), `quaero.themes` (imported themes,
// a JSON array), and `quaero.theme` for the light/dark/system mode, which
// theme.ts has owned since #42 and keeps owning. `quaero.skin` is the key the
// old model wrote; it is read once, to migrate, and never written again.
//
// All functions take the storage as a parameter (like theme.ts) so a test drives
// them with a Map, and the pure parts — migration, the custom list — take and
// return plain values.

import { loadTheme, saveTheme, type ThemePref } from "./theme";
import { parseThemeJson, serializeTheme, validateTheme, type Theme } from "./themeSchema";
import { BUILTIN_THEMES, DEFAULT_THEME_ID, isBuiltinTheme } from "./themes";

export const THEME_ID_KEY = "quaero.themeId";
export const CUSTOM_THEMES_KEY = "quaero.themes";
/** The old model's key. Read for migration only. */
export const LEGACY_SKIN_KEY = "quaero.skin";

export interface ThemeChoice {
  themeId: string;
  mode: ThemePref;
}

/** Old skins that owned their surfaces and held the mode at dark (#473). */
const LEGACY_DARK_ONLY = ["ciruela", "pizarra", "terminal"];

/**
 * Old skin + mode preference → theme id + mode.
 *
 * Every skin became a theme of the same id. The three that had no light variant
 * are paired with the default light palette now, so a user who had one of them
 * is moved to dark mode: that IS what they were seeing (the preference was
 * overridden), and keeping their preference would change the app's look on the
 * day of the update. Unknown or absent → the default (B · Nativo since #747),
 * mode untouched. A theme id already stored is never touched (loadThemeChoice).
 */
export function migrateLegacyChoice(skin: string | null | undefined, mode: ThemePref): ThemeChoice {
  if (typeof skin !== "string" || !isBuiltinTheme(skin)) return { themeId: DEFAULT_THEME_ID, mode };
  return { themeId: skin, mode: LEGACY_DARK_ONLY.includes(skin) ? "dark" : mode };
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/**
 * The persisted choice. Without a `quaero.themeId` it migrates from the old
 * skin key and writes the result, so the migration happens once. Never throws.
 */
export function loadThemeChoice(storage?: Storage): ThemeChoice {
  const mode = loadTheme(storage);
  try {
    const id = storage?.getItem(THEME_ID_KEY);
    if (typeof id === "string" && id !== "") return { themeId: id, mode };
    const migrated = migrateLegacyChoice(storage?.getItem(LEGACY_SKIN_KEY), mode);
    if (storage) {
      saveThemeId(migrated.themeId, storage);
      if (migrated.mode !== mode) saveTheme(migrated.mode, storage);
    }
    return migrated;
  } catch {
    return { themeId: DEFAULT_THEME_ID, mode };
  }
}

/** Persist the theme id. Best-effort. */
export function saveThemeId(id: string, storage?: Pick<Storage, "setItem">): void {
  try {
    storage?.setItem(THEME_ID_KEY, id);
  } catch {
    /* storage unavailable: ignore */
  }
}

/** The imported themes, dropping any entry that no longer validates. */
export function parseCustomThemes(raw: string | null | undefined): Theme[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Theme[] = [];
  for (const entry of data) {
    if (validateTheme(entry).length === 0) {
      const { theme } = parseThemeJson(JSON.stringify(entry));
      if (theme) out.push(theme);
    }
  }
  return out;
}

export function serializeCustomThemes(list: readonly Theme[]): string {
  return JSON.stringify(list.map((t) => JSON.parse(serializeTheme(t))));
}

export function loadCustomThemes(storage?: Pick<Storage, "getItem">): Theme[] {
  try {
    return parseCustomThemes(storage?.getItem(CUSTOM_THEMES_KEY));
  } catch {
    return [];
  }
}

export function saveCustomThemes(list: readonly Theme[], storage?: Pick<Storage, "setItem">): void {
  try {
    storage?.setItem(CUSTOM_THEMES_KEY, serializeCustomThemes(list));
  } catch {
    /* best-effort */
  }
}

/** The id an imported theme is stored under (see addCustomTheme). */
export const customThemeId = (id: string): string => (isBuiltinTheme(id) ? `${id}-custom` : id);

/**
 * `list` with `theme` added. An id already in the list is replaced (importing
 * the file again updates it); an id that belongs to a built-in theme — an
 * exported built-in, edited — gets `-custom` so the original stays reachable.
 */
export function addCustomTheme(list: readonly Theme[], theme: Theme): Theme[] {
  const id = customThemeId(theme.id);
  const next = { ...theme, id };
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) return [...list, next];
  return list.map((t, j) => (j === i ? next : t));
}

export function removeCustomTheme(list: readonly Theme[], id: string): Theme[] {
  return list.filter((t) => t.id !== id);
}

/** The theme for `id`, built-in or imported; the default when it is gone. */
export function findTheme(id: string, custom: readonly Theme[]): Theme {
  return (
    BUILTIN_THEMES.find((t) => t.id === id) ??
    custom.find((t) => t.id === id) ??
    BUILTIN_THEMES.find((t) => t.id === DEFAULT_THEME_ID)!
  );
}
