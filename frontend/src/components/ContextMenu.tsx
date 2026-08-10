import { For, Show, createEffect, createSignal, onCleanup } from "solid-js";
import { Dynamic } from "solid-js/web";
import {
  contextMenu,
  closeContextMenu,
  clampToViewport,
  type MenuItem,
} from "../utils/contextMenu";

// Renders the app-global context menu at its stored position. A single instance
// lives in App; surfaces open it via openContextMenu(). It closes on item
// activation, Escape, a click anywhere, scroll, resize, or losing focus. The
// menu is clamped to the viewport so it never opens off-screen near an edge.
export function ContextMenu() {
  let el: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal<{ x: number; y: number } | null>(null);

  const measure = (node: HTMLDivElement) => {
    el = node;
  };

  // Open at the raw click, then clamp against the MEASURED box. The measuring
  // waits a microtask because the element is still detached when the ref runs
  // (Solid applies refs before insertion) and a detached element measures 0x0 —
  // which silently turned the clamp into a no-op, so every menu opened at the
  // click position and menus near an edge (the export button of a wide result)
  // hung off-screen. A microtask runs after insertion and before paint, so the
  // final position is the first one painted. Issue #318.
  createEffect(() => {
    const state = contextMenu();
    if (!state) {
      setPos(null);
      return;
    }
    setPos({ x: state.x, y: state.y });
    queueMicrotask(() => {
      // Untracked reads: a menu closed or replaced meanwhile owns the position.
      if (contextMenu() !== state || !el?.isConnected) return;
      const rect = el.getBoundingClientRect();
      setPos(
        clampToViewport({
          x: state.x,
          y: state.y,
          width: rect.width,
          height: rect.height,
          viewportW: window.innerWidth,
          viewportH: window.innerHeight,
        }),
      );
    });
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
                  <Show when={item.Icon}>
                    {(Icon) => (
                      <span class="context-menu-ic" aria-hidden="true">
                        <Dynamic component={Icon()} />
                      </span>
                    )}
                  </Show>
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
