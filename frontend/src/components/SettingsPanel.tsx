import { Segmented } from "./Segmented";
import type { Os } from "../utils/dialog";
import { createEffect, createMemo, createSignal, onMount, Show, For, type JSX } from "solid-js";
import { Panel } from "./Panel";
import { BrandWordmark } from "./Brand";
import { call } from "../utils/transport";
import { APP_VERSION, ABOUT_LINKS, aboutReport, systemLine } from "../utils/version";
import type { UpdateInfo, UpdateStatus } from "../utils/update";
import { openExternal } from "../utils/openExternal";
import { copyText } from "../utils/rowCopy";
import {
  clampSlowThreshold,
  clampLocalVersions,
  clampLocalDays,
  MAX_LOCAL_VERSIONS,
  MAX_LOCAL_DAYS,
  MIN_SLOW_MS,
  MAX_SLOW_MS,
  cleanNullText,
  MAX_NULL_TEXT,
  type Density,
  type GridStyle,
  type NumberFormat,
  type RunKeyScope,
  type StartupMode,
  type Settings,
} from "../utils/settings";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_INDEX,
  parseConfigBundle,
  searchSettings,
  sectionDefaults,
  serializeConfigBundle,
  type ConfigBundle,
  type SettingsCategory,
} from "../utils/settingsCatalog";
import {
  clearOverride,
  comboFromEvent,
  formatKeys,
  keyParams,
  keysOf,
  shortcutText,
  findConflicts,
  isRebindable,
  setOverride,
  validateCombo,
  type ActionId,
  type Shortcut,
  type ShortcutOverrides,
} from "../utils/shortcuts";
import { groupShortcuts } from "../utils/shortcutGroups";
import { clampLimit, DEFAULT_HISTORY_LIMIT, MIN_HISTORY_LIMIT, MAX_HISTORY_LIMIT } from "../utils/history";
import {
  clampFontSize,
  clampLineHeight,
  MAX_FONT_PX,
  MAX_LINE_HEIGHT,
  MIN_FONT_PX,
  MIN_LINE_HEIGHT,
  MONO_FONT_CHOICES,
  sanitizeFontFamily,
  UI_FONT_CHOICES,
  ZOOM_STEPS,
} from "../utils/typography";
import type { ResolvedTheme, ThemePref } from "../utils/theme";
import {
  contrastIssues,
  parseThemeJson,
  serializeTheme,
  themeVariables,
  type Theme,
  type ThemeError,
} from "../utils/themeSchema";
import { DEFAULT_THEME_ID, STYLE_THEME_IDS, isBuiltinTheme } from "../utils/themes";
import { saveText } from "../utils/download";
import {
  CELL_KINDS,
  CELL_VAR,
  isReadable,
  type CellColors,
} from "../utils/cellColors";
import type { CellKind } from "../utils/format";
import { locale, setLocale, LOCALES, t } from "../utils/i18n";
import { Icon, type IconName } from "./icons";
import { hasShellMenu } from "../utils/nativeMenu";
import { hasWindowBinding } from "../utils/titleBar";

// Settings + About panel (issue #181), opened as a tool tab. Fully controlled:
// the workspace (App) owns every preference signal and passes current values +
// change handlers, so there is no local state to drift out of sync when the tab
// is reused. Theme and the history limit live in their own stores (theme.ts /
// historyStore) and are edited here through the same handlers App already uses —
// no duplicate state. The core/protocol versions come live from `app.hello`.
//
// Issue #684: the rows are grouped in categories (settingsCatalog.ts) behind a
// navigation list, a search box shows the matching rows of every category at
// once, each section can go back to its defaults, the whole configuration can
// be exported and imported, and the global shortcuts can be rebound.

/** About's links in reading order (issue #694): i18n key suffix and URL. */
const ABOUT_LINK_KEYS: [string, string][] = [
  ["repo", ABOUT_LINKS.repo],
  ["releases", ABOUT_LINKS.releases],
  ["licenses", ABOUT_LINKS.thirdParty],
  ["license", ABOUT_LINKS.licence],
  ["report", ABOUT_LINKS.issues],
];

const THEME_OPTS: ThemePref[] = ["system", "light", "dark"];
/** Each category's icon in the navigation (M14 SettingsNav). */
const CATEGORY_ICON: Record<SettingsCategory, IconName> = {
  general: "tools",
  appearance: "view",
  editor: "query",
  grid: "table",
  queries: "clock",
  shortcuts: "key",
  window: "builder",
  about: "info",
};
const DENSITY_OPTS: Density[] = ["comfortable", "compact"];
/** How the grid reads (#540): density is how much fits; this is what it looks like. */
const GRID_STYLE_OPTS: GridStyle[] = ["registro", "hoja", "informe"];
const STARTUP_OPTS: StartupMode[] = ["resume", "blank", "ask"];
const RUN_KEY_OPTS: RunKeyScope[] = ["statement", "script"];
const NUMBER_OPTS: NumberFormat[] = ["raw", "regional"];

interface CoreInfo {
  coreVersion: string;
  protocolVersion: number;
}

/** What each type is called where the user picks its colour: i18n KEYS,
    resolved with t() where the row is rendered. */
const KIND_LABEL: Record<CellKind, string> = {
  text: "kind.text",
  number: "kind.number",
  temporal: "kind.temporal",
  bool: "kind.bool",
  blob: "kind.blob",
  null: "kind.null",
};

/** A built-in theme is named through i18n; an imported one by its file. */
const themeName = (th: Theme): string =>
  isBuiltinTheme(th.id) ? t(`theme.name.${th.id}`) : th.name;

export function SettingsPanel(props: {
  /** A section to show, asked for from outside (Ayuda › Acerca de, A-11): a
      new object each time, so asking twice shows it twice. */
  goTo?: { category: SettingsCategory };
  theme: ThemePref;
  onSetTheme: (p: ThemePref) => void;
  /** The theme in use, every theme on offer (built-in first), and the actions (#680). */
  themeId: string;
  themes: readonly Theme[];
  onSetThemeId: (id: string) => void;
  onImportTheme: (theme: Theme) => void;
  onRemoveTheme: (id: string) => void;
  /** The mode on screen, so the style cards preview the variant you would get. */
  resolvedMode?: ResolvedTheme;
  /** Colour overrides for the look in use (issue #483), and how to change them. */
  cellColors: CellColors;
  onSetCellColor: (kind: CellKind, hex: string | null) => void;
  onResetCellColors: () => void;
  historyLimit: number;
  onSetHistoryLimit: (n: number) => void;
  settings: Settings;
  onSetSettings: (patch: Partial<Settings>) => void;
  /** The shortcuts in force, the user's overrides behind them, and how to change them (#684). */
  shortcuts: readonly Shortcut[];
  shortcutOverrides: ShortcutOverrides;
  onSetShortcutOverrides: (o: ShortcutOverrides) => void;
  isMac: boolean;
  /** A whole configuration file, already parsed; App applies it to every store. */
  onImportConfig: (bundle: ConfigBundle) => void;
  /** «Buscar actualizaciones» (About): the explicit check, and how to show a
      newer version found (the update dialog). Absent: no button. */
  onCheckUpdate?: () => Promise<UpdateStatus>;
  onShowUpdate?: (info: UpdateInfo) => void;
  onClose?: () => void;
}) {
  /** What a colour is doing, shown beside its swatch. */
  const SAMPLE: Record<CellKind, () => string> = {
    text: () => t("settings.sampleText"),
    number: () => "1234.5",
    temporal: () => "2026-09-09",
    bool: () => "1",
    blob: () => "0x8f…",
    null: () => "NULL",
  };

  /** The colour in force for a kind: the override, else what the theme gives. */
  const inForce = (kind: CellKind, overrides: CellColors): string => {
    const own = overrides[kind];
    if (own !== undefined) return own;
    return readVar(CELL_VAR[kind]) || "#000000";
  };

  /** The background a cell colour is judged against. */
  const surfaceColor = () => readVar("--bg") || "#000000";

  /** A custom property as it currently resolves on the document. */
  const readVar = (name: string): string => {
    if (typeof document === "undefined") return "";
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };

  const [core, setCore] = createSignal<CoreInfo | null>(null);
  // The About check: null before it, "checking" while it runs.
  const [updateCheck, setUpdateCheck] = createSignal<UpdateStatus | "checking" | null>(null);
  const checkUpdate = async () => {
    if (!props.onCheckUpdate || updateCheck() === "checking") return;
    setUpdateCheck("checking");
    setUpdateCheck(await props.onCheckUpdate());
  };
  const system = () =>
    typeof navigator === "undefined" ? "?" : systemLine(navigator.platform ?? "", navigator.userAgent ?? "");
  const [coreErr, setCoreErr] = createSignal(false);

  const activeTheme = () => props.themes.find((th) => th.id === props.themeId) ?? props.themes[0];
  // The M14 styles (#747) get cards; every other theme, built-in or imported,
  // stays a chip below them.
  const styleThemes = () => props.themes.filter((th) => STYLE_THEME_IDS.includes(th.id));
  const otherThemes = () => props.themes.filter((th) => !STYLE_THEME_IDS.includes(th.id));

  // Import (#680): the file is parsed and validated here, pure functions all the
  // way; errors are listed, and a theme that is valid but has pairs under AA is
  // imported anyway with the pairs shown — it is the user's screen, but a theme
  // that silently cannot be read looks like a bug.
  const [importErrors, setImportErrors] = createSignal<ThemeError[]>([]);
  const [imported, setImported] = createSignal<Theme | null>(null);
  let fileInput!: HTMLInputElement;
  const onThemeFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const { theme, errors } = parseThemeJson(await file.text());
    setImportErrors(errors);
    setImported(theme);
    if (theme) props.onImportTheme(theme);
  };
  const describeError = (err: ThemeError) =>
    t(`theme.err.${err.code}`, { path: err.path, value: err.value ?? "" });
  const exportTheme = () =>
    void saveText(`${activeTheme().id}.theme.json`, serializeTheme(activeTheme()), "application/json");

  // The whole configuration as one file (#684). Parsing is tolerant per part,
  // like the stores' own parsers; only a file that is not an object is refused.
  const [configStatus, setConfigStatus] = createSignal<"imported" | "invalid" | null>(null);
  let configInput!: HTMLInputElement;
  const exportConfig = () =>
    void saveText(
      "squaero-settings.json",
      serializeConfigBundle({
        settings: props.settings,
        shortcuts: props.shortcutOverrides,
        theme: props.theme,
        themeId: props.themeId,
        historyLimit: props.historyLimit,
        locale: locale(),
      }),
      "application/json",
    );
  const onConfigFile = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const bundle = parseConfigBundle(await file.text());
    setConfigStatus(bundle ? "imported" : "invalid");
    if (bundle) props.onImportConfig(bundle);
  };

  // The core/protocol versions are the runtime source of truth (docs/IPC.md):
  // ask app.hello. Outside the native shell (plain browser) the bridge is
  // absent — show a dash rather than an error.
  onMount(async () => {
    try {
      const res = await call("app.hello");
      const r = (res as { result?: unknown }).result as Partial<CoreInfo> | undefined;
      if (r && typeof r.coreVersion === "string" && typeof r.protocolVersion === "number") {
        setCore({ coreVersion: r.coreVersion, protocolVersion: r.protocolVersion });
      } else {
        setCoreErr(true);
      }
    } catch {
      setCoreErr(true);
    }
  });

  // Navigation and search (#684). Without a query, one category is shown; with
  // one, every category that has a matching row, so a setting is found without
  // knowing where it was filed.
  const [category, setCategory] = createSignal<SettingsCategory>("general");
  const [query, setQuery] = createSignal("");
  createEffect(() => {
    const go = props.goTo;
    if (!go) return;
    setQuery("");
    setCategory(go.category);
  });
  const searching = () => query().trim() !== "";
  const visible = createMemo(() => new Set(searchSettings(query(), t)));
  const show = (id: string) => visible().has(id);
  const sectionShown = (cat: SettingsCategory) =>
    searching()
      ? SETTINGS_INDEX.some((e) => e.category === cat && visible().has(e.id))
      : category() === cat;
  const row = (id: string, el: () => JSX.Element) => <Show when={show(id)}>{el()}</Show>;

  /** Back to the defaults of one section: its Settings fields, plus the stores it shows. */
  const resetSection = (cat: SettingsCategory) => {
    const patch = sectionDefaults(cat);
    if (Object.keys(patch).length > 0) props.onSetSettings(patch);
    if (cat === "appearance") {
      props.onSetTheme("system");
      props.onSetThemeId(DEFAULT_THEME_ID);
    }
    if (cat === "grid") props.onResetCellColors();
    if (cat === "queries") props.onSetHistoryLimit(DEFAULT_HISTORY_LIMIT);
    if (cat === "shortcuts") props.onSetShortcutOverrides({});
  };

  // Rebinding (#684). "Cambiar" arms one row; the next key press on that button
  // is the new combo. The listener is attached natively (on:keydown), not
  // through Solid's delegation, so stopPropagation reaches it before App's
  // document-level matcher runs the old action — and before the Panel's Escape
  // closes the tab.
  const [capturing, setCapturing] = createSignal<ActionId | null>(null);
  const [scQuery, setScQuery] = createSignal("");
  const [scMessage, setScMessage] = createSignal<string | null>(null);
  const os = (): Os => (props.isMac ? "macos" : "windows");
  const actionName = (sc: Shortcut) => shortcutText(sc, props.isMac ? "macos" : "windows");
  const onCapture = (sc: Shortcut, e: KeyboardEvent) => {
    if (capturing() !== sc.id) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setCapturing(null);
      return;
    }
    const keys = comboFromEvent(e);
    if (keys === null) return; // only modifiers so far
    setCapturing(null);
    const err = validateCombo(keys);
    if (err) {
      setScMessage(t(`settings.sc.err.${err}`, keyParams({ mod: "Mod", alt: "Alt" }, os())));
      return;
    }
    const conflicts = findConflicts(keys, sc.id, props.shortcuts);
    if (conflicts.length > 0) {
      setScMessage(
        t("settings.sc.conflict", {
          keys: formatKeys(keys, props.isMac ? "macos" : "windows"),
          actions: conflicts.map(actionName).join(", "),
        }),
      );
      return;
    }
    setScMessage(null);
    props.onSetShortcutOverrides(setOverride(props.shortcutOverrides, sc.id, keys));
  };

  const chips = <T extends string | number>(
    label: string,
    opts: readonly T[],
    current: () => T,
    name: (v: T) => string,
    pick: (v: T) => void,
  ) => (
    <div class="settings-row">
      <span class="settings-label">{label}</span>
      <Segmented
        class="settings-choice"
        label={label}
        options={opts.map((o) => ({ value: o, label: name(o) }))}
        value={current()}
        onChange={pick}
      />
    </div>
  );

  const check = (
    key:
      | "colorTypes"
      | "showOldValues"
      | "editorLigatures"
      | "checkUpdatesOnStart"
      | "editorDiagnostics"
      | "builtinTemplates"
      | "nativeMenu"
      | "customTitleBar"
      | "highlightRun"
      | "headerTypes"
      | "docBar",
    label: string,
  ) => (
    <label class="settings-row settings-check">
      <input
        type="checkbox"
        checked={props.settings[key]}
        onChange={(e) => props.onSetSettings({ [key]: e.currentTarget.checked } as Partial<Settings>)}
      />
      <span class="settings-label">{label}</span>
    </label>
  );

  // The three font fields and the three size fields are one row each (#681).
  // The input shows what was STORED — the sanitized list — so a name that did
  // not survive is visibly gone rather than silently ignored.
  type FontKey = "uiFont" | "editorFont" | "gridFont";
  type SizeKey = "uiFontSize" | "editorFontSize" | "gridFontSize";
  const fontRow = (key: FontKey, choices: readonly string[]) => (
    <label class="settings-row">
      <span class="settings-label">{t(`settings.${key}`)}</span>
      <input
        type="text"
        list={`font-choices-${key}`}
        placeholder={t("settings.fontDefault")}
        value={props.settings[key]}
        onChange={(e) => {
          const clean = sanitizeFontFamily(e.currentTarget.value);
          e.currentTarget.value = clean;
          props.onSetSettings({ [key]: clean } as Partial<Settings>);
        }}
      />
      <datalist id={`font-choices-${key}`}>
        <For each={choices}>{(f) => <option value={f} />}</For>
      </datalist>
    </label>
  );
  const sizeRow = (key: SizeKey) => (
    <label class="settings-row">
      <span class="settings-label">{t(`settings.${key}`)}</span>
      <input
        type="number"
        min={MIN_FONT_PX}
        max={MAX_FONT_PX}
        value={props.settings[key]}
        onChange={(e) =>
          props.onSetSettings({
            [key]: clampFontSize(Number(e.currentTarget.value), props.settings[key]),
          } as Partial<Settings>)
        }
      />
    </label>
  );

  const SECTIONS: Record<SettingsCategory, () => JSX.Element> = {
    general: () => (
      <>
        {row("language", () => (
          <div class="settings-row">
            <span class="settings-label">{t("common.language")}</span>
            <Segmented
              class="settings-choice"
              label={t("common.language")}
              options={LOCALES.map((l) => ({ value: l, label: t(`lang.${l}`) }))}
              value={locale()}
              onChange={setLocale}
            />
          </div>
        ))}
        {row("startup", () => (
          <>
            {chips(
              t("settings.startup"),
              STARTUP_OPTS,
              () => props.settings.startup,
              (m) => t(`settings.startup.${m}`),
              (m) => props.onSetSettings({ startup: m }),
            )}
            <p class="settings-hint">{t("settings.startupHint")}</p>
          </>
        ))}
        {row("checkUpdates", () => check("checkUpdatesOnStart", t("settings.checkUpdates")))}
        {row("config", () => (
          <>
            <div class="settings-row settings-theme-actions">
              <button class="edit-btn" onClick={exportConfig}>
                {t("settings.exportConfig")}
              </button>
              <button class="edit-btn" onClick={() => configInput.click()}>
                {t("settings.importConfig")}
              </button>
              <input
                ref={configInput}
                type="file"
                accept="application/json,.json"
                style="display:none"
                aria-label={t("settings.importConfig")}
                onChange={onConfigFile}
              />
            </div>
            <Show when={configStatus()}>
              {(s) => (
                <p class="settings-hint" role={s() === "invalid" ? "alert" : "status"}>
                  {t(s() === "invalid" ? "settings.configInvalid" : "settings.configImported")}
                </p>
              )}
            </Show>
          </>
        ))}
      </>
    ),
    appearance: () => (
      <>
        {row("style", () => (
          <div class="style-cards" role="radiogroup" aria-label={t("settings.style")}>
            <For each={styleThemes()}>
              {(th) => (
                <button
                  class="style-card"
                  role="radio"
                  aria-checked={props.themeId === th.id}
                  onClick={() => props.onSetThemeId(th.id)}
                >
                  {/* A miniature of the window in the style's own tokens. */}
                  <span
                    class="style-preview"
                    aria-hidden="true"
                    style={themeVariables(th, props.resolvedMode ?? "light")}
                  >
                    <span class="style-preview-bar">
                      <i class="on" />
                      <i class="search" />
                    </span>
                    <span class="style-preview-body">
                      <span class="style-preview-rail">
                        <i class="on" />
                        <i />
                        <i />
                      </span>
                      <span class="style-preview-tree">
                        <i />
                        <i class="on" />
                        <i />
                      </span>
                      <span class="style-preview-content">
                        <span class="style-preview-head" />
                        <span class="style-preview-main">
                          <span class="style-preview-aa">Aa</span>
                          <span class="style-preview-lines">
                            <i />
                            <i class="on" />
                            <i class="faint" />
                          </span>
                        </span>
                      </span>
                    </span>
                  </span>
                  <span class="style-card-name">
                    <span class="style-card-radio" />
                    {themeName(th)}
                    <Show when={th.id === DEFAULT_THEME_ID}>
                      <span class="style-card-default">{t("settings.styleDefault")}</span>
                    </Show>
                  </span>
                  <span class="style-card-desc">{t(`theme.desc.${th.id}`)}</span>
                </button>
              )}
            </For>
          </div>
        ))}
        {/* Next to the style: what it looks like, then how much fits (#682).
            One density for the whole interface, the grid's rows included. */}
        {row("density", () => (
          <>
            {chips(
              t("settings.density"),
              DENSITY_OPTS,
              () => props.settings.density,
              (d) => t(`settings.density.${d}`),
              (d) => props.onSetSettings({ density: d }),
            )}
            <p class="settings-hint">{t("settings.densityHint")}</p>
          </>
        ))}
        {row("mode", () =>
          chips(t("settings.mode"), THEME_OPTS, () => props.theme, (m) => t(`settings.mode.${m}`), props.onSetTheme),
        )}
        {/* Every theme has a light and a dark variant (#680), so the mode
            above and the theme here are independent choices. */}
        {row("theme", () => (
          <>
            <div class="settings-row">
              <span class="settings-label">{t("settings.theme")}</span>
              <Segmented
                class="settings-choice"
                label={t("settings.theme")}
                options={otherThemes().map((th) => ({ value: th.id, label: themeName(th), title: themeName(th) }))}
                value={props.themeId}
                onChange={props.onSetThemeId}
              />
            </div>
            <div class="settings-row settings-theme-actions">
              <button class="edit-btn" onClick={() => fileInput.click()}>
                {t("settings.importTheme")}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="application/json,.json"
                style="display:none"
                aria-label={t("settings.importTheme")}
                onChange={onThemeFile}
              />
              <button class="edit-btn" onClick={exportTheme}>
                {t("settings.exportTheme")}
              </button>
              <Show when={!isBuiltinTheme(props.themeId)}>
                <button
                  class="edit-btn"
                  title={t("settings.deleteTheme", { name: themeName(activeTheme()) })}
                  onClick={() => props.onRemoveTheme(props.themeId)}
                >
                  {t("common.delete")}
                </button>
              </Show>
            </div>
            <Show when={importErrors().length > 0}>
              <div class="settings-hint settings-theme-report" role="alert">
                {t("settings.themeInvalid")}
                <ul>
                  <For each={importErrors()}>{(err) => <li>{describeError(err)}</li>}</For>
                </ul>
              </div>
            </Show>
            <Show when={imported()}>
              {(th) => {
                const issues = () => contrastIssues(th());
                return (
                  <div class="settings-hint settings-theme-report" role="status">
                    {t("settings.themeImported", { name: th().name })}
                    <Show when={issues().length > 0}>
                      {" "}
                      {t("settings.themeContrast", { name: th().name })}
                      <ul>
                        <For each={issues()}>
                          {(i) => (
                            <li>
                              {t("theme.pair", {
                                mode: i.mode,
                                fg: `--${i.fg}`,
                                bg: `--${i.bg}`,
                                ratio: String(i.ratio),
                                min: String(i.min),
                              })}
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  </div>
                );
              }}
            </Show>
          </>
        ))}
        {/* Typography (issue #681). A font field is an input with a datalist:
            the safe choices and free text in one control; what is typed goes
            through sanitizeFontFamily before it is stored, and the fallbacks are
            appended where the variable is written, never here. */}
        {row("zoom", () => (
          <>
            {chips(t("settings.zoom"), ZOOM_STEPS, () => props.settings.zoom, (z) => `${z}%`, (z) =>
              props.onSetSettings({ zoom: z }),
            )}
            <p class="settings-hint">
              {t("settings.zoomHint", {
                zoomIn: keysOf("zoom-in", props.shortcuts, os()),
                zoomOut: keysOf("zoom-out", props.shortcuts, os()),
                zoomReset: keysOf("zoom-reset", props.shortcuts, os()),
              })}
            </p>
          </>
        ))}
        {row("uiFont", () => (
          <>
            {fontRow("uiFont", UI_FONT_CHOICES)}
            {sizeRow("uiFontSize")}
            <p class="settings-hint">{t("settings.fontHint")}</p>
          </>
        ))}
      </>
    ),
    editor: () => (
      <>
        {row("runKey", () => (
          <>
            {chips(
              t("settings.runKey", { keys: formatKeys("Mod+Enter", os()) }),
              RUN_KEY_OPTS,
              () => props.settings.runKeyScope,
              (m) => t(`settings.runKey.${m}`),
              (m) => props.onSetSettings({ runKeyScope: m }),
            )}
            <p class="settings-hint">
              {t("settings.runKeyHint", { keys: formatKeys("Mod+Shift+Enter", os()) })}
            </p>
          </>
        ))}
        {row("highlightRun", () => check("highlightRun", t("settings.highlightRun")))}
        {row("editorFont", () => (
          <>
            {fontRow("editorFont", MONO_FONT_CHOICES)}
            {sizeRow("editorFontSize")}
          </>
        ))}
        {row("editorLineHeight", () => (
          <label class="settings-row">
            <span class="settings-label">{t("settings.editorLineHeight")}</span>
            <input
              type="number"
              step="0.1"
              min={MIN_LINE_HEIGHT}
              max={MAX_LINE_HEIGHT}
              value={props.settings.editorLineHeight}
              onChange={(e) =>
                props.onSetSettings({
                  editorLineHeight: clampLineHeight(
                    Number(e.currentTarget.value),
                    props.settings.editorLineHeight,
                  ),
                })
              }
            />
          </label>
        ))}
        {row("editorLigatures", () => check("editorLigatures", t("settings.editorLigatures")))}
        {row("editorDiagnostics", () => check("editorDiagnostics", t("settings.editorDiagnostics")))}
        {row("builtinTemplates", () => check("builtinTemplates", t("settings.builtinTemplates")))}
        {/* Local history of the editor tabs (issue #674). */}
        {row("localHistory", () => (
          <>
            <label class="settings-row">
              <span class="settings-label">{t("lhist.settingVersions")}</span>
              <input
                type="number"
                min={0}
                max={MAX_LOCAL_VERSIONS}
                value={props.settings.localHistoryVersions}
                onChange={(e) =>
                  props.onSetSettings({
                    localHistoryVersions: clampLocalVersions(Number(e.currentTarget.value)),
                  })
                }
              />
            </label>
            <label class="settings-row">
              <span class="settings-label">{t("lhist.settingDays")}</span>
              <input
                type="number"
                min={0}
                max={MAX_LOCAL_DAYS}
                value={props.settings.localHistoryDays}
                onChange={(e) =>
                  props.onSetSettings({
                    localHistoryDays: clampLocalDays(Number(e.currentTarget.value)),
                  })
                }
              />
            </label>
            <p class="settings-hint">{t("lhist.settingHint")}</p>
          </>
        ))}
      </>
    ),
    grid: () => (
      <>
        {/* Values as stored by default (audit rule 6); grouping is a choice. */}
        {row("numberFormat", () => (
          <>
            {chips(
              t("settings.numbers"),
              NUMBER_OPTS,
              () => props.settings.numberFormat,
              (m) => t(`settings.numbers.${m}`),
              (m) => props.onSetSettings({ numberFormat: m }),
            )}
            <p class="settings-hint">{t(`settings.numbersHint.${props.settings.numberFormat}`)}</p>
          </>
        ))}
        {row("nullText", () => (
          <>
            <label class="settings-row">
              <span class="settings-label">{t("settings.nullText")}</span>
              <input
                type="text"
                maxLength={MAX_NULL_TEXT}
                value={props.settings.nullText}
                onChange={(e) => {
                  const clean = cleanNullText(e.currentTarget.value);
                  e.currentTarget.value = clean;
                  props.onSetSettings({ nullText: clean });
                }}
              />
              <span class="settings-null-sample">{props.settings.nullText}</span>
            </label>
            <p class="settings-hint">{t("settings.nullTextHint")}</p>
          </>
        ))}
        {row("headerTypes", () => check("headerTypes", t("settings.headerTypes")))}
        {row("showOldValues", () => check("showOldValues", t("settings.showOldValues")))}
        {/* Colours per data type (issue #483). The swatch shows what is in
            force — the theme's own colour until this look is overridden —
            which is why the value is read back off the document rather than
            held in a signal here: the palette changes under it when the theme
            does, and a stale copy would show the previous theme's colour. */}
        {row("colorTypes", () => (
          <>
            {check("colorTypes", t("settings.colorTypes"))}
            <Show when={props.settings.colorTypes}>
              <div class="settings-row settings-colors">
                <span class="settings-label">{t("settings.typeColors")}</span>
                <div class="type-colors">
                  <For each={CELL_KINDS}>
                    {(kind) => {
                      const value = () => inForce(kind, props.cellColors);
                      const readable = () => isReadable(value(), surfaceColor());
                      return (
                        <div class="type-color">
                          <input
                            type="color"
                            class="type-color-swatch"
                            aria-label={t(KIND_LABEL[kind])}
                            value={value()}
                            onInput={(e) => props.onSetCellColor(kind, e.currentTarget.value)}
                          />
                          <span class="type-color-name">{t(KIND_LABEL[kind])}</span>
                          <span class="type-color-sample" style={{ color: value() }}>
                            {SAMPLE[kind]()}
                          </span>
                          {/* Not blocked, flagged: it is the user's grid, but a
                              column that has gone invisible looks like a bug. */}
                          <Show when={!readable()}>
                            <span class="type-color-warn" title={t("settings.lowContrast")}>
                              <Icon name="warning" size={14} />
                            </span>
                          </Show>
                          <Show when={props.cellColors[kind] !== undefined}>
                            <button
                              class="type-color-reset"
                              title={t("settings.resetColor", { kind: t(KIND_LABEL[kind]) })}
                              aria-label={t("settings.resetColor", { kind: t(KIND_LABEL[kind]) })}
                              onClick={() => props.onSetCellColor(kind, null)}
                            >
                              <Icon name="undo" size={14} />
                            </button>
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
                <button
                  class="settings-reset-colors"
                  disabled={Object.keys(props.cellColors).length === 0}
                  onClick={props.onResetCellColors}
                >
                  {t("settings.resetColors")}
                </button>
              </div>
            </Show>
          </>
        ))}
        {/* Each grid style carries its phrase because the names alone say nothing:
            "Informe" does not announce that it will group thousands. */}
        {row("gridStyle", () => (
          <>
            {chips(
              t("settings.gridStyle"),
              GRID_STYLE_OPTS,
              () => props.settings.gridStyle,
              (s) => t(`settings.gridStyle.${s}`),
              (s) => props.onSetSettings({ gridStyle: s }),
            )}
            <p class="settings-hint">{t(`settings.gridStyleHint.${props.settings.gridStyle}`)}</p>
          </>
        ))}
        {row("gridFont", () => (
          <>
            {fontRow("gridFont", MONO_FONT_CHOICES)}
            {sizeRow("gridFontSize")}
          </>
        ))}
      </>
    ),
    queries: () => (
      <>
        {row("slowThreshold", () => (
          <label class="settings-row">
            <span class="settings-label">{t("settings.slowThreshold")}</span>
            <input
              type="number"
              min={MIN_SLOW_MS}
              max={MAX_SLOW_MS}
              value={props.settings.slowThresholdMs}
              onChange={(e) =>
                props.onSetSettings({
                  slowThresholdMs: clampSlowThreshold(Number(e.currentTarget.value)),
                })
              }
            />
          </label>
        ))}
        {row("historyLimit", () => (
          <label class="settings-row">
            <span class="settings-label">{t("settings.historyLimit")}</span>
            <input
              type="number"
              min={MIN_HISTORY_LIMIT}
              max={MAX_HISTORY_LIMIT}
              value={props.historyLimit}
              onChange={(e) => props.onSetHistoryLimit(clampLimit(Number(e.currentTarget.value)))}
            />
          </label>
        ))}
      </>
    ),
    shortcuts: () =>
      row("shortcuts", () => (
        <>
          <p class="settings-hint">{t("settings.sc.hint", keyParams({ esc: "Esc" }, os()))}</p>
          {/* By area, with a search of its own (M14 SettingsShortcuts): by an
              action's name or its keys. */}
          <input
            type="search"
            class="shortcuts-search"
            placeholder={t("shortcuts.search")}
            aria-label={t("shortcuts.search")}
            value={scQuery()}
            onInput={(e) => setScQuery(e.currentTarget.value)}
          />
          <For
            each={groupShortcuts(props.shortcuts, {
              query: scQuery(),
              text: actionName,
              os: os(),
            })}
            fallback={<p class="settings-hint">{t("shortcuts.none", { query: scQuery().trim() })}</p>}
          >
            {(g) => (
              <section class="shortcuts-group" aria-label={t(`shortcuts.group.${g.group}`)}>
                <h4>{t(`shortcuts.group.${g.group}`)}</h4>
          <table class="shortcuts-list settings-shortcuts">
            <tbody>
              <For each={g.items}>
                {(sc) => {
                  const overridden = () => props.shortcutOverrides[sc.id] !== undefined;
                  return (
                    <tr>
                      <td>{actionName(sc)}</td>
                      <td class="keys">
                        <Show when={sc.keys} fallback={<span class="sc-none">{t("settings.sc.none")}</span>}>
                          <kbd>{formatKeys(sc.keys, props.isMac ? "macos" : "windows")}</kbd>
                        </Show>
                        <Show when={overridden()}>
                          <span class="settings-badge">{t("settings.sc.custom")}</span>
                        </Show>
                        <Show when={!isRebindable(sc)}>
                          <span class="settings-badge" title={t("settings.sc.hint", keyParams({ esc: "Esc" }, os()))}>
                            {t("settings.sc.fixed")}
                          </span>
                        </Show>
                      </td>
                      <td class="settings-sc-actions">
                        <Show when={isRebindable(sc)}>
                          <button
                            class={`edit-btn ${capturing() === sc.id ? "capturing" : ""}`}
                            aria-label={t("settings.sc.rebind", { action: actionName(sc) })}
                            onClick={() => {
                              setScMessage(null);
                              setCapturing(sc.id);
                            }}
                            on:keydown={(e) => onCapture(sc, e)}
                            onBlur={() => capturing() === sc.id && setCapturing(null)}
                          >
                            {capturing() === sc.id ? t("settings.sc.pressKeys") : t("settings.sc.change")}
                          </button>
                          <Show when={sc.keys}>
                            <button
                              class="edit-btn"
                              aria-label={t("settings.sc.unbindOne", { action: actionName(sc) })}
                              onClick={() => props.onSetShortcutOverrides(setOverride(props.shortcutOverrides, sc.id, ""))}
                            >
                              {t("settings.sc.unbind")}
                            </button>
                          </Show>
                          <Show when={overridden()}>
                            <button
                              class="edit-btn"
                              aria-label={t("settings.sc.resetOne", { action: actionName(sc) })}
                              onClick={() =>
                                props.onSetShortcutOverrides(clearOverride(props.shortcutOverrides, sc.id))
                              }
                            >
                              {t("settings.sc.reset")}
                            </button>
                          </Show>
                        </Show>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
              </section>
            )}
          </For>
          <Show when={scMessage()}>
            <p class="settings-hint" role="alert">
              {scMessage()}
            </p>
          </Show>
          <div class="settings-row settings-theme-actions">
            <button
              class="edit-btn"
              disabled={Object.keys(props.shortcutOverrides).length === 0}
              onClick={() => props.onSetShortcutOverrides({})}
            >
              {t("settings.sc.resetAll")}
            </button>
          </div>
        </>
      )),
    // The window's own furniture.
    window: () => (
      <>
        {row("docBar", () => (
          <>
            {check("docBar", t("settings.docBar"))}
            <p class="settings-hint">{t("settings.docBarHint")}</p>
          </>
        ))}
        {/* Only where the shell draws one that can be hidden (Windows, Linux —
            issue #686); a Mac always has its menu bar. */}
        <Show when={hasShellMenu() && !props.isMac}>
          {row("nativeMenu", () => check("nativeMenu", t("settings.nativeMenu")))}
        </Show>
        {/* Only where the shell can draw without its frame (Windows, macOS — #688). */}
        <Show when={hasWindowBinding()}>
          {row("customTitleBar", () => check("customTitleBar", t("settings.customTitleBar")))}
        </Show>
      </>
    ),
    about: () =>
      row("about", () => (
        <>
          <div class="settings-brand">
            <BrandWordmark height={44} />
            <p class="settings-tagline">{t("settings.about.tagline")}</p>
          </div>
          <dl class="settings-about">
            <dt>{t("settings.about.appVersion")}</dt>
            <dd>{APP_VERSION}</dd>
            <dt>{t("settings.about.coreVersion")}</dt>
            <dd>
              <Show when={core()} fallback={coreErr() ? "—" : "…"}>
                {(c) => c().coreVersion}
              </Show>
            </dd>
            <dt>{t("settings.about.protocol")}</dt>
            <dd>
              <Show when={core()} fallback={coreErr() ? "—" : "…"}>
                {(c) => `v${c().protocolVersion}`}
              </Show>
            </dd>
            <dt>{t("settings.about.system")}</dt>
            <dd>{system()}</dd>
            <dt>{t("settings.about.license")}</dt>
            <dd>{t("settings.about.licenseValue")}</dd>
          </dl>
          <Show when={props.onCheckUpdate}>
            <div class="settings-row settings-update">
              <button class="btn" disabled={updateCheck() === "checking"} onClick={() => void checkUpdate()}>
                {t("settings.about.checkUpdates")}
              </button>
              <span class="settings-hint" role="status">
                <Show when={updateCheck()} keyed>
                  {(v) => {
                    if (v === "checking") return t("settings.about.checking");
                    if (v.kind === "newer")
                      return (
                        <>
                          {t("settings.about.newer", { version: v.info.version })}{" "}
                          <button class="edit-btn" onClick={() => props.onShowUpdate?.(v.info)}>
                            {t("settings.about.seeUpdate")}
                          </button>
                        </>
                      );
                    return t(`settings.about.update.${v.kind}`);
                  }}
                </Show>
              </span>
            </div>
          </Show>
          <button
            class="btn"
            onClick={() =>
              copyText(
                aboutReport({
                  app: APP_VERSION,
                  core: core()?.coreVersion ?? null,
                  protocol: core()?.protocolVersion ?? null,
                  system: typeof navigator !== "undefined" ? `${system()} · ${navigator.userAgent}` : "",
                }),
              )
            }
          >
            {t("settings.about.copy")}
          </button>
          {/* Links open in the system browser (the webview has no tabs). */}
          <nav class="settings-links" aria-label={t("settings.about.links")}>
            <For each={ABOUT_LINK_KEYS}>
              {([key, url]) => (
                <a
                  href={url}
                  onClick={(e) => {
                    e.preventDefault();
                    openExternal(url);
                  }}
                >
                  {t(`settings.about.${key}`)}
                </a>
              )}
            </For>
          </nav>
          <p class="settings-hint">{t("settings.about.notices")}</p>
        </>
      )),
  };

  return (
    <Panel title={t("common.settings")} onClose={props.onClose} class="settings">
      <div class="settings-layout">
        <nav class="settings-nav" aria-label={t("settings.categories")}>
          <input
            type="search"
            class="settings-search"
            placeholder={t("settings.search")}
            aria-label={t("settings.search")}
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
          <For each={SETTINGS_CATEGORIES}>
            {(cat) => (
              <button
                class="settings-nav-item"
                aria-current={!searching() && category() === cat ? "true" : undefined}
                onClick={() => {
                  setQuery("");
                  setCategory(cat);
                }}
              >
                <Icon name={CATEGORY_ICON[cat]} size={15} class="settings-nav-ic" />
                {t(`settings.cat.${cat}`)}
              </button>
            )}
          </For>
          {/* While searching, the hits themselves, each with its category
              (M14 SettingsNav). */}
          <Show when={searching() && visible().size > 0}>
            <div class="settings-nav-hits" role="group" aria-label={t("settings.searchHits")}>
              <span class="settings-nav-hits-title">{t("settings.searchHits")}</span>
              <For each={SETTINGS_INDEX.filter((e) => visible().has(e.id))}>
                {(e) => (
                  <button
                    class="settings-nav-item settings-nav-hit"
                    onClick={() => {
                      setQuery("");
                      setCategory(e.category);
                    }}
                  >
                    <span class="settings-nav-hit-label">
                      {t(e.keys[0], { keys: formatKeys("Mod+Enter", os()) })}
                    </span>
                    <span class="settings-nav-hit-cat">{t(`settings.cat.${e.category}`)}</span>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </nav>
        <div class="settings-body">
          <For each={SETTINGS_CATEGORIES}>
            {(cat) => (
              <Show when={sectionShown(cat)}>
                <section class="settings-section" aria-label={t(`settings.cat.${cat}`)}>
                  <div class="settings-section-head">
                    <h3>{t(`settings.cat.${cat}`)}</h3>
                    <Show when={cat !== "about"}>
                      <button
                        class="settings-reset"
                        aria-label={`${t("settings.resetSection")}: ${t(`settings.cat.${cat}`)}`}
                        onClick={() => resetSection(cat)}
                      >
                        {t("settings.resetSection")}
                      </button>
                    </Show>
                  </div>
                  {SECTIONS[cat]()}
                </section>
              </Show>
            )}
          </For>
          <Show when={searching() && visible().size === 0}>
            <p class="settings-hint">{t("settings.noResults", { query: query().trim() })}</p>
          </Show>
        </div>
      </div>
    </Panel>
  );
}
