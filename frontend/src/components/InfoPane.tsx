import { For, Show, createMemo, createSignal } from "solid-js";
import {
  generalInfo,
  messageInfo,
  summaryLine,
  type InfoInput,
} from "../utils/infoPane";
import { t } from "../utils/i18n";

// Bottom information pane (UI design proposal, phase 4). A collapsible strip
// under the workspace summarizing the active result: General facts and the last
// operation's Message. Collapsed by default (a one-line summary in the header)
// so it never steals vertical space unasked; click the header to expand. Purely
// derived from the tab's result state — no new data is fetched.
export function InfoPane(props: { info: InfoInput }) {
  const [open, setOpen] = createSignal(false);
  const [tab, setTab] = createSignal<"general" | "mensajes">("general");

  const general = createMemo(() => generalInfo(props.info, t));
  const message = createMemo(() => messageInfo(props.info, t));
  const summary = createMemo(() => summaryLine(props.info, t));

  return (
    <div class={`infopane ${open() ? "open" : ""}`}>
      <div class="infopane-head">
        <button
          class="infopane-toggle"
          aria-expanded={open()}
          title={open() ? t("info.hide") : t("info.show")}
          onClick={() => setOpen((v) => !v)}
        >
          <span class="infopane-chevron">{open() ? "▾" : "▸"}</span>
          {t("info.title")}
        </button>
        <Show
          when={open()}
          fallback={<span class="infopane-summary">{summary()}</span>}
        >
          <div class="infopane-tabs" role="tablist" aria-label={t("info.title")}>
            <button
              class={`infopane-tab ${tab() === "general" ? "on" : ""}`}
              role="tab"
              aria-selected={tab() === "general"}
              onClick={() => setTab("general")}
            >
              {t("info.general")}
            </button>
            <button
              class={`infopane-tab ${tab() === "mensajes" ? "on" : ""}`}
              role="tab"
              aria-selected={tab() === "mensajes"}
              onClick={() => setTab("mensajes")}
            >
              {t("info.messages")}
            </button>
          </div>
        </Show>
      </div>

      <Show when={open()}>
        <div class="infopane-body">
          <Show when={tab() === "general"}>
            <div class="infopane-kv">
              <For each={general()}>
                {(row) => (
                  <div class="infopane-pair">
                    <span class="infopane-k">{row.k}</span>
                    <span class="infopane-v">{row.v}</span>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={tab() === "mensajes"}>
            <p class={`infopane-msg kind-${message().kind}`}>{message().text}</p>
          </Show>
        </div>
      </Show>
    </div>
  );
}
