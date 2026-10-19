import { describe, it, expect } from "vitest";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_INDEX,
  parseConfigBundle,
  searchSettings,
  sectionDefaults,
  serializeConfigBundle,
  type ConfigBundle,
} from "../../src/utils/settingsCatalog";
import { DEFAULT_SETTINGS } from "../../src/utils/settings";
import { DEFAULT_HISTORY_LIMIT } from "../../src/utils/history";
import { translate } from "../../src/utils/translate";

const es = (key: string) => translate("es", key);
const en = (key: string) => translate("en", key);

describe("SETTINGS_INDEX", () => {
  it("files every row under a listed category, with unique ids", () => {
    const ids = SETTINGS_INDEX.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of SETTINGS_INDEX) expect(SETTINGS_CATEGORIES).toContain(e.category);
  });
  it("gives every category at least one row, and every key a translation", () => {
    for (const cat of SETTINGS_CATEGORIES) {
      expect(SETTINGS_INDEX.some((e) => e.category === cat), cat).toBe(true);
    }
    for (const e of SETTINGS_INDEX) {
      for (const k of e.keys) expect(es(k), k).not.toBe(k);
    }
  });
});

describe("searchSettings", () => {
  it("returns every row for a blank query", () => {
    expect(searchSettings("", es)).toEqual(SETTINGS_INDEX.map((e) => e.id));
    expect(searchSettings("   ", es)).toHaveLength(SETTINGS_INDEX.length);
  });
  it("ignores case and accents: 'tipografia' finds the typography rows", () => {
    const hits = searchSettings("TIPOGRAFIA", es);
    expect(hits).toEqual(expect.arrayContaining(["uiFont", "editorFont", "gridFont"]));
    expect(hits).not.toContain("historyLimit");
  });
  it("searches the translated text, so the same row is found in either language", () => {
    expect(searchSettings("historial", es)).toEqual(["localHistory", "historyLimit"]);
    expect(searchSettings("history", en)).toEqual(["localHistory", "historyLimit"]);
    expect(searchSettings("history", es)).toEqual([]);
  });
  it("needs every word, and matches the options of a row", () => {
    expect(searchSettings("hoja densa", es)).toEqual(["gridStyle"]);
    expect(searchSettings("hoja xyz", es)).toEqual([]);
  });
  it("finds the shortcut editor by any action's name", () => {
    expect(searchSettings("paleta de comandos", es)).toEqual(["shortcuts"]);
  });
  it("finds nothing for a query that matches nothing", () => {
    expect(searchSettings("zzzz", es)).toEqual([]);
  });
});

describe("sectionDefaults", () => {
  it("returns the defaults of the fields a section owns", () => {
    expect(sectionDefaults("editor")).toEqual({
      editorFont: DEFAULT_SETTINGS.editorFont,
      editorFontSize: DEFAULT_SETTINGS.editorFontSize,
      editorLineHeight: DEFAULT_SETTINGS.editorLineHeight,
      editorLigatures: DEFAULT_SETTINGS.editorLigatures,
      editorDiagnostics: DEFAULT_SETTINGS.editorDiagnostics,
      builtinTemplates: DEFAULT_SETTINGS.builtinTemplates,
      localHistoryVersions: DEFAULT_SETTINGS.localHistoryVersions,
      localHistoryDays: DEFAULT_SETTINGS.localHistoryDays,
    });
    expect(sectionDefaults("window")).toEqual({ nativeMenu: true, customTitleBar: true });
  });
  it("is empty for a section that owns no Settings field", () => {
    expect(sectionDefaults("shortcuts")).toEqual({});
    expect(sectionDefaults("about")).toEqual({});
  });
  it("covers every Settings field exactly once across the sections", () => {
    const owned = SETTINGS_CATEGORIES.flatMap((c) => Object.keys(sectionDefaults(c)));
    expect(owned.sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});

describe("config bundle", () => {
  const bundle: ConfigBundle = {
    settings: { ...DEFAULT_SETTINGS, zoom: 125, gridStyle: "hoja" },
    shortcuts: { refresh: "Mod+R" },
    theme: "dark",
    themeId: "terminal",
    historyLimit: 500,
    locale: "en",
  };

  it("round-trips", () => {
    expect(parseConfigBundle(serializeConfigBundle(bundle))).toEqual(bundle);
  });
  it("fills what a partial file leaves out with the defaults", () => {
    expect(parseConfigBundle('{"settings":{"zoom":150}}')).toEqual({
      settings: { ...DEFAULT_SETTINGS, zoom: 150 },
      shortcuts: {},
      theme: "system",
      themeId: "nativo",
      historyLimit: DEFAULT_HISTORY_LIMIT,
      locale: null,
    });
  });
  it("sanitizes each part through its own parser", () => {
    const parsed = parseConfigBundle(
      JSON.stringify({
        settings: { zoom: "big" },
        shortcuts: { refresh: "R" },
        theme: "neon",
        themeId: "",
        historyLimit: 1,
        locale: "fr",
      }),
    )!;
    expect(parsed.settings.zoom).toBe(DEFAULT_SETTINGS.zoom);
    expect(parsed.shortcuts).toEqual({});
    expect(parsed.theme).toBe("system");
    expect(parsed.themeId).toBe("nativo");
    expect(parsed.historyLimit).toBe(10);
    expect(parsed.locale).toBeNull();
  });
  it("refuses what is not a JSON object", () => {
    expect(parseConfigBundle("{broken")).toBeNull();
    expect(parseConfigBundle("[1,2]")).toBeNull();
    expect(parseConfigBundle("null")).toBeNull();
    expect(parseConfigBundle('"text"')).toBeNull();
  });
});
