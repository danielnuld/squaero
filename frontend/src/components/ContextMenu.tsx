import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { contextMenu, closeContextMenu, type MenuItem } from "../utils/contextMenu";

// Renders the app-global context menu at its stored position. A single instance
// lives in App; surfaces open it via openContextMenu(). It closes on item
// activation, Escape, a click anywhere, scroll, resize, or losing focus. The
// menu is clamped to the viewport so it never opens off-screen near an edge.
export function ContextMenu() {
  let el: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal<{ x: number; y: number } | null>(null);

  // Clamp the menu inside the viewport once it has a measured size.
  const measure = (node: HTMLDivElement) => {
    el = node;
    const state = contextMenu();
    if (!state) return;
    const rect = node.getBoundingClientRect();
    const margin = 4;
    const x = Math.min(state.x, window.innerWidth - rect.width - margin);
    const y = Math.min(state.y, window.innerHeight - rect.height - margin);
    setPos({ x: Math.max(margin, x), y: Math.max(margin, y) });
  };

  // Reset the provisional position to the raw click each time a menu opens; the
  // callback ref then clamps it against the measured size.
  createEffect(() => {
    const state = contextMenu();
    if (state) setPos({ x: state.x, y: state.y });
    else setPos(null);
  });

  // While a menu is open, global listeners close it on the usual triggers.
  createEffect(() => {
    if (!contextMenu()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeContextMenu();
    };
    // A left-click outside closes; a click on an item is handled first and
    // closes anyway. Use mousedown so it fires before the click lands.
    const onDown = (e: MouseEvent) => {
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      closeContextMenu();
    };
    const onScroll = () => closeContextMenu();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    window.addEventListener("blur", onScroll);
    onCleanup(() => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("blur", onScroll);
    });
  });

  const activate = (item: MenuItem) => {
    if (item.disabled || item.separator) return;
    closeContextMenu();
    item.action?.();
  };

  return (
    <Show when={contextMenu()}>
      {(state) => (
        <div
          class="context-menu"
          role="menu"
          ref={measure}
          style={{ left: `${(pos() ?? state()).x}px`, top: `${(pos() ?? state()).y}px` }}
        >
          <For each={state().items}>
            {(item) => (
              <Show
                when={!item.separator}
                fallback={<div class="context-menu-sep" role="separator" />}
              >
                <button
                  type="button"
                  role="menuitem"
                  class={`context-menu-item ${item.danger ? "danger" : ""}`}
                  disabled={item.disabled}
                  onClick={() => activate(item)}
                >
                  {item.label}
                </button>
              </Show>
            )}
          </For>
        </div>
      )}
    </Show>
  );
}
