import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { SettingsPanel } from "../../src/components/SettingsPanel";
import { DEFAULT_SETTINGS, type Settings } from "../../src/utils/settings";
import { APP_VERSION } from "../../src/utils/version";
import { BUILTIN_THEMES } from "../../src/utils/themes";
import { serializeTheme, type Theme } from "../../src/utils/themeSchema";
import { type CellColors } from "../../src/utils/cellColors";
import { type CellKind } from "../../src/utils/format";
import {
  SHORTCUTS,
  effectiveShortcuts,
  type Shortcut,
  type ShortcutOverrides,
} from "../../src/utils/shortcuts";
import type { ConfigBundle } from "../../src/utils/settingsCatalog";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as { quaeroRpc?: unknown }).quaeroRpc;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

function mount(over: {
  theme?: "system" | "light" | "dark";
  themeId?: string;
  themes?: readonly Theme[];
  settings?: Settings;
  onSetTheme?: (p: "system" | "light" | "dark") => void;
  onSetThemeId?: (id: string) => void;
  onImportTheme?: (t: Theme) => void;
  onRemoveTheme?: (id: string) => void;
  resolvedMode?: "light" | "dark";
  onSetHistoryLimit?: (n: number) => void;
  onSetSettings?: (p: Partial<Settings>) => void;
  cellColors?: CellColors;
  onSetCellColor?: (kind: CellKind, hex: string | null) => void;
  onResetCellColors?: () => void;
  shortcuts?: readonly Shortcut[];
  shortcutOverrides?: ShortcutOverrides;
  onSetShortcutOverrides?: (o: ShortcutOverrides) => void;
  isMac?: boolean;
  onImportConfig?: (b: ConfigBundle) => void;
} = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <SettingsPanel
          theme={over.theme ?? "system"}
          onSetTheme={over.onSetTheme ?? (() => {})}
          themeId={over.themeId ?? "indigo"}
          themes={over.themes ?? BUILTIN_THEMES}
          onSetThemeId={over.onSetThemeId ?? (() => {})}
          onImportTheme={over.onImportTheme ?? (() => {})}
          onRemoveTheme={over.onRemoveTheme ?? (() => {})}
          resolvedMode={over.resolvedMode}
          historyLimit={200}
          onSetHistoryLimit={over.onSetHistoryLimit ?? (() => {})}
          settings={over.settings ?? DEFAULT_SETTINGS}
          onSetSettings={over.onSetSettings ?? (() => {})}
          cellColors={over.cellColors ?? {}}
          onSetCellColor={over.onSetCellColor ?? (() => {})}
          onResetCellColors={over.onResetCellColors ?? (() => {})}
          shortcuts={over.shortcuts ?? SHORTCUTS}
          shortcutOverrides={over.shortcutOverrides ?? {}}
          onSetShortcutOverrides={over.onSetShortcutOverrides ?? (() => {})}
          isMac={over.isMac ?? false}
          onImportConfig={over.onImportConfig ?? (() => {})}
          onClose={() => {}}
        />
      ),
      host!,
    );
  });
}

/** Open a category from the navigation list (#684). */
const goto = (label: string) => {
  const btn = [...host!.querySelectorAll<HTMLButtonElement>(".settings-nav-item")].find(
    (b) => b.textContent === label,
  )!;
  btn.click();
};

const headings = () => [...host!.querySelectorAll(".settings-section h3")].map((h) => h.textContent);

const search = (q: string) => {
  const input = host!.querySelector<HTMLInputElement>(".settings-search")!;
  input.value = q;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

const chipTexts = () => [...host!.querySelectorAll(".chip")].map((c) => c.textContent);
const activeChips = () => [...host!.querySelectorAll(".chip.active")].map((c) => c.textContent);
const clickChip = (label: string) =>
  ([...host!.querySelectorAll(".chip")].find((c) => c.textContent === label) as HTMLButtonElement).click();

/** The number inputs of the "Consultas" section: slow threshold, history limit. */
const queryNumbers = () => {
  goto("Consultas");
  return host!.querySelectorAll<HTMLInputElement>('.settings-section input[type="number"]');
};

/** The checkbox on the row that reads `label` — there is more than one now. */
const checkbox = (label: string) =>
  [...host!.querySelectorAll<HTMLLabelElement>("label.settings-check")]
    .find((l) => l.textContent?.includes(label))!
    .querySelector<HTMLInputElement>('input[type="checkbox"]')!;

describe("SettingsPanel", () => {
  it("marks the active theme and density chips", () => {
    mount({ theme: "dark", settings: { ...DEFAULT_SETTINGS, gridDensity: "compact" } });
    goto("Apariencia");
    expect(activeChips()).toContain("Oscuro");
    goto("Rejilla");
    expect(activeChips()).toContain("Compacta");
  });

  // Issue #540: how the grid READS, next to how much of it fits. Two separate
  // settings — each style has its own normal and compact heights.
  it("offers the three grid styles and marks the active one", () => {
    mount({ settings: { ...DEFAULT_SETTINGS, gridStyle: "informe" } });
    goto("Rejilla");
    expect(chipTexts()).toEqual(expect.arrayContaining(["Registro", "Hoja densa", "Informe"]));
    expect(activeChips()).toContain("Informe");
  });

  // Typography (#681): the zoom steps as chips, and a font field that stores
  // only what survives the sanitizer.
  it("offers the zoom steps and marks the current one", () => {
    const onSetSettings = vi.fn();
    mount({ onSetSettings, settings: { ...DEFAULT_SETTINGS, zoom: 125 } });
    goto("Apariencia");
    expect(activeChips()).toContain("125%");
    clickChip("150%");
    expect(onSetSettings).toHaveBeenCalledWith({ zoom: 150 });
  });

  it("sanitizes a typed font family before storing it", () => {
    const onSetSettings = vi.fn();
    mount({ onSetSettings });
    goto("Editor");
    const input = host!.querySelector<HTMLInputElement>('input[list="font-choices-editorFont"]')!;
    expect(input.value).toBe("");
    input.value = "Fira Code; color: red, 'Fira Code', monospace";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSetSettings).toHaveBeenCalledWith({ editorFont: '"Fira Code", monospace' });
    expect(input.value).toBe('"Fira Code", monospace');
  });

  it("patches the grid style through the handler", () => {
    const onSetSettings = vi.fn();
    mount({ onSetSettings });
    goto("Rejilla");
    clickChip("Hoja densa");
    expect(onSetSettings).toHaveBeenCalledWith({ gridStyle: "hoja" });
  });

  // The names alone say nothing: "Informe" does not announce that it will group
  // thousands, which is the part worth warning about.
  it("describes the style that is selected, and follows the selection", () => {
    mount({ settings: { ...DEFAULT_SETTINGS, gridStyle: "informe" } });
    goto("Rejilla");
    expect(host!.textContent).toMatch(/Separa los miles/);

    dispose?.();
    host?.remove();
    mount({ settings: { ...DEFAULT_SETTINGS, gridStyle: "hoja" } });
    goto("Rejilla");
    expect(host!.textContent).toMatch(/hoja de cálculo/i);
  });

  it("reports a mode change through the handler", () => {
    const onSetTheme = vi.fn();
    mount({ theme: "system", onSetTheme });
    goto("Apariencia");
    clickChip("Claro");
    expect(onSetTheme).toHaveBeenCalledWith("light");
  });

  it("reports a theme change through the handler", () => {
    const onSetThemeId = vi.fn();
    mount({ themeId: "indigo", onSetThemeId });
    goto("Apariencia");
    clickChip("Azul");
    expect(onSetThemeId).toHaveBeenCalledWith("blue");
  });

  it("patches grid density and clamps the slow threshold", () => {
    const onSetSettings = vi.fn();
    mount({ onSetSettings });
    goto("Rejilla");
    clickChip("Compacta");
    expect(onSetSettings).toHaveBeenCalledWith({ gridDensity: "compact" });
    // slow threshold: a negative value clamps to 0
    const numbers = queryNumbers();
    numbers[0].value = "-50";
    numbers[0].dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSetSettings).toHaveBeenCalledWith({ slowThresholdMs: 0 });
  });

  it("routes the history limit through its own handler (single store)", () => {
    const onSetHistoryLimit = vi.fn();
    mount({ onSetHistoryLimit });
    const numbers = queryNumbers();
    // second number input of the section is the history limit
    numbers[1].value = "1"; // below MIN -> clamped to 10
    numbers[1].dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSetHistoryLimit).toHaveBeenCalledWith(10);
  });

  it("toggles check-updates-on-start", () => {
    const onSetSettings = vi.fn();
    mount({ settings: { ...DEFAULT_SETTINGS, checkUpdatesOnStart: true }, onSetSettings });
    const check = checkbox("Buscar actualizaciones");
    check.checked = false;
    check.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSetSettings).toHaveBeenCalledWith({ checkUpdatesOnStart: false });
  });

  // Issues #688/#690: the old value beside the new one is a grid preference.
  it("toggles showing the previous value of changed cells", () => {
    const onSetSettings = vi.fn();
    mount({ settings: { ...DEFAULT_SETTINGS, showOldValues: false }, onSetSettings });
    goto("Rejilla");
    const check = checkbox("Mostrar el valor anterior");
    expect(check.checked).toBe(false);
    check.checked = true;
    check.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onSetSettings).toHaveBeenCalledWith({ showOldValues: true });
  });

  it("shows the injected app version and the core version from app.hello", async () => {
    (globalThis as { quaeroRpc?: (r: string) => Promise<unknown> }).quaeroRpc = async (raw) => {
      const req = JSON.parse(raw) as { id: number; method: string };
      expect(req.method).toBe("app.hello");
      return { jsonrpc: "2.0", id: req.id, result: { name: "quaero", coreVersion: "9.9.9", protocolVersion: 6 } };
    };
    mount();
    await flush();
    goto("Acerca de");
    const about = host!.querySelector(".settings-about")!;
    expect(about.textContent).toContain(APP_VERSION);
    expect(about.textContent).toContain("9.9.9");
    expect(about.textContent).toContain("v6");
  });

  it("falls back to a dash when the bridge is unavailable", async () => {
    mount(); // no quaeroRpc installed -> call() throws
    await flush();
    goto("Acerca de");
    const about = host!.querySelector(".settings-about")!;
    expect(about.textContent).toContain("—");
  });

  it("falls back to a dash for a well-formed envelope with an ill-typed payload", async () => {
    (globalThis as { quaeroRpc?: (r: string) => Promise<unknown> }).quaeroRpc = async (raw) => {
      const req = JSON.parse(raw) as { id: number };
      // coreVersion is a number, protocolVersion missing — must not be shown.
      return { jsonrpc: "2.0", id: req.id, result: { coreVersion: 123 } };
    };
    mount();
    await flush();
    goto("Acerca de");
    const about = host!.querySelector(".settings-about")!;
    expect(about.textContent).toContain("—");
    expect(about.textContent).not.toContain("123");
  });
});

// Categories and search (#684): one category at a time from the list, and the
// search cuts across all of them.
describe("SettingsPanel — categories and search", () => {
  it("lists every category and opens General first", () => {
    mount();
    expect([...host!.querySelectorAll(".settings-nav-item")].map((b) => b.textContent)).toEqual([
      "General",
      "Apariencia",
      "Editor",
      "Rejilla",
      "Consultas",
      "Atajos de teclado",
      "Ventana",
      "Acerca de",
    ]);
    expect(headings()).toEqual(["General"]);
    goto("Editor");
    expect(headings()).toEqual(["Editor"]);
    expect(host!.querySelector('.settings-nav-item[aria-current="true"]')!.textContent).toBe("Editor");
  });

  it("finds a setting by its words, case and accents aside, across categories", () => {
    mount();
    search("TIPOGRAFIA");
    expect(headings()).toEqual(["Apariencia", "Editor", "Rejilla"]);
    expect(host!.querySelector('input[list="font-choices-gridFont"]')).not.toBeNull();
    // Only the matching rows of each category are shown.
    expect(host!.querySelector('[aria-label="Modo"]')).toBeNull();
  });

  it("says when nothing matches, and a category click clears the search", () => {
    mount();
    search("zzzz");
    expect(headings()).toEqual([]);
    expect(host!.textContent).toContain("Ningún ajuste coincide con «zzzz».");
    goto("Consultas");
    expect(headings()).toEqual(["Consultas"]);
    expect(host!.querySelector<HTMLInputElement>(".settings-search")!.value).toBe("");
  });

  it("resets one section to its defaults, stores included", () => {
    const onSetSettings = vi.fn();
    const onSetTheme = vi.fn();
    const onSetThemeId = vi.fn();
    const onSetHistoryLimit = vi.fn();
    mount({ onSetSettings, onSetTheme, onSetThemeId, onSetHistoryLimit, theme: "dark", themeId: "terminal" });
    goto("Apariencia");
    (host!.querySelector(".settings-reset") as HTMLButtonElement).click();
    expect(onSetSettings).toHaveBeenCalledWith({ zoom: 100, uiFont: "", uiFontSize: 12 });
    expect(onSetTheme).toHaveBeenCalledWith("system");
    expect(onSetThemeId).toHaveBeenCalledWith("nativo");
    goto("Consultas");
    (host!.querySelector(".settings-reset") as HTMLButtonElement).click();
    expect(onSetSettings).toHaveBeenCalledWith({ slowThresholdMs: 1000 });
    expect(onSetHistoryLimit).toHaveBeenCalledWith(200);
    goto("Acerca de");
    expect(host!.querySelector(".settings-reset")).toBeNull();
  });

  it("imports a configuration file through the handler, and refuses a wrong one", async () => {
    const onImportConfig = vi.fn();
    mount({ onImportConfig });
    const input = [...host!.querySelectorAll<HTMLInputElement>('input[type="file"]')].find(
      (i) => i.getAttribute("aria-label") === "Importar configuración…",
    )!;
    const choose = (text: string) => {
      const file = { name: "cfg.json", text: async () => text } as unknown as File;
      Object.defineProperty(input, "files", { value: [file], configurable: true });
      input.dispatchEvent(new Event("change"));
    };
    choose('{"settings":{"zoom":150},"theme":"dark"}');
    await flush();
    await flush();
    expect(onImportConfig).toHaveBeenCalledTimes(1);
    expect(onImportConfig.mock.calls[0][0].settings.zoom).toBe(150);
    expect(onImportConfig.mock.calls[0][0].theme).toBe("dark");
    expect(host!.textContent).toContain("Configuración importada.");

    choose("not json");
    await flush();
    await flush();
    expect(onImportConfig).toHaveBeenCalledTimes(1);
    expect(host!.textContent).toContain("El archivo no es una configuración de Squaero.");
  });
});

// The shortcut editor (#684): rebinding by pressing the keys, conflicts
// refused by name, reset one and all; the editor's keys are fixed.
describe("SettingsPanel — shortcuts", () => {
  const rowOf = (description: string) =>
    [...host!.querySelectorAll<HTMLTableRowElement>(".settings-shortcuts tr")].find(
      (r) => r.querySelector("td")?.textContent === description,
    )!;
  const press = (el: Element, init: KeyboardEventInit) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));

  it("lists every action with its keys, and marks the fixed ones", () => {
    mount({ shortcuts: effectiveShortcuts({ refresh: "Mod+R" }), shortcutOverrides: { refresh: "Mod+R" } });
    goto("Atajos de teclado");
    expect(host!.querySelectorAll(".settings-shortcuts tr").length).toBe(SHORTCUTS.length);
    const run = rowOf("Ejecutar la consulta");
    expect(run.querySelector("kbd")!.textContent).toBe("Ctrl+Enter");
    expect(run.textContent).toContain("Fijo");
    expect(run.querySelector("button")).toBeNull();
    const refresh = rowOf("Refrescar datos y árbol");
    expect(refresh.querySelector("kbd")!.textContent).toBe("Ctrl+R");
    expect(refresh.textContent).toContain("Personalizado");
  });

  it("rebinds an action to the keys pressed, and ignores a lone modifier", () => {
    const onSetShortcutOverrides = vi.fn();
    mount({ onSetShortcutOverrides });
    goto("Atajos de teclado");
    const btn = rowOf("Refrescar datos y árbol").querySelector("button")!;
    btn.click();
    expect(btn.textContent).toBe("Pulsa la combinación…");
    press(btn, { key: "Control", ctrlKey: true });
    expect(onSetShortcutOverrides).not.toHaveBeenCalled();
    const ev = new KeyboardEvent("keydown", { key: "r", ctrlKey: true, bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onSetShortcutOverrides).toHaveBeenCalledWith({ refresh: "Mod+R" });
    expect(btn.textContent).toBe("Cambiar");
  });

  it("refuses a combo another action uses, naming it, and a bare key", () => {
    const onSetShortcutOverrides = vi.fn();
    mount({ onSetShortcutOverrides });
    goto("Atajos de teclado");
    const btn = rowOf("Refrescar datos y árbol").querySelector("button")!;
    btn.click();
    press(btn, { key: "k", ctrlKey: true });
    expect(onSetShortcutOverrides).not.toHaveBeenCalled();
    expect(host!.querySelector('[role="alert"]')!.textContent).toBe("Ctrl+K ya lo usa: Paleta de comandos.");
    btn.click();
    press(btn, { key: "r" });
    expect(onSetShortcutOverrides).not.toHaveBeenCalled();
    expect(host!.querySelector('[role="alert"]')!.textContent).toContain("Una tecla sola");
  });

  it("cancels the capture with Escape, without closing the panel", () => {
    const onSetShortcutOverrides = vi.fn();
    mount({ onSetShortcutOverrides });
    goto("Atajos de teclado");
    const btn = rowOf("Refrescar datos y árbol").querySelector("button")!;
    btn.click();
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    btn.dispatchEvent(ev);
    expect(btn.textContent).toBe("Cambiar");
    expect(ev.defaultPrevented).toBe(true);
    expect(onSetShortcutOverrides).not.toHaveBeenCalled();
  });

  it("resets one action, and all of them", () => {
    const onSetShortcutOverrides = vi.fn();
    const overrides = { refresh: "Mod+R", "new-tab": "Mod+N" } as const;
    mount({ shortcuts: effectiveShortcuts(overrides), shortcutOverrides: overrides, onSetShortcutOverrides });
    goto("Atajos de teclado");
    const reset = [...rowOf("Refrescar datos y árbol").querySelectorAll("button")].find(
      (b) => b.textContent === "Restablecer",
    )!;
    reset.click();
    expect(onSetShortcutOverrides).toHaveBeenCalledWith({ "new-tab": "Mod+N" });
    const all = [...host!.querySelectorAll("button")].find(
      (b) => b.textContent === "Restablecer todos los atajos",
    )!;
    expect(all.disabled).toBe(false);
    all.click();
    expect(onSetShortcutOverrides).toHaveBeenCalledWith({});
  });
});

// Themes as data (#680): every theme has both variants, so the mode chips stay
// alive under every theme, imported ones included.
describe("SettingsPanel — themes", () => {
  const custom: Theme = { ...BUILTIN_THEMES.find((t) => t.id === "indigo")!, id: "mine", name: "Mine" };
  // jsdom's File has no text(); the panel only needs that one method.
  const chooseFile = (input: HTMLInputElement, text: string) => {
    const file = { name: "theme.json", text: async () => text } as unknown as File;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
  };
  const themeFileInput = () =>
    [...host!.querySelectorAll<HTMLInputElement>('input[type="file"]')].find(
      (i) => i.getAttribute("aria-label") === "Importar tema…",
    )!;

  // The M14 styles (#747) are cards; the rest stay chips.
  const cards = () => [...host!.querySelectorAll<HTMLButtonElement>('[aria-label="Estilo"] .style-card')];

  it("offers the four styles as cards, B · Nativo marked as the default", () => {
    mount({ themeId: "quiet" });
    goto("Apariencia");
    expect(cards().map((c) => c.querySelector(".style-card-name")!.textContent)).toEqual([
      "B · NativoPredeterminado",
      "A · Quiet pro",
      "C · Editorial",
      "Rosa pastel",
    ]);
    expect(cards().map((c) => c.getAttribute("aria-checked"))).toEqual(["false", "true", "false", "false"]);
    expect(cards()[3].textContent).toContain("Claro y suave, esquinas amplias. Figtree.");
  });

  it("picks a style through the theme handler", () => {
    const onSetThemeId = vi.fn();
    mount({ onSetThemeId });
    goto("Apariencia");
    cards()[2].click();
    expect(onSetThemeId).toHaveBeenCalledWith("editorial");
  });

  it("previews each style in its own tokens, in the mode on screen", () => {
    const rosa = BUILTIN_THEMES.find((t) => t.id === "rosa")!;
    const preview = () => cards()[3].querySelector<HTMLElement>(".style-preview")!;
    mount({});
    goto("Apariencia");
    expect(preview().style.getPropertyValue("--bg")).toBe(rosa.light.bg);
    expect(preview().style.getPropertyValue("--font-theme-ui")).toContain("Figtree");
    dispose?.();
    host?.remove();
    mount({ resolvedMode: "dark" });
    goto("Apariencia");
    expect(preview().style.getPropertyValue("--bg")).toBe(rosa.dark.bg);
  });

  it("offers every built-in theme by its translated name, then the imported ones", () => {
    mount({ themes: [...BUILTIN_THEMES, custom] });
    goto("Apariencia");
    const chips = [...host!.querySelectorAll('[aria-label="Otros temas"] .chip')].map((c) => c.textContent);
    expect(chips).toEqual([
      "Squaero (índigo)",
      "Azul",
      "Ciruela",
      "Pizarra",
      "Terminal",
      "Alto contraste",
      "Mine",
    ]);
  });

  it("keeps the mode chips alive under every theme", () => {
    mount({ themeId: "terminal" });
    goto("Apariencia");
    const chips = [...host!.querySelectorAll('[aria-label="Modo"] button')];
    expect(chips.length).toBe(3);
    expect(chips.some((c) => (c as HTMLButtonElement).disabled)).toBe(false);
  });

  it("offers delete only for an imported theme", () => {
    mount({ themeId: "indigo" });
    goto("Apariencia");
    expect(host!.textContent).not.toContain("Eliminar");
    const onRemoveTheme = vi.fn();
    mount({ themeId: "mine", themes: [...BUILTIN_THEMES, custom], onRemoveTheme });
    goto("Apariencia");
    const del = [...host!.querySelectorAll("button")].find((b) => b.textContent === "Eliminar")!;
    del.click();
    expect(onRemoveTheme).toHaveBeenCalledWith("mine");
  });

  it("imports a valid file through the handler and says so", async () => {
    const onImportTheme = vi.fn();
    mount({ onImportTheme });
    goto("Apariencia");
    const input = themeFileInput();
    chooseFile(input, serializeTheme(custom));
    input.dispatchEvent(new Event("change"));
    await flush();
    await flush();
    expect(onImportTheme).toHaveBeenCalledWith(custom);
    expect(host!.textContent).toContain("Tema «Mine» importado.");
  });

  it("lists what is wrong with an invalid file and imports nothing", async () => {
    const onImportTheme = vi.fn();
    mount({ onImportTheme });
    goto("Apariencia");
    const input = themeFileInput();
    const broken = JSON.parse(serializeTheme(custom));
    delete broken.dark.bg;
    broken.light.accent = "blue";
    chooseFile(input, JSON.stringify(broken));
    input.dispatchEvent(new Event("change"));
    await flush();
    await flush();
    expect(onImportTheme).not.toHaveBeenCalled();
    expect(host!.textContent).toContain("El archivo no es un tema válido:");
    expect(host!.textContent).toContain("falta dark.bg");
    expect(host!.textContent).toContain("light.accent: «blue» no es un color #rrggbb");
  });

  it("warns about the pairs under AA of an imported theme, without blocking it", async () => {
    const onImportTheme = vi.fn();
    mount({ onImportTheme });
    goto("Apariencia");
    const faint: Theme = { ...custom, dark: { ...custom.dark, "text-dim": "#55555f" } };
    const input = themeFileInput();
    chooseFile(input, serializeTheme(faint));
    input.dispatchEvent(new Event("change"));
    await flush();
    await flush();
    expect(onImportTheme).toHaveBeenCalledTimes(1);
    expect(host!.textContent).toContain("«Mine» tiene pares por debajo de WCAG AA:");
    expect(host!.textContent).toMatch(/dark: --text-dim sobre --bg da [\d.]+:1 \(mínimo 4.5:1\)/);
  });
});
