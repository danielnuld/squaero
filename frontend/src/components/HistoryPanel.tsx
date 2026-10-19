import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";
import { Panel } from "./Panel";
import { ConfirmDialog } from "./ConfirmDialog";
import { clearHistoryConfirm } from "../utils/confirmText";
import { t } from "../utils/i18n";
import { autoFocus } from "../utils/autoFocus";
import {
  groupByDay,
  historyEngines,
  scopeHistory,
  searchHistory,
  type HistoryEntry,
  type HistoryScope,
} from "../utils/history";
import { countText } from "../utils/confirmText";
import { Segmented } from "./Segmented";
import { formatDuration, isSlow } from "../utils/duration";
import { Dropdown } from "./Dropdown";
import { EmptyNote } from "./EmptyNote";

// Query-history panel (issue #128): search executed queries and reuse one. A
// click only selects (and shows the whole statement); inserting, opening in a new
// tab or running are explicit buttons, so a stray click never re-runs an UPDATE.
// Double click inserts in the active tab. Filtering is pure (searchHistory); the clear action is lifted to the
// workspace, which owns persistence. The saved-entry limit is now configured in
// the Settings panel (issue #181), not here. Each entry shows its duration and
// slow runs (over the configured threshold) are marked and filterable (#179).
// Opened from the editor bar.
// P6 (prototype HistoryPanel): Todas | Esta conexión | Errores, entries grouped
// by day, and each one says its connection, database, time, duration and what
// came back (rows, rows changed, or that it failed).
export function HistoryPanel(props: {
  entries: HistoryEntry[];
  /** Slow-query threshold in ms (from settings); marks + filters slow runs. */
  slowThresholdMs: number;
  /** The focused connection's driver: the engine filter starts on it (#642). */
  engine?: string;
  /** The focused saved connection: «Esta conexión». */
  connId?: string;
  /** «Ejecutar»: runs in a new tab, through the normal run path. */
  onRun: (sql: string) => void;
  /** «Insertar»: at the caret of the active query tab. */
  onInsert: (sql: string) => void;
  /** «Abrir en pestaña nueva», without running. */
  onOpen: (sql: string) => void;
  onClear: () => void;
  onClose: () => void;
  /** Shown in the side column (#689): running an entry keeps it open. */
  docked?: boolean;
  /** The empty history's one action (#694); absent → none offered. */
  onNewQuery?: () => void;
  /** Search the history starts on (a run's «Ver en el historial», #691). */
  initialQuery?: string;
}) {
  const [query, setQuery] = createSignal(props.initialQuery ?? "");
  // Opened again on another run (the result's «Ver en el historial», #691).
  createEffect(on(() => props.initialQuery, (q) => q !== undefined && setQuery(q), { defer: true }));
  const [onlySlow, setOnlySlow] = createSignal(false);
  const [scope, setScope] = createSignal<HistoryScope>("all");
  const [confirmClear, setConfirmClear] = createSignal(false);
  const engines = createMemo(() => historyEngines(props.entries));
  // Start on the focused connection's engine when the history has any of it;
  // "" is every engine, legacy entries without one included.
  const [engine, setEngine] = createSignal(
    props.engine && engines().includes(props.engine) ? props.engine : "",
  );
  const results = createMemo(() => {
    const matched = searchHistory(
      scopeHistory(props.entries, scope(), props.connId),
      query(),
      undefined,
      engine() || undefined,
    );
    return onlySlow() ? matched.filter((e) => isSlow(e.durationMs, props.slowThresholdMs)) : matched;
  });

  const [selected, setSelected] = createSignal<HistoryEntry | null>(null);
  const days = createMemo(() => groupByDay(results(), Date.now()));
  const dayLabel = (d: { day: string; date: string; entries: HistoryEntry[] }) =>
    d.day === "today"
      ? t("hist.today")
      : d.day === "yesterday"
        ? t("hist.yesterday")
        : new Date(d.entries[0].ts).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  const outcome = (e: HistoryEntry) =>
    e.failed
      ? null
      : e.rows !== undefined
        ? countText("hist.rows", e.rows)
        : e.affected !== undefined
          ? countText("hist.affected", e.affected)
          : null;
  const pick = (action: (sql: string) => void, sql: string) => {
    action(sql);
    if (!props.docked) props.onClose();
  };

  return (
    <Panel title={t("hist.title")} class="history" docked={props.docked} onClose={props.onClose}>
      <h2>{t("hist.title")}</h2>
      <Segmented
        label={t("hist.scopeAria")}
        class="history-scope"
        value={scope()}
        options={[
          { value: "all" as HistoryScope, label: t("hist.scopeAll") },
          {
            value: "conn" as HistoryScope,
            label: t("hist.scopeConn"),
            disabled: !props.connId,
            title: props.connId ? undefined : t("hist.scopeConnNone"),
          },
          { value: "errors" as HistoryScope, label: t("hist.scopeErrors") },
        ]}
        onChange={setScope}
      />
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
          <Show
            when={props.entries.length > 0}
            fallback={
              <EmptyNote
                title={t("hist.noneTitle")}
                text={t("hist.none")}
                action={props.onNewQuery ? { label: t("home.newQuery"), onClick: props.onNewQuery } : undefined}
              />
            }
          >
            <EmptyNote
              title={t("empty.noResultsTitle")}
              text={t("hist.noMatches")}
              action={{
                label: t("empty.clearSearch"),
                onClick: () => {
                  setQuery("");
                  setEngine("");
                  setOnlySlow(false);
                  setScope("all");
                },
              }}
            />
          </Show>
        }
      >
        <ul class="history-list">
          <For each={days()}>
            {(d) => (
              <>
                <li class="history-day" role="presentation">
                  {dayLabel(d)}
                </li>
          <For each={d.entries}>
            {(e) => {
              const slow = () => isSlow(e.durationMs, props.slowThresholdMs);
              return (
                <li class="history-item">
                  <button
                    class="history-run"
                    classList={{ active: selected() === e }}
                    aria-expanded={selected() === e}
                    title={t("hist.pickHint")}
                    onClick={() => setSelected(e)}
                    onDblClick={() => pick(props.onInsert, e.sql)}
                  >
                    <span class="history-sql">{e.sql}</span>
                    <span class="history-meta">
                      {e.connName || t("hist.noConnection")}
                      <Show when={e.engine}> ({e.engine})</Show>
                      <Show when={e.db}> · {e.db}</Show> ·{" "}
                      {new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      <Show when={e.durationMs !== undefined}>
                        {" · "}
                        <span class={`history-duration ${slow() ? "slow" : ""}`}>
                          {formatDuration(e.durationMs!)}
                          <Show when={slow()}>{t("hist.slowTag")}</Show>
                        </span>
                      </Show>
                      <Show when={outcome(e)}>{(o) => ` · ${o()}`}</Show>
                      <Show when={e.failed}>
                        {" · "}
                        <span class="chip history-error">{t("hist.errorTag")}</span>
                      </Show>
                    </span>
                  </button>
                  <Show when={selected() === e}>
                    <div class="history-actions">
                      <button class="btn" onClick={() => pick(props.onInsert, e.sql)}>
                        {t("hist.insert")}
                      </button>
                      <button class="btn" onClick={() => pick(props.onOpen, e.sql)}>
                        {t("hist.openNewTab")}
                      </button>
                      <button class="btn" onClick={() => pick(props.onRun, e.sql)}>
                        {t("hist.run")}
                      </button>
                    </div>
                  </Show>
                </li>
              );
            }}
          </For>
              </>
            )}
          </For>
        </ul>
        <p class="help">{t("hist.footHint")}</p>
      </Show>

      {/* No «Cerrar» here (audit A-21): the panel lives in a tab or the side
          column, which close themselves. Clearing asks first (A-10, R-31). */}
      <div class="panel-foot">
        <button
          class="btn danger-text"
          onClick={() => setConfirmClear(true)}
          disabled={props.entries.length === 0}
        >
          {t("hist.clear")}
        </button>
      </div>
      <Show when={confirmClear()}>
        <ConfirmDialog
          title={clearHistoryConfirm(props.entries.length).title}
          message={clearHistoryConfirm(props.entries.length).message}
          confirmLabel={clearHistoryConfirm(props.entries.length).confirm}
          onConfirm={() => {
            setConfirmClear(false);
            props.onClear();
          }}
          onCancel={() => setConfirmClear(false)}
        />
      </Show>
    </Panel>
  );
}
