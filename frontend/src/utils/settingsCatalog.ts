// What the Settings panel is made of (issue #684): the categories, which row
// belongs where and under which words it can be found, what "back to the
// defaults" means for one section, and the whole configuration as one file.
// Everything here is data and pure functions; the panel only renders them.

import { fold } from "./connectionSearch";
import { DEFAULT_HISTORY_LIMIT, clampLimit } from "./history";
import { DEFAULT_SETTINGS, parseSettings, type Settings } from "./settings";
import { SHORTCUTS, parseOverrides, type ShortcutOverrides } from "./shortcuts";
import { DEFAULT_THEME_ID, STYLE_THEME_IDS } from "./themes";
import type { ThemePref } from "./theme";
import { isLocale, type Locale } from "./translate";

export type SettingsCategory =
  | "general"
  | "appearance"
  | "editor"
  | "grid"
  | "queries"
  | "shortcuts"
  | "window"
  | "about";

/** The categories in the order the navigation lists them. */
export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  "general",
  "appearance",
  "editor",
  "grid",
  "queries",
  "shortcuts",
  "window",
  "about",
];

export interface SettingEntry {
  /** Row id; the panel wraps the matching control in it. */
  id: string;
  category: SettingsCategory;
  /** i18n KEYS whose translated text the search looks through (label, hint, options). */
  keys: readonly string[];
}

/**
 * Every row of the panel. The search matches the TRANSLATED text of `keys`, so
 * a row is found under the words the user actually sees, in their language.
 */
export const SETTINGS_INDEX: readonly SettingEntry[] = [
  { id: "language", category: "general", keys: ["common.language", "lang.es", "lang.en"] },
  { id: "checkUpdates", category: "general", keys: ["settings.checkUpdates"] },
  { id: "config", category: "general", keys: ["settings.exportConfig", "settings.importConfig"] },
  {
    id: "style",
    category: "appearance",
    keys: [
      "settings.style",
      ...STYLE_THEME_IDS.flatMap((id) => [`theme.name.${id}`, `theme.desc.${id}`]),
    ],
  },
  {
    id: "mode",
    category: "appearance",
    keys: ["settings.mode", "settings.mode.system", "settings.mode.light", "settings.mode.dark"],
  },
  { id: "theme", category: "appearance", keys: ["settings.theme", "settings.importTheme", "settings.exportTheme"] },
  { id: "zoom", category: "appearance", keys: ["settings.zoom", "settings.zoomHint"] },
  { id: "uiFont", category: "appearance", keys: ["settings.typography", "settings.uiFont", "settings.uiFontSize", "settings.fontHint"] },
  { id: "editorFont", category: "editor", keys: ["settings.typography", "settings.editorFont", "settings.editorFontSize"] },
  { id: "editorLineHeight", category: "editor", keys: ["settings.editorLineHeight"] },
  { id: "editorLigatures", category: "editor", keys: ["settings.editorLigatures"] },
  { id: "editorDiagnostics", category: "editor", keys: ["settings.editorDiagnostics"] },
  { id: "builtinTemplates", category: "editor", keys: ["settings.builtinTemplates"] },
  {
    id: "localHistory",
    category: "editor",
    keys: ["lhist.settingVersions", "lhist.settingDays", "lhist.settingHint"],
  },
  { id: "colorTypes", category: "grid", keys: ["settings.colorTypes", "settings.typeColors", "settings.resetColors"] },
  {
    id: "gridStyle",
    category: "grid",
    keys: ["settings.gridStyle", "settings.gridStyle.registro", "settings.gridStyle.hoja", "settings.gridStyle.informe"],
  },
  { id: "gridDensity", category: "grid", keys: ["settings.gridDensity", "settings.density.normal", "settings.density.compact"] },
  { id: "gridFont", category: "grid", keys: ["settings.typography", "settings.gridFont", "settings.gridFontSize"] },
  { id: "slowThreshold", category: "queries", keys: ["settings.slowThreshold"] },
  { id: "historyLimit", category: "queries", keys: ["settings.historyLimit"] },
  // One row: the whole editor, findable by any action's name.
  { id: "shortcuts", category: "shortcuts", keys: ["settings.cat.shortcuts", ...SHORTCUTS.map((sc) => sc.description)] },
  { id: "toolStrip", category: "window", keys: ["settings.toolStrip"] },
  { id: "nativeMenu", category: "window", keys: ["settings.nativeMenu"] },
  {
    id: "about",
    category: "about",
    keys: ["settings.cat.about", "settings.about.appVersion", "settings.about.coreVersion", "settings.about.protocol"],
  },
];

/**
 * The ids of the rows whose text matches `query` — case- and accent-insensitive
 * ("tipografia" finds "Tipografía"), every word somewhere in the row's text. A
 * blank query matches every row. `resolve` turns an i18n key into its text.
 */
export function searchSettings(
  query: string,
  resolve: (key: string) => string,
  index: readonly SettingEntry[] = SETTINGS_INDEX,
): string[] {
  const terms = fold(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return index.map((e) => e.id);
  return index
    .filter((e) => {
      const text = fold(e.keys.map(resolve).join(" "));
      return terms.every((term) => text.includes(term));
    })
    .map((e) => e.id);
}

/** Which Settings fields each section owns (the other stores are reset by their owners). */
const SECTION_FIELDS: Partial<Record<SettingsCategory, readonly (keyof Settings)[]>> = {
  general: ["checkUpdatesOnStart"],
  appearance: ["zoom", "uiFont", "uiFontSize"],
  editor: [
    "editorFont",
    "editorFontSize",
    "editorLineHeight",
    "editorLigatures",
    "editorDiagnostics",
    "builtinTemplates",
    "localHistoryVersions",
    "localHistoryDays",
  ],
  grid: ["colorTypes", "gridStyle", "gridDensity", "gridFont", "gridFontSize"],
  queries: ["slowThresholdMs"],
  window: ["toolStrip", "nativeMenu"],
};

/** The defaults of the Settings fields a section owns; empty for a section that owns none. */
export function sectionDefaults(category: SettingsCategory): Partial<Settings> {
  const out: Partial<Settings> = {};
  for (const field of SECTION_FIELDS[category] ?? []) {
    (out as Record<string, unknown>)[field] = DEFAULT_SETTINGS[field];
  }
  return out;
}

/** The whole configuration, as the export file carries it. */
export interface ConfigBundle {
  settings: Settings;
  shortcuts: ShortcutOverrides;
  theme: ThemePref;
  themeId: string;
  historyLimit: number;
  locale: Locale | null;
}

const isThemePref = (v: unknown): v is ThemePref => v === "system" || v === "light" || v === "dark";

export function serializeConfigBundle(b: ConfigBundle): string {
  return JSON.stringify({ version: 1, ...b }, null, 2);
}

/**
 * Parse an exported configuration, tolerantly: each part goes through its own
 * parser, so a missing or ill-typed field is that part's default. Null when the
 * text is not a JSON object at all — that is a wrong file, not an old one.
 */
export function parseConfigBundle(raw: string): ConfigBundle | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const o = obj as Record<string, unknown>;
  return {
    settings: parseSettings(o.settings === undefined ? null : JSON.stringify(o.settings)),
    shortcuts: parseOverrides(o.shortcuts === undefined ? null : JSON.stringify(o.shortcuts)),
    theme: isThemePref(o.theme) ? o.theme : "system",
    themeId: typeof o.themeId === "string" && o.themeId !== "" ? o.themeId : DEFAULT_THEME_ID,
    historyLimit: typeof o.historyLimit === "number" ? clampLimit(o.historyLimit) : DEFAULT_HISTORY_LIMIT,
    locale: isLocale(o.locale) ? o.locale : null,
  };
}
