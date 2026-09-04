import { For } from "solid-js";
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
export function ResultTabs(props: {
  sets: ScriptSet[];
  active: number;
  onSelect: (index: number) => void;
}) {
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
            classList={{ on: i() === props.active }}
            role="tab"
            aria-selected={i() === props.active}
            /* The whole statement in the tooltip: the label is a table name or a
               keyword, which is not enough to tell two of them apart. */
            title={s.sql}
            onClick={() => props.onSelect(i())}
          >
            <span class={`rtab-mk is-${setKind(s)}`} aria-hidden="true" />
            <span class="rtab-n">{i() + 1}</span>
            <span class="rtab-label">{s.label}</span>
            <span class="rtab-ct">{summary(s)}</span>
          </button>
        )}
      </For>
    </div>
  );
}
