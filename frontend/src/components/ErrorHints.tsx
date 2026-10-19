import { Show } from "solid-js";
import type { DidYouMean } from "../utils/errorHints";
import { t } from "../utils/i18n";

// Under a failed statement's message (issue #691, EditorError): the engine's
// code when its message states one, «¿Querías …?» when the unknown name has a
// close match in the schema, and on a lock error the question that usually
// answers it (A-07) — with the way to the tab holding a transaction, if any.
// Each part only when there is something true to say.
export function ErrorHints(props: {
  code: string | null;
  hint: DidYouMean | null;
  /** The engine refused over a lock (errorHints.isLockError). */
  lock?: boolean;
  /** Shows the tab whose connection holds an open transaction, when one does. */
  onLockTab?: () => void;
  /** A protected connection refused the write (M14 SafeModeReadonly): the two
      ways on — run it elsewhere, or change the protection. */
  safeBlock?: { onOtherConnection: (e: MouseEvent) => void; onChangeProtection: () => void };
}) {
  return (
    <Show when={props.code || props.hint || props.lock || props.safeBlock}>
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
        <Show when={props.safeBlock}>
          {(b) => (
            <>
              <dt>{t("errorHints.safe")}</dt>
              <dd class="error-hints-actions">
                <button
                  type="button"
                  class="edit-btn"
                  aria-haspopup="menu"
                  onClick={(e) => b().onOtherConnection(e)}
                >
                  {t("errorHints.safeOther")}
                </button>
                <button type="button" class="edit-btn" onClick={() => b().onChangeProtection()}>
                  {t("errorHints.safeChange")}
                </button>
              </dd>
            </>
          )}
        </Show>
        <Show when={props.lock}>
          <dt>{t("errorHints.lock")}</dt>
          <dd>
            {t("errorHints.lockQuestion")}
            <Show when={props.onLockTab}>
              {" "}
              <button type="button" class="edit-btn" onClick={() => props.onLockTab?.()}>
                {t("errorHints.lockGo")}
              </button>
            </Show>
          </dd>
        </Show>
      </dl>
    </Show>
  );
}
