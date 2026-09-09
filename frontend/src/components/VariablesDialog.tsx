import { For, Show, createSignal, onCleanup, onMount } from "solid-js";

import { t } from "../utils/i18n";
import type { SqlVariable, VarValue, VarValues } from "../utils/sqlVariables";

// Values for the variables a statement carries (issue #481).
//
// Opens when a run finds a variable with nothing to write, and comes back with
// one row per variable — the token as its label, so what to fill in is the same
// string that is in the editor. The value form gets a NULL switch beside the box:
// a row whose value really is the text "NULL" has to stay possible, which is the
// rule the grid already follows for editing a cell (issue #398).
//
// Enter runs, unlike ConfirmDialog: this dialog is a form standing between the
// user and the statement they already asked for, not a last chance to think
// again about something destructive.
export function VariablesDialog(props: {
  variables: readonly SqlVariable[];
  /** Values to start from — what this tab used last time. */
  values: VarValues;
  onRun: (values: VarValues) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = createSignal<VarValues>({ ...props.values });
  let dialogEl: HTMLDivElement | undefined;
  let firstInput: HTMLInputElement | undefined;
  let restoreFocus: HTMLElement | null = null;

  const valueOf = (token: string): VarValue => draft()[token] ?? { text: "" };
  const setValue = (token: string, patch: Partial<VarValue>) =>
    setDraft((d) => ({ ...d, [token]: { ...valueOf(token), ...patch } }));

  /** Nothing to write: a blank box that is not an explicit NULL. */
  const blank = (v: SqlVariable): boolean => {
    const value = valueOf(v.token);
    return !value.isNull && value.text.trim() === "";
  };
  const ready = () => props.variables.every((v) => !blank(v));

  const run = () => {
    if (ready()) props.onRun(draft());
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onCancel();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      run();
      return;
    }
    if (e.key === "Tab") {
      const focusables = dialogEl?.querySelectorAll<HTMLElement>(
        "input:not([disabled]), button:not([disabled])",
      );
      if (!focusables || focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement;
      if (active && !dialogEl?.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  onMount(() => {
    restoreFocus = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", onKeyDown, true);
    firstInput?.focus();
    firstInput?.select();
  });
  onCleanup(() => {
    document.removeEventListener("keydown", onKeyDown, true);
    restoreFocus?.focus?.();
  });

  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onCancel();
      }}
    >
      <div
        class="modal vars-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="vars-dialog-title"
        ref={dialogEl}
      >
        <h2 id="vars-dialog-title">{t("vars.title")}</h2>
        <p class="vars-hint">{t("vars.hint")}</p>
        <div class="vars-rows">
          <For each={props.variables}>
            {(v, i) => (
              <div class="vars-row">
                <label class="vars-name" for={`var-${v.token}`}>
                  <code>{v.token}</code>
                </label>
                <input
                  id={`var-${v.token}`}
                  ref={(el) => {
                    if (i() === 0) firstInput = el;
                  }}
                  class="vars-input"
                  type="text"
                  value={valueOf(v.token).text}
                  disabled={valueOf(v.token).isNull}
                  placeholder={v.kind === "raw" ? t("vars.rawHint") : t("vars.valueHint")}
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
              </div>
            )}
          </For>
        </div>
        <div class="modal-actions">
          <button onClick={props.onCancel}>{t("common.cancel")}</button>
          <button class="primary" disabled={!ready()} onClick={run}>
            {t("editor.run")}
          </button>
        </div>
      </div>
    </div>
  );
}
