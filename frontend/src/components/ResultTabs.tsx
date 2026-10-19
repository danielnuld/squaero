import { For, Show } from "solid-js";
import { setKind, setCount, type ScriptSet } from "../utils/scriptRuns";
import { t } from "../utils/i18n";

// One tab per statement of a script (issue #450). A script used to leave a
// single result on screen — the last that returned columns — so every earlier
// SELECT ran against the server and then vanished.
//
// The strip sits ABOVE the object toolbar on purpose: the tab chooses which
// result Refrescar / Graficar / Exportar act on, so it has to come first. It
// borrows the app's nested-tab vocabulary (.otab, the object list's type strip)
// rather than the workspace tab bar's — these are not tabs of the same rank.
//
// Beside them, «Mensajes» and «Plan» (issue #691, EditorMultipleResults,
// ExplainPlan): what each run said, and the last EXPLAIN. With no script there
// is one «Resultado» tab in the statements' place, so the strip reads the same.
// While a script runs, each statement's tab appears as it finishes.
export type ResultView = "result" | "messages" | "plan";

export function ResultTabs(props: {
  sets: ScriptSet[];
  active: number;
  onSelect: (index: number) => void;
  /** Which of the result / messages / plan views is shown. */
  view?: ResultView;
  /** Given, the strip also offers the messages and plan views. */
  onView?: (view: ResultView) => void;
  /** A script is running: the statement on its way, after those that finished
      (M14 EditorRunning). Its tab is there but holds nothing yet. */
  running?: { label: string } | null;
}) {
  const view = () => props.view ?? "result";
  const summary = (s: ScriptSet): string => {
    const kind = setKind(s);
    if (kind === "error") return t("result.setFailed");
    const n = setCount(s);
    return kind === "rows" ? t("result.setRows", { n }) : t("result.setAffected", { n });
  };

  return (
    <div class="result-tabs" role="tablist" aria-label={t("result.tabsAria")}>
      <For each={props.sets}>
        {(s, i) => (
          <button
            class="rtab"
            classList={{ on: view() === "result" && i() === props.active }}
            role="tab"
            aria-selected={view() === "result" && i() === props.active}
            /* The whole statement in the tooltip: the label is a table name or a
               keyword, which is not enough to tell two of them apart. */
            title={s.sql}
            onClick={() => {
              props.onSelect(i());
              props.onView?.("result");
            }}
          >
            <span class={`rtab-mk is-${setKind(s)}`} aria-hidden="true" />
            <span class="rtab-n">{i() + 1}</span>
            <span class="rtab-label">{s.label}</span>
            <span class="rtab-ct">{summary(s)}</span>
          </button>
        )}
      </For>
      <Show when={props.running}>
        {(r) => (
          <span
            class="rtab is-running"
            classList={{ on: view() === "result" && props.active === props.sets.length }}
            role="tab"
            aria-selected={view() === "result" && props.active === props.sets.length}
            aria-disabled="true"
          >
            <span class="tab-spinner" aria-hidden="true" />
            <span class="rtab-n">{props.sets.length + 1}</span>
            <span class="rtab-label">{r().label}</span>
            <span class="rtab-ct">{t("result.setRunning")}</span>
          </span>
        )}
      </Show>
      <Show when={props.onView}>
        {(onView) => (
          <>
            <Show when={props.sets.length <= 1 && !props.running}>
              <ViewTab label={t("result.viewResult")} on={view() === "result"} onClick={() => onView()("result")} />
            </Show>
            <ViewTab label={t("result.viewMessages")} on={view() === "messages"} onClick={() => onView()("messages")} />
            <ViewTab label={t("result.viewPlan")} on={view() === "plan"} onClick={() => onView()("plan")} />
          </>
        )}
      </Show>
    </div>
  );
}

function ViewTab(props: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      class="rtab rtab-view"
      classList={{ on: props.on }}
      role="tab"
      aria-selected={props.on}
      onClick={() => props.onClick()}
    >
      <span class="rtab-label">{props.label}</span>
    </button>
  );
}
