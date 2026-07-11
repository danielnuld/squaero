import { Show, createSignal, createEffect, onCleanup, onMount, mergeProps } from "solid-js";
import { engineIcon, type Connection } from "../utils/connections";
import { ConnectionManager, type ConnectionManagerProps } from "./ConnectionManager";

// Explorer-first sidebar header: the active connection collapses to a single
// bar, so the object tree below gets the whole column. Clicking the bar drops
// down the full ConnectionManager (list + CRUD + import/export) as a popover, so
// switching and managing connections is one click away without occupying space.
// Presentational — it forwards every ConnectionManagerProps action and only owns
// the open/closed state of the popover.
export function ConnectionBar(props: ConnectionManagerProps & { openTick?: number }) {
  const [open, setOpen] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;

  // Reopen the popover when the app asks (bumped after saving a connection), so
  // a just-added connection is visible in the list — otherwise the form closes
  // over a collapsed bar and the save appears to have done nothing.
  let lastOpenTick = props.openTick ?? 0;
  createEffect(() => {
    const tick = props.openTick ?? 0;
    if (tick !== lastOpenTick) {
      lastOpenTick = tick;
      setOpen(true);
    }
  });

  const active = () => props.connections.find((c) => c.id === props.activeConnId) ?? null;
  const activeIsOpen = () => {
    const a = active();
    return !!a && (props.openIds?.includes(a.id) ?? false);
  };

  // Close the popover after an action that navigates away from it (connecting,
  // or opening the new/edit form), while forwarding the real handler.
  // mergeProps (NOT object spread) keeps `props` reactive: spreading `{...props}`
  // snapshots the connection list at mount time, so a connection added later
  // never reaches the ConnectionManager below (it only appeared after a restart).
  const closingProps: ConnectionManagerProps = mergeProps(props, {
    onConnect: (c: Connection) => {
      props.onConnect(c);
      setOpen(false);
    },
    onNew: () => {
      props.onNew();
      setOpen(false);
    },
    onEdit: (c: Connection) => {
      props.onEdit(c);
      setOpen(false);
    },
  });

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
      <div class="connbar-row">
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
        {/* Disconnect the focused connection right here, without opening the
            manager popover — the action was previously buried inside it. */}
        <Show when={activeIsOpen()}>
          <button
            class="connbar-disconnect"
            title="Desconectar"
            aria-label="Desconectar"
            disabled={props.connectingId !== null}
            onClick={(e) => {
              e.stopPropagation();
              props.onDisconnect(active()!.id);
            }}
          >
            ⏏
          </button>
        </Show>
      </div>
      <Show when={open()}>
        <div class="connbar-drop">
          <ConnectionManager {...closingProps} />
        </div>
      </Show>
    </div>
  );
}
