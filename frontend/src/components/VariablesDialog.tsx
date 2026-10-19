import { For, Show, createSignal } from "solid-js";

import { t } from "../utils/i18n";
import { Dialog } from "./Dialog";
import type { SqlVariable, VarValue, VarValues } from "../utils/sqlVariables";

// Values for the variables a statement carries (issue #481).
//
// Opens when a run finds a variable with nothing to write, and comes back with
// one row per variable — the token as its label, so what to fill in is the same
// string that is in the editor. The value form gets a NULL switch beside the box:
// a row whose value really is the text "NULL" has to stay possible, which is the
// rule the grid already follows for editing a cell (issue #398).
//
// Enter runs (the shared Dialog presses the primary from a field), unlike
// ConfirmDialog: this is a form standing between the user and the statement
// they already asked for, not a last chance to think again about something
// destructive.
export function VariablesDialog(props: {
  variables: readonly SqlVariable[];
  /** Values to start from — what this tab used last time. */
  values: VarValues;
  onRun: (values: VarValues) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = createSignal<VarValues>({ ...props.values });
  // Run stays pressable (audit A-35): pressing it with a blank box says which
  // one is missing, next to it, instead of a grey button that explains nothing.
  const [tried, setTried] = createSignal(false);
  const inputs: Record<string, HTMLInputElement> = {};

  const valueOf = (token: string): VarValue => draft()[token] ?? { text: "" };
  const setValue = (token: string, patch: Partial<VarValue>) =>
    setDraft((d) => ({ ...d, [token]: { ...valueOf(token), ...patch } }));

  /** Nothing to write: a blank box that is not an explicit NULL. */
  const blank = (v: SqlVariable): boolean => {
    const value = valueOf(v.token);
    return !value.isNull && value.text.trim() === "";
  };

  const run = () => {
    const missing = props.variables.find(blank);
    if (!missing) {
      props.onRun(draft());
      return;
    }
    setTried(true);
    inputs[missing.token]?.focus();
  };

  return (
    <Dialog
      title={t("vars.title")}
      size="md"
      class="vars-dialog"
      onCancel={props.onCancel}
      primary={{ label: t("editor.run"), onClick: run }}
    >
      <p class="vars-hint">{t("vars.hint")}</p>
      <div class="vars-rows">
        <For each={props.variables}>
          {(v) => (
            <div class="vars-row">
              <label class="vars-name" for={`var-${v.token}`}>
                <code>{v.token}</code>
              </label>
              <input
                id={`var-${v.token}`}
                ref={(el) => (inputs[v.token] = el)}
                class="vars-input"
                classList={{ "input-invalid": tried() && blank(v) }}
                type="text"
                value={valueOf(v.token).text}
                disabled={valueOf(v.token).isNull}
                placeholder={v.kind === "raw" ? t("vars.rawHint") : t("vars.valueHint")}
                aria-invalid={tried() && blank(v)}
                aria-describedby={tried() && blank(v) ? `var-err-${v.token}` : undefined}
                onInput={(e) => setValue(v.token, { text: e.currentTarget.value })}
              />
              {/* Only a value can be NULL: raw text stands for a piece of the
                  statement, and "NULL" there is just the word. */}
              <Show when={v.kind === "value"} fallback={<span class="vars-null-gap" />}>
                <label class="vars-null">
                  <input
                    type="checkbox"
                    checked={!!valueOf(v.token).isNull}
                    onChange={(e) => setValue(v.token, { isNull: e.currentTarget.checked })}
                  />
                  NULL
                </label>
              </Show>
              <Show when={tried() && blank(v)}>
                <span class="field-error vars-error" id={`var-err-${v.token}`}>
                  {t("vars.missing", { token: v.token })}
                </span>
              </Show>
            </div>
          )}
        </For>
      </div>
    </Dialog>
  );
}
