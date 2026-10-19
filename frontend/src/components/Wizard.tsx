import { For, Show, type JSX } from "solid-js";
import { Icon } from "./icons";
import { t } from "../utils/i18n";
import { currentOs, orderActions } from "../utils/dialog";
import { stepStates } from "../utils/wizard";
import type { ErrorPolicy } from "../utils/importers";
import type { DialogPrimary } from "./Dialog";

// The one wizard of the app (issue #692): import, transfer, structure and data
// sync, the data generator and backup all read the same way — a title, the
// numbered steps with the current one marked, a form with the labels in one
// column, and a footer that always says [Atrás] … [the verb with its count]
// [Cancelar], the last two in the operating system's order like a dialog's.
// It fills the tool tab it opens in (a Panel), so the tab keeps its own close.

export function Wizard(props: {
  title: string;
  /** One line under the title: what it works on (source, rows, connection). */
  subtitle?: string;
  /** Step names; none for a one-screen tool. */
  steps?: string[];
  /** The step on screen, 0-based; `steps.length` is the result screen. */
  step?: number;
  /** Given, the footer starts with «Atrás». */
  onBack?: () => void;
  primary?: DialogPrimary;
  /** «Cancelar» before acting, «Cerrar» once it is done (glossary). */
  cancelLabel?: string;
  onCancel?: () => void;
  /** Secondary actions, after «Atrás». */
  helpers?: JSX.Element;
  /** An operation is in flight: the footer's buttons wait. */
  busy?: boolean;
  /** What the primary says while busy. */
  busyLabel?: string;
  error?: string | null;
  children?: JSX.Element;
}) {
  const states = () => stepStates(props.steps?.length ?? 0, props.step ?? 0);

  const primaryButton = () => (
    <Show when={props.primary}>
      {(p) => (
        <button
          type="button"
          class={p().danger ? "btn btn-danger" : "btn btn-primary"}
          disabled={props.busy || p().disabled}
          onClick={() => p().onClick()}
        >
          {props.busy && props.busyLabel ? props.busyLabel : p().label}
        </button>
      )}
    </Show>
  );
  const cancelButton = () => (
    <Show when={props.onCancel}>
      <button type="button" class="btn" disabled={props.busy} onClick={() => props.onCancel?.()}>
        {props.cancelLabel ?? t("common.cancel")}
      </button>
    </Show>
  );

  return (
    <div class="wiz">
      <header class="wiz-head">
        <h2>{props.title}</h2>
        <Show when={props.subtitle}>
          <p class="wiz-sub">{props.subtitle}</p>
        </Show>
        <Show when={(props.steps?.length ?? 0) > 0}>
          <ol class="wiz-steps" aria-label={t("wiz.steps")}>
            <For each={props.steps}>
              {(name, i) => (
                <li class={`wiz-step is-${states()[i()]}`} aria-current={states()[i()] === "current" ? "step" : undefined}>
                  <span class="wiz-num" aria-hidden="true">
                    <Show when={states()[i()] === "done"} fallback={i() + 1}>
                      <Icon name="check" size={12} />
                    </Show>
                  </span>
                  {name}
                </li>
              )}
            </For>
          </ol>
        </Show>
      </header>
      <div class="wiz-body">
        <Show when={props.error}>
          <div class="grid-error" role="alert">
            {props.error}
          </div>
        </Show>
        {props.children}
      </div>
      <footer class="wiz-foot">
        <Show when={props.onBack}>
          <button type="button" class="btn" disabled={props.busy} onClick={() => props.onBack?.()}>
            {t("wiz.back")}
          </button>
        </Show>
        {props.helpers}
        <span class="dlg-spacer" />
        <span class="dlg-actions">{orderActions(currentOs(), [primaryButton(), cancelButton()])}</span>
      </footer>
    </div>
  );
}

/**
 * One row of a wizard form: the label in the fixed left column, the control on
 * the right, help or an error under it. The label wraps the control, so the
 * control is named by it (a Dropdown's button included).
 */
export function WizardField(props: { label: string; help?: string; error?: string | null; children: JSX.Element }) {
  return (
    <div class="wiz-row">
      <label class="wiz-field">
        <span class="wiz-label">{props.label}</span>
        <span class="wiz-ctl">{props.children}</span>
      </label>
      <Show when={props.help}>
        <p class="help wiz-help">{props.help}</p>
      </Show>
      <Show when={props.error}>
        <p class="field-error wiz-help">{props.error}</p>
      </Show>
    </div>
  );
}

/** «Si una fila falla»: skip it and keep going, or roll the whole run back. */
export function RowErrorPolicy(props: { value: ErrorPolicy; onChange: (p: ErrorPolicy) => void; name: string }) {
  return (
    <div class="wiz-row" role="radiogroup" aria-label={t("imp.onRowError")}>
      <span class="wiz-label">{t("imp.onRowError")}</span>
      <span class="wiz-ctl wiz-radios">
        <label>
          <input type="radio" name={props.name} checked={props.value === "skip"} onChange={() => props.onChange("skip")} />
          {t("imp.skipRest")}
        </label>
        <label>
          <input type="radio" name={props.name} checked={props.value === "abort"} onChange={() => props.onChange("abort")} />
          {t("imp.abortAll")}
        </label>
      </span>
    </div>
  );
}

/**
 * The closing card of a wizard run: the figures of what was done, side by
 * side («4810 insertadas · 2 con error · 00:12»), the failures in red.
 */
export function WizardSummary(props: { stats: { value: string | number; label: string; error?: boolean }[] }) {
  return (
    <div class="wiz-summary" role="status">
      <For each={props.stats}>
        {(s) => (
          <div class={s.error ? "wiz-stat is-error" : "wiz-stat"}>
            <strong>{s.value}</strong>
            <span>{s.label}</span>
          </div>
        )}
      </For>
    </div>
  );
}
