import { Show } from "solid-js";
import { themeLabel, themeIcon, type ThemePref } from "../utils/theme";
import { scopeLabel, type RunScope } from "../utils/runScope";

// Bottom status bar: active connection, row count of the current result, and
// the elapsed time of the last query, plus the theme toggle and shortcuts help
// (issue #42). Values and handlers are passed in by the workspace.
export function StatusBar(props: {
  connection: string | null;
  rowCount: number | null;
  truncated: boolean;
  elapsedMs: number | null;
  /** What the last run executed, for the run-scope indicator (issue #130). */
  ranScope?: RunScope | null;
  theme: ThemePref;
  onToggleTheme: () => void;
  onShowHelp: () => void;
}) {
  return (
    <footer class="statusbar">
      <span class="status-item">
        <span class={`conn-dot ${props.connection ? "on" : "off"}`} />
        {props.connection ?? "Sin conexión"}
      </span>
      <span class="status-spacer" />
      <Show when={props.ranScope}>
        <span class="status-item" title="Alcance de la última ejecución">
          ▷ {scopeLabel(props.ranScope!)}
        </span>
      </Show>
      <Show when={props.rowCount !== null}>
        <span class="status-item">
          {props.rowCount} fila{props.rowCount === 1 ? "" : "s"}
          {props.truncated ? "+" : ""}
        </span>
      </Show>
      <Show when={props.elapsedMs !== null}>
        <span class="status-item">{props.elapsedMs!.toFixed(0)} ms</span>
      </Show>
      <button
        class="status-btn"
        title={`${themeLabel(props.theme)} (Ctrl+Alt+L)`}
        aria-label={themeLabel(props.theme)}
        onClick={props.onToggleTheme}
      >
        {themeIcon(props.theme)}
      </button>
      <button
        class="status-btn"
        title="Atajos de teclado (F1)"
        aria-label="Atajos de teclado"
        onClick={props.onShowHelp}
      >
        ?
      </button>
    </footer>
  );
}
