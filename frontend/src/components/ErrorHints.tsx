import { Show } from "solid-js";
import type { DidYouMean } from "../utils/errorHints";
import { t } from "../utils/i18n";

// Under a failed statement's message (issue #691, EditorError): the engine's
// code when its message states one, and «¿Querías …?» when the unknown name has
// a close match in the schema. Each part only when there is something true to say.
export function ErrorHints(props: { code: string | null; hint: DidYouMean | null }) {
  return (
    <Show when={props.code || props.hint}>
      <dl class="error-hints">
        <Show when={props.code}>
          <dt>{t("errorHints.code")}</dt>
          <dd class="num">{props.code}</dd>
        </Show>
        <Show when={props.hint}>
          {(h) => (
            <>
              <dt>{t(h().kind === "column" ? "errorHints.column" : "errorHints.table")}</dt>
              <dd>
                {t("errorHints.didYouMean.pre")}
                <code>{h().suggestion}</code>
                {t("errorHints.didYouMean.post")}
                <Show when={h().tables?.length}>
                  {" "}
                  <span class="error-hints-where">
                    {t("errorHints.inTables", { tables: h().tables!.join(", ") })}
                  </span>
                </Show>
              </dd>
            </>
          )}
        </Show>
      </dl>
    </Show>
  );
}
