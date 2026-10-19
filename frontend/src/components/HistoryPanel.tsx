import { For, Show, createMemo, createSignal } from "solid-js";
import { Panel } from "./Panel";
import { t } from "../utils/i18n";
import { autoFocus } from "../utils/autoFocus";
import { historyEngines, searchHistory, type HistoryEntry } from "../utils/history";
import { formatDuration, isSlow } from "../utils/duration";
import { Dropdown } from "./Dropdown";

// Query-history panel (issue #128): search executed queries and re-run one in a
// new tab. Filtering is pure (searchHistory); the clear action is lifted to the
// workspace, which owns persistence. The saved-entry limit is now configured in
// the Settings panel (issue #181), not here. Each entry shows its duration and
// slow runs (over the configured threshold) are marked and filterable (#179).
// Opened from the editor bar.
export function HistoryPanel(props: {
  entries: HistoryEntry[];
  /** Slow-query threshold in ms (from settings); marks + filters slow runs. */
  slowThresholdMs: number;
  /** The focused connection's driver: the engine filter starts on it (#642). */
  engine?: string;
  onRun: (sql: string) => void;
  onClear: () => void;
  onClose: () => void;
  /** Shown in the side column (#689): running an entry keeps it open. */
  docked?: boolean;
}) {
  const [query, setQuery] = createSignal("");
  const [onlySlow, setOnlySlow] = createSignal(false);
  const engines = createMemo(() => historyEngines(props.entries));
  // Start on the focused connection's engine when the history has any of it;
  // "" is every engine, legacy entries without one included.
  const [engine, setEngine] = createSignal(
    props.engine && engines().includes(props.engine) ? props.engine : "",
  );
  const results = createMemo(() => {
    const matched = searchHistory(props.entries, query(), undefined, engine() || undefined);
    return onlySlow() ? matched.filter((e) => isSlow(e.durationMs, props.slowThresholdMs)) : matched;
  });

  const pick = (sql: string) => {
    props.onRun(sql);
    if (!props.docked) props.onClose();
  };

  return (
    <Panel title={t("hist.title")} class="history" docked={props.docked} onClose={props.onClose}>
      <h2>{t("hist.title")}</h2>
      <div class="history-controls">
        <input
          class="history-search"
          type="search"
          placeholder={t("hist.searchPlaceholder")}
          aria-label={t("hist.searchLabel")}
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
          ref={autoFocus}
        />
        <Show when={engines().length > 0}>
          <Dropdown
            value={engine()}
            options={[{ value: "", label: t("hist.allEngines") }, ...engines().map((en) => ({ value: en, label: en }))]}
            onChange={(v) => setEngine(v)}
            class="history-engine"
            aria-label={t("hist.engineLabel")}
          />
        </Show>
        <label class="history-only-slow" title={t("hist.onlySlowTitle")}>
          <input
            type="checkbox"
            checked={onlySlow()}
            onChange={(e) => setOnlySlow(e.currentTarget.checked)}
          />
          {t("hist.onlySlow")}
        </label>
      </div>

      <Show
        when={results().length > 0}
        fallback={
          <p class="history-empty">
            {props.entries.length === 0
              ? t("hist.none")
              : t("hist.noMatches")}
          </p>
        }
      >
        <ul class="history-list">
          <For each={results()}>
            {(e) => {
              const slow = () => isSlow(e.durationMs, props.slowThresholdMs);
              return (
                <li class="history-item">
                  <button
                    class="history-run"
                    title={t("hist.rerun")}
                    onClick={() => pick(e.sql)}
                  >
                    <span class="history-sql">{e.sql}</span>
                    <span class="history-meta">
                      {e.connName || t("hist.noConnection")}
                      <Show when={e.engine}> ({e.engine})</Show> · {new Date(e.ts).toLocaleString()}
                      <Show when={e.durationMs !== undefined}>
                        {" · "}
                        <span class={`history-duration ${slow() ? "slow" : ""}`}>
                          {formatDuration(e.durationMs!)}
                          <Show when={slow()}>{t("hist.slowTag")}</Show>
                        </span>
                      </Show>
                    </span>
                  </button>
                </li>
              );
            }}
          </For>
        </ul>
      </Show>

      <div class="modal-actions">
        <button
          class="danger"
          onClick={props.onClear}
          disabled={props.entries.length === 0}
        >
          {t("hist.clear")}
        </button>
        <button class="primary" onClick={props.onClose}>
          {t("common.close")}
        </button>
      </div>
    </Panel>
  );
}
