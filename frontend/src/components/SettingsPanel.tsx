import { createSignal, onMount, Show, For } from "solid-js";
import { Panel } from "./Panel";
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

export function SettingsPanel(props: {
  theme: ThemePref;
  onSetTheme: (p: ThemePref) => void;
  historyLimit: number;
  onSetHistoryLimit: (n: number) => void;
  settings: Settings;
  onSetSettings: (patch: Partial<Settings>) => void;
  onClose?: () => void;
}) {
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
            <span class="settings-label">Tema</span>
            <div class="settings-choice" role="radiogroup" aria-label="Tema">
              <For each={THEME_OPTS}>
                {(o) => (
                  <button
                    class={`chip ${props.theme === o.value ? "active" : ""}`}
                    role="radio"
                    aria-checked={props.theme === o.value}
                    title={themeLabel(o.value)}
                    onClick={() => props.onSetTheme(o.value)}
                  >
                    {o.label}
                  </button>
                )}
              </For>
            </div>
          </div>
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
