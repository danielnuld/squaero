import { Show, createSignal, onCleanup, onMount } from "solid-js";
import { engineIcon } from "../utils/connections";
import { ConnectionManager, type ConnectionManagerProps } from "./ConnectionManager";

// Explorer-first sidebar header: the active connection collapses to a single
// bar, so the object tree below gets the whole column. Clicking the bar drops
// down the full ConnectionManager (list + CRUD + import/export) as a popover, so
// switching and managing connections is one click away without occupying space.
// Presentational — it forwards every ConnectionManagerProps action and only owns
// the open/closed state of the popover.
export function ConnectionBar(props: ConnectionManagerProps) {
  const [open, setOpen] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;

  const active = () => props.connections.find((c) => c.id === props.activeConnId) ?? null;

  // Close the popover after an action that navigates away from it (connecting,
  // or opening the new/edit form), while forwarding the real handler.
  const closingProps: ConnectionManagerProps = {
    ...props,
    onConnect: (c) => {
      props.onConnect(c);
      setOpen(false);
    },
    onNew: () => {
      props.onNew();
      setOpen(false);
    },
    onEdit: (c) => {
      props.onEdit(c);
      setOpen(false);
    },
  };

  // Dismiss on a click outside the bar + popover.
  onMount(() => {
    const onDown = (e: MouseEvent) => {
      if (open() && rootEl && !rootEl.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    onCleanup(() => document.removeEventListener("mousedown", onDown));
  });

  return (
    <div class="connbar" ref={rootEl}>
      <button
        class="connbar-active"
        aria-expanded={open()}
        title="Conexiones"
        style={
          active()?.color ? { "border-left": `4px solid ${active()!.color}` } : undefined
        }
        onClick={() => setOpen((v) => !v)}
      >
        <Show
          when={active()}
          fallback={<span class="connbar-none">Elegir conexión</span>}
        >
          <Show when={active()!.color}>
            <span class="conn-color" style={{ background: active()!.color }} />
          </Show>
          <span class="engine-icon">{engineIcon(active()!.driver)}</span>
          <span class="connbar-name">{active()!.name}</span>
          <span class="connbar-status">conectado</span>
        </Show>
        <span class="connbar-caret" aria-hidden="true">
          {open() ? "▴" : "▾"}
        </span>
      </button>
      <Show when={open()}>
        <div class="connbar-drop">
          <ConnectionManager {...closingProps} />
        </div>
      </Show>
    </div>
  );
}
