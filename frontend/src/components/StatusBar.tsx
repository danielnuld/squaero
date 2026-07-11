import { Show } from "solid-js";
import { themeIcon, type ThemePref } from "../utils/theme";
import { type RunScope } from "../utils/runScope";
import { formatDuration } from "../utils/duration";
import { t } from "../utils/i18n";

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
  onShowSettings: () => void;
}) {
  return (
    <footer class="statusbar">
      <span class="status-item">
        <span class={`conn-dot ${props.connection ? "on" : "off"}`} />
        {props.connection ?? t("status.noConnection")}
      </span>
      <span class="status-spacer" />
      <Show when={props.ranScope}>
        <span class="status-item" title={t("status.scopeTitle")}>
          ▷ {t(`scope.${props.ranScope}`)}
        </span>
      </Show>
      <Show when={props.rowCount !== null}>
        <span class="status-item">
          {t(props.rowCount === 1 ? "status.rowsOne" : "status.rowsOther", {
            n: props.rowCount!,
          })}
          {props.truncated ? "+" : ""}
        </span>
      </Show>
      <Show when={props.elapsedMs !== null}>
        <span class="status-item" title={t("status.durationTitle")}>
          {formatDuration(props.elapsedMs!)}
        </span>
      </Show>
      <button
        class="status-btn"
        title={`${t(`theme.${props.theme}`)} (Ctrl+Alt+L)`}
        aria-label={t(`theme.${props.theme}`)}
        onClick={props.onToggleTheme}
      >
        {themeIcon(props.theme)}
      </button>
      <button
        class="status-btn"
        title={t("common.settings")}
        aria-label={t("common.settings")}
        onClick={props.onShowSettings}
      >
        ⚙
      </button>
      <button
        class="status-btn"
        title={`${t("status.shortcuts")} (F1)`}
        aria-label={t("status.shortcuts")}
        onClick={props.onShowHelp}
      >
        ?
      </button>
    </footer>
  );
}
