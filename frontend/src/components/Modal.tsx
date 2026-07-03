import { onCleanup, onMount, type JSX } from "solid-js";

// Shared modal shell (issue #111): consistent dialog semantics and behaviour for
// every overlay — a labelled `role="dialog"` with `aria-modal`, close on Escape,
// and close on backdrop click (while clicks inside are contained). Components
// pass their heading via `title` (also the accessible name) and their body as
// children.
export function Modal(props: {
  title: string;
  onClose: () => void;
  /** Wider layout for structure/preview dialogs. */
  wide?: boolean;
  /** Extra class on the dialog box (e.g. a width modifier). */
  class?: string;
  children: JSX.Element;
}) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose();
  };
  onMount(() => document.addEventListener("keydown", onKey));
  onCleanup(() => document.removeEventListener("keydown", onKey));

  return (
    <div class="modal-backdrop" onClick={props.onClose}>
      <div
        class={`modal ${props.wide ? "modal-wide" : ""} ${props.class ?? ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
        onClick={(e) => e.stopPropagation()}
      >
        {props.children}
      </div>
    </div>
  );
}
