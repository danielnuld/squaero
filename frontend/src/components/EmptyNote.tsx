import { Show } from "solid-js";

// The one empty-state pattern (issue #694, REDESIGN: «short title + one
// sentence + one primary action, no illustrations»), for every list and view
// that can come up empty.
export function EmptyNote(props: {
  title: string;
  text?: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div class="empty-note" role="status">
      <span class="empty-note-title">{props.title}</span>
      <Show when={props.text}>
        <span>{props.text}</span>
      </Show>
      <Show when={props.action}>
        {(a) => (
          <button class="btn" onClick={() => a().onClick()}>
            {a().label}
          </button>
        )}
      </Show>
    </div>
  );
}
