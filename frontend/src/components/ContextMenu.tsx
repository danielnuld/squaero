import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Dynamic } from "solid-js/web";
import {
  contextMenu,
  closeContextMenu,
  clampToViewport,
  installContextMenuKey,
  type MenuItem,
} from "../utils/contextMenu";
import { stepIndex } from "../utils/listNav";

// Renders the app-global context menu at its stored position. A single instance
// lives in App; surfaces open it via openContextMenu(). It closes on item
// activation, Escape, a click anywhere, scroll, resize, or losing focus. The
// menu is clamped to the viewport so it never opens off-screen near an edge.
//
// Keyboard (issue #687): the Menu key or Shift+F10 opens it on the focused
// element (installContextMenuKey); once open, focus moves to the first item and
// Up/Down/Home/End walk the rows; closing hands the focus back to where it was.
export function ContextMenu() {
  let el: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal<{ x: number; y: number } | null>(null);
  let restoreTo: Element | null = null;

  onMount(() => onCleanup(installContextMenuKey(document)));

  const rows = () =>
    el ? Array.from(el.querySelectorAll<HTMLButtonElement>(".context-menu-item")) : [];

  const focusRow = (i: number) => {
    const r = rows()[i];
    if (r) r.focus();
  };

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
    restoreTo = document.activeElement;
    queueMicrotask(() => {
      // Untracked reads: a menu closed or replaced meanwhile owns the position.
      if (contextMenu() !== state || !el?.isConnected) return;
      focusRow(stepIndex(rows().length, -1, "ArrowDown", (i) => rows()[i].disabled));
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
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        closeContextMenu();
        return;
      }
      const list = rows();
      const next = stepIndex(
        list.length,
        list.findIndex((r) => r === document.activeElement),
        e.key,
        (i) => list[i].disabled,
      );
      if (next >= 0 && next !== list.findIndex((r) => r === document.activeElement)) {
        e.preventDefault();
        focusRow(next);
      }
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
      // Focus goes back to what opened the menu, unless it has moved on already
      // (an action that opened a dialog, say) — the element must still be the
      // one holding nothing, i.e. focus is on the body or inside the menu.
      const active = document.activeElement;
      if (
        restoreTo instanceof HTMLElement &&
        restoreTo.isConnected &&
        (active === document.body || active === null || el?.contains(active))
      ) {
        restoreTo.focus();
      }
      restoreTo = null;
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
                  title={item.title}
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
                  <Show when={item.hint}>
                    <span class="context-menu-hint">{item.hint}</span>
                  </Show>
                </button>
              </Show>
            )}
          </For>
        </div>
      )}
    </Show>
  );
}
