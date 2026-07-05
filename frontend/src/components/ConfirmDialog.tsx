import { Show, onCleanup, onMount } from "solid-js";

// Reusable destructive-confirmation dialog (issue #177): a single themed overlay
// replacing native confirm(), which ignores the theme and renders multi-line SQL
// badly. Shows the exact SQL that will run (transparency, as the user panel
// requires). Focus starts on Cancel and is trapped; Escape/backdrop cancel; Enter
// does NOT confirm (Cancel holds focus). While `busy`, both buttons are disabled
// and the dialog stays open so a failed action can show its error and be retried.
//
// The key handler is a CAPTURE-phase document listener (not a bubbling one): it
// fires before the underlying Panel's own document Escape handler regardless of
// where focus currently is, and stopPropagation keeps Escape from closing the
// whole tool tab. Focus is restored to the invoking control on close.
export function ConfirmDialog(props: {
  title?: string;
  message: string;
  /** The exact SQL that will run, shown verbatim. */
  sql?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** While true, buttons are disabled and the dialog stays open (in-flight op). */
  busy?: boolean;
  /** An error from the attempted action, shown in the dialog so it can be retried. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  let cancelBtn: HTMLButtonElement | undefined;
  let dialogEl: HTMLDivElement | undefined;
  let restoreFocus: HTMLElement | null = null;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (!props.busy) props.onCancel();
      return;
    }
    if (e.key === "Tab") {
      const focusables = dialogEl?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
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
    // Enter is intentionally not bound to confirm.
  };

  onMount(() => {
    restoreFocus = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", onKeyDown, true);
    cancelBtn?.focus();
  });
  onCleanup(() => {
    document.removeEventListener("keydown", onKeyDown, true);
    restoreFocus?.focus?.();
  });

  return (
    <div
      class="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !props.busy) props.onCancel();
      }}
    >
      <div
        class="modal confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        ref={dialogEl}
      >
        <h2 id="confirm-dialog-title">{props.title ?? "Confirmar"}</h2>
        <p class="confirm-message">{props.message}</p>
        <Show when={props.sql}>
          <pre class="ddl-text">{props.sql}</pre>
        </Show>
        <Show when={props.error}>
          <p class="test-error">{props.error}</p>
        </Show>
        <div class="modal-actions">
          <button ref={cancelBtn} disabled={props.busy} onClick={props.onCancel}>
            {props.cancelLabel ?? "Cancelar"}
          </button>
          <button class="danger" disabled={props.busy} onClick={props.onConfirm}>
            {props.busy ? "Aplicando…" : props.confirmLabel ?? "Eliminar"}
          </button>
        </div>
      </div>
    </div>
  );
}
