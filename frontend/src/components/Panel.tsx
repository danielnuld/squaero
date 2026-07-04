import { onCleanup, onMount, type JSX } from "solid-js";

// Inline workspace panel (UX refactor: tools open as tabs in the same window
// instead of modals). A Panel fills the workspace area below the tab bar; the tab
// itself carries the title and the close (✕), so a Panel is just a labelled,
// scrollable region. Escape still closes it via onClose. `title` becomes the
// accessible name; `wide` is accepted for call-site compatibility and ignored
// (panels are always full width). Replaces the old centered Modal + backdrop.
export function Panel(props: {
  title?: string;
  onClose?: () => void;
  /** Accepted for compatibility with former Modal call sites; panels fill the area. */
  wide?: boolean;
  /** Extra class (component-specific layout hook, e.g. "user-mgr"). */
  class?: string;
  children: JSX.Element;
}) {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose?.();
  };
  onMount(() => document.addEventListener("keydown", onKey));
  onCleanup(() => document.removeEventListener("keydown", onKey));

  return (
    <div class={`tool-pane ${props.class ?? ""}`} role="region" aria-label={props.title}>
      {props.children}
    </div>
  );
}
