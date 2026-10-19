import { For, Show } from "solid-js";
import type { RunMessage } from "../utils/runMessages";
import { formatClock, formatDuration } from "../utils/duration";
import { t } from "../utils/i18n";

// The «Mensajes» tab of the result pane (issue #691, EditorMultipleResults):
// one line per statement run in this tab, oldest first, with when it ran, what
// it did and how long it took. Presentational; utils/runMessages builds the log.
export function ResultMessages(props: { messages: readonly RunMessage[] }) {
  const what = (m: RunMessage) =>
    m.kind === "rows"
      ? t("messages.rows", { n: m.n ?? 0 })
      : m.kind === "affected"
        ? t("messages.affected", { n: m.n ?? 0 })
        : (m.text ?? "");
  return (
    <div class="run-messages" role="log" aria-label={t("messages.aria")}>
      <Show when={props.messages.length > 0} fallback={<p class="grid-empty">{t("messages.empty")}</p>}>
        <ol>
          <For each={props.messages}>
            {(m) => (
              <li class={`run-msg is-${m.kind}`}>
                <time class="run-msg-at">{formatClock(m.at)}</time>
                <span class="run-msg-what">{what(m)}</span>
                <Show when={m.ms !== undefined}>
                  <span class="run-msg-ms">{formatDuration(m.ms!)}</span>
                </Show>
                <code class="run-msg-sql" title={m.sql}>
                  {m.sql.replace(/\s+/g, " ")}
                </code>
              </li>
            )}
          </For>
        </ol>
      </Show>
    </div>
  );
}
