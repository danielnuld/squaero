import { Show, createUniqueId, onCleanup, onMount, type JSX } from "solid-js";
import { Icon } from "./icons";
import { t } from "../utils/i18n";
import { currentOs, enterPressesPrimary, orderActions, trapTarget } from "../utils/dialog";

// The one dialog of the app (issue #692): title, content and an action row in
// the operating system's order. Every modal goes through it, so they all behave
// the same way:
//
// - Esc and the backdrop cancel; Enter presses the primary button — never in a
//   textarea, never on a focused button, never in a destructive dialog (R-08).
// - Tab stays inside, focus starts on the first field (on Cancel when the
//   action destroys something) and goes back where it was on close.
// - Labelled by its title; three widths (sm 400, md 520, lg 720).
//
// The key handler listens on the document in the CAPTURE phase, so it runs
// before a Panel's own Escape (which would close the whole tool tab) and before
// the editor's keymap. Only the topmost dialog answers when two are stacked.

/** The dialogs open right now, innermost last. */
const stack: symbol[] = [];

export interface DialogPrimary {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Destroys something: red, never pressed by Enter, focus starts on Cancel. */
  danger?: boolean;
}

export function Dialog(props: {
  title: string;
  size?: "sm" | "md" | "lg";
  /** Esc, the backdrop, the × and the Cancel button. */
  onCancel: () => void;
  primary?: DialogPrimary;
  /** The cancel button's text (default «Cancelar»). */
  cancelLabel?: string;
  /** Secondary actions, at the start of the footer. */
  helpers?: JSX.Element;
  /** An operation is in flight: every button is disabled and Esc waits. */
  busy?: boolean;
  /** An error from the last attempt, shown above the footer. */
  error?: string | null;
  class?: string;
  /** The dialog box itself, for a caller that sizes it (RelatedData). */
  ref?: (el: HTMLDivElement) => void;
  children?: JSX.Element;
}) {
  const id = Symbol("dialog");
  const titleId = createUniqueId();
  let box: HTMLDivElement | undefined;
  let cancelBtn: HTMLButtonElement | undefined;
  let primaryBtn: HTMLButtonElement | undefined;
  let restoreFocus: HTMLElement | null = null;
  // A click closes on the backdrop only when it also STARTED there: dragging a
  // resize corner or selecting text past the edge ends outside the box (#494).
  let pressedScrim = false;

  const focusables = () =>
    [
      ...(box?.querySelectorAll<HTMLElement>(
        "input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href], [tabindex]",
      ) ?? []),
    ].filter((el) => el.getAttribute("tabindex") !== "-1");

  const pressPrimary = () => {
    const p = props.primary;
    if (p && !p.disabled && !props.busy) p.onClick();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (stack[stack.length - 1] !== id) return;
    // An open dropdown inside the dialog owns Escape and Enter.
    if ((e.target as Element | null)?.getAttribute?.("aria-expanded") === "true") return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!props.busy) props.onCancel();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      const target = e.target as HTMLInputElement | null;
      const inside = target instanceof Element && box?.contains(target) ? target : null;
      if (props.primary && enterPressesPrimary(inside, !!props.primary.danger)) {
        e.preventDefault();
        e.stopPropagation();
        pressPrimary();
      }
      return;
    }
    if (e.key === "Tab") {
      const list = focusables();
      const active = document.activeElement as HTMLElement | null;
      const next = trapTarget(list, active && list.includes(active) ? active : null, e.shiftKey);
      if (next) {
        e.preventDefault();
        next.focus();
      }
    }
  };

  onMount(() => {
    restoreFocus = document.activeElement as HTMLElement | null;
    stack.push(id);
    document.addEventListener("keydown", onKeyDown, true);
    const auto = box?.querySelector<HTMLElement>("[data-autofocus]");
    const field = box?.querySelector<HTMLElement>(
      ".dlg-b input:not([disabled]):not([type=hidden]), .dlg-b select:not([disabled]), .dlg-b textarea:not([disabled])",
    );
    const start = auto ?? (props.primary?.danger ? cancelBtn : (field ?? primaryBtn ?? cancelBtn));
    start?.focus();
  });
  onCleanup(() => {
    document.removeEventListener("keydown", onKeyDown, true);
    const i = stack.indexOf(id);
    if (i !== -1) stack.splice(i, 1);
    restoreFocus?.focus?.();
  });

  const primaryButton = () => (
    <Show when={props.primary}>
      {(p) => (
        <button
          ref={primaryBtn}
          type="button"
          class={p().danger ? "btn btn-danger" : "btn btn-primary"}
          disabled={props.busy || p().disabled}
          onClick={pressPrimary}
        >
          {props.busy ? t("confirm.applying") : p().label}
        </button>
      )}
    </Show>
  );
  const cancelButton = () => (
    <button
      ref={cancelBtn}
      type="button"
      class="btn"
      disabled={props.busy}
      onClick={() => props.onCancel()}
    >
      {props.cancelLabel ?? t("common.cancel")}
    </button>
  );

  return (
    <div
      class="dlg-scrim"
      onMouseDown={(e) => {
        pressedScrim = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (pressedScrim && e.target === e.currentTarget && !props.busy) props.onCancel();
        pressedScrim = false;
      }}
    >
      <div
        ref={(el) => {
          box = el;
          props.ref?.(el);
        }}
        class={`dlg dlg-${props.size ?? "md"}${props.class ? ` ${props.class}` : ""}`}
        role={props.primary?.danger ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div class="dlg-h">
          <h2 id={titleId}>{props.title}</h2>
          <button
            type="button"
            class="dlg-close"
            tabindex="-1"
            aria-label={t("panel.close")}
            title={t("panel.close")}
            disabled={props.busy}
            onClick={() => props.onCancel()}
          >
            <Icon name="close" size={14} />
          </button>
        </div>
        <div class="dlg-b">
          {props.children}
          <Show when={props.error}>
            <p class="field-error" role="alert">
              {props.error}
            </p>
          </Show>
        </div>
        <div class="dlg-f">
          {props.helpers}
          <span class="dlg-spacer" />
          <span class="dlg-actions">{orderActions(currentOs(), [primaryButton(), cancelButton()])}</span>
        </div>
      </div>
    </div>
  );
}
