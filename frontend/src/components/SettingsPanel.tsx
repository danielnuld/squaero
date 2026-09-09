import { createSignal, onMount, Show, For } from "solid-js";
import { Panel } from "./Panel";
import { BrandWordmark } from "./Brand";
import { call } from "../utils/transport";
import { APP_VERSION, REPO_URL } from "../utils/version";
import {
  clampSlowThreshold,
  MIN_SLOW_MS,
  MAX_SLOW_MS,
  type GridDensity,
  type Settings,
} from "../utils/settings";
import { clampLimit, MIN_HISTORY_LIMIT, MAX_HISTORY_LIMIT } from "../utils/history";
import { themeLabel, type ThemePref } from "../utils/theme";
import { SKINS, skinLabel, isDarkOnly, type SkinPref } from "../utils/skin";
import {
  CELL_KINDS,
  CELL_VAR,
  isReadable,
  type CellColors,
} from "../utils/cellColors";
import type { CellKind } from "../utils/format";
import { locale, setLocale, LOCALES, t } from "../utils/i18n";

// Settings + About panel (issue #181), opened as a tool tab. Fully controlled:
// the workspace (App) owns every preference signal and passes current values +
// change handlers, so there is no local state to drift out of sync when the tab
// is reused. Theme and the history limit live in their own stores (theme.ts /
// historyStore) and are edited here through the same handlers App already uses —
// no duplicate state. The core/protocol versions come live from `app.hello`.

const THEME_OPTS: { value: ThemePref; label: string }[] = [
  { value: "system", label: "Sistema" },
  { value: "light", label: "Claro" },
  { value: "dark", label: "Oscuro" },
];


const DENSITY_OPTS: { value: GridDensity; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "compact", label: "Compacta" },
];

interface CoreInfo {
  coreVersion: string;
  protocolVersion: number;
}

/** What each type is called where the user picks its colour. */
const KIND_LABEL: Record<CellKind, string> = {
  text: "Texto",
  number: "Números",
  temporal: "Fecha y hora",
  bool: "Booleanos",
  blob: "Binarios",
  null: "NULL",
};

export function SettingsPanel(props: {
  theme: ThemePref;
  onSetTheme: (p: ThemePref) => void;
  skin: SkinPref;
  onSetSkin: (s: SkinPref) => void;
  /** Colour overrides for the look in use (issue #483), and how to change them. */
  cellColors: CellColors;
  onSetCellColor: (kind: CellKind, hex: string | null) => void;
  onResetCellColors: () => void;
  historyLimit: number;
  onSetHistoryLimit: (n: number) => void;
  settings: Settings;
  onSetSettings: (patch: Partial<Settings>) => void;
  onClose?: () => void;
}) {
  /** What a colour is doing, shown beside its swatch. */
  const SAMPLE: Record<CellKind, string> = {
    text: "texto",
    number: "1234.5",
    temporal: "2026-09-09",
    bool: "1",
    blob: "0x8f…",
    null: "NULL",
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
  const [coreErr, setCoreErr] = createSignal(false);

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

  return (
    <Panel title="Ajustes" onClose={props.onClose} class="settings">
      <div class="settings-body">
        <section class="settings-section">
          <h3>Apariencia</h3>
          <div class="settings-row">
            <span class="settings-label">{t("common.language")}</span>
            <div class="settings-choice" role="radiogroup" aria-label={t("common.language")}>
              <For each={LOCALES}>
                {(l) => (
                  <button
                    class={`chip ${locale() === l ? "active" : ""}`}
                    role="radio"
                    aria-checked={locale() === l}
                    onClick={() => setLocale(l)}
                  >
                    {t(`lang.${l}`)}
                  </button>
                )}
              </For>
            </div>
          </div>
          <div class="settings-row">
            <span class="settings-label">Tema</span>
            {/* Ciruela, Pizarra y Terminal traen sus propias superficies y no
                tienen variante clara (issue #473): mientras uno esté puesto, el
                conmutador se apaga y dice por qué, en vez de dejar pulsar
                "Claro" y no cambiar nada. La preferencia se conserva. */}
            <div class="settings-choice" role="radiogroup" aria-label="Tema">
              <For each={THEME_OPTS}>
                {(o) => (
                  <button
                    class={`chip ${props.theme === o.value ? "active" : ""}`}
                    role="radio"
                    aria-checked={props.theme === o.value}
                    disabled={isDarkOnly(props.skin)}
                    title={
                      isDarkOnly(props.skin)
                        ? `${skinLabel(props.skin)} — sólo tiene versión oscura`
                        : themeLabel(o.value)
                    }
                    onClick={() => props.onSetTheme(o.value)}
                  >
                    {o.label}
                  </button>
                )}
              </For>
            </div>
          </div>
          <div class="settings-row">
            <span class="settings-label">Estilo</span>
            <div class="settings-choice" role="radiogroup" aria-label="Estilo de color">
              <For each={SKINS}>
                {(o) => (
                  <button
                    class={`chip ${props.skin === o.value ? "active" : ""}`}
                    role="radio"
                    aria-checked={props.skin === o.value}
                    title={skinLabel(o.value)}
                    onClick={() => props.onSetSkin(o.value)}
                  >
                    {o.label}
                  </button>
                )}
              </For>
            </div>
          </div>
          {/* Colours per data type (issue #483). The swatch shows what is in
              force — the theme's own colour until this look is overridden —
              which is why the value is read back off the document rather than
              held in a signal here: the palette changes under it when the theme
              does, and a stale copy would show the previous theme's colour. */}
          <label class="settings-row settings-check">
            <input
              type="checkbox"
              checked={props.settings.colorTypes}
              onChange={(e) => props.onSetSettings({ colorTypes: e.currentTarget.checked })}
            />
            <span class="settings-label">Colorear los datos por tipo</span>
          </label>
          <Show when={props.settings.colorTypes}>
            <div class="settings-row settings-colors">
              <span class="settings-label">Colores por tipo</span>
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
                          aria-label={KIND_LABEL[kind]}
                          value={value()}
                          onInput={(e) => props.onSetCellColor(kind, e.currentTarget.value)}
                        />
                        <span class="type-color-name">{KIND_LABEL[kind]}</span>
                        <span class="type-color-sample" style={{ color: value() }}>
                          {SAMPLE[kind]}
                        </span>
                        {/* Not blocked, flagged: it is the user's grid, but a
                            column that has gone invisible looks like a bug. */}
                        <Show when={!readable()}>
                          <span class="type-color-warn" title="Contraste bajo sobre el fondo">
                            ⚠
                          </span>
                        </Show>
                        <Show when={props.cellColors[kind] !== undefined}>
                          <button
                            class="type-color-reset"
                            title={`Volver al color del tema para ${KIND_LABEL[kind]}`}
                            onClick={() => props.onSetCellColor(kind, null)}
                          >
                            ⟲
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
                Restablecer los colores de este tema
              </button>
            </div>
          </Show>
          <label class="settings-row settings-check">
            <input
              type="checkbox"
              checked={props.settings.toolStrip}
              onChange={(e) => props.onSetSettings({ toolStrip: e.currentTarget.checked })}
            />
            <span class="settings-label">Barra de herramientas bajo las pestañas</span>
          </label>
          <div class="settings-row">
            <span class="settings-label">Densidad del grid</span>
            <div class="settings-choice" role="radiogroup" aria-label="Densidad del grid">
              <For each={DENSITY_OPTS}>
                {(o) => (
                  <button
                    class={`chip ${props.settings.gridDensity === o.value ? "active" : ""}`}
                    role="radio"
                    aria-checked={props.settings.gridDensity === o.value}
                    onClick={() => props.onSetSettings({ gridDensity: o.value })}
                  >
                    {o.label}
                  </button>
                )}
              </For>
            </div>
          </div>
        </section>

        <section class="settings-section">
          <h3>Consultas</h3>
          <label class="settings-row">
            <span class="settings-label">Umbral de consulta lenta (ms)</span>
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
          <label class="settings-row">
            <span class="settings-label">Límite de historial</span>
            <input
              type="number"
              min={MIN_HISTORY_LIMIT}
              max={MAX_HISTORY_LIMIT}
              value={props.historyLimit}
              onChange={(e) => props.onSetHistoryLimit(clampLimit(Number(e.currentTarget.value)))}
            />
          </label>
        </section>

        <section class="settings-section">
          <h3>Actualizaciones</h3>
          <label class="settings-row settings-check">
            <input
              type="checkbox"
              checked={props.settings.checkUpdatesOnStart}
              onChange={(e) =>
                props.onSetSettings({ checkUpdatesOnStart: e.currentTarget.checked })
              }
            />
            <span class="settings-label">Buscar actualizaciones al iniciar</span>
          </label>
        </section>

        <section class="settings-section">
          <h3>Acerca de</h3>
          <div class="settings-brand">
            <BrandWordmark height={44} />
            <p class="settings-tagline">Ligero, local y libre.</p>
          </div>
          <dl class="settings-about">
            <dt>Versión de la app</dt>
            <dd>{APP_VERSION}</dd>
            <dt>Versión del núcleo</dt>
            <dd>
              <Show when={core()} fallback={coreErr() ? "—" : "…"}>
                {(c) => c().coreVersion}
              </Show>
            </dd>
            <dt>Protocolo IPC</dt>
            <dd>
              <Show when={core()} fallback={coreErr() ? "—" : "…"}>
                {(c) => `v${c().protocolVersion}`}
              </Show>
            </dd>
          </dl>
          <div class="settings-links">
            <a href={REPO_URL} target="_blank" rel="noreferrer">
              Repositorio
            </a>
            <a href={`${REPO_URL}/blob/main/THIRD-PARTY.md`} target="_blank" rel="noreferrer">
              Licencias de terceros
            </a>
          </div>
        </section>
      </div>
    </Panel>
  );
}
