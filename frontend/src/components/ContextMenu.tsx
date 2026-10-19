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
import { Icon } from "./icons";

// Renders the app-global context menu at its stored position. A single instance
// lives in App; surfaces open it via openContextMenu(). It closes on item
// activation, Escape, a click anywhere, scroll, resize, or losing focus. The
// menu is clamped to the viewport so it never opens off-screen near an edge.
//
// Keyboard (issue #687): the Menu key or Shift+F10 opens it on the focused
// element (installContextMenuKey); once open, focus moves to the first item and
// Up/Down/Home/End walk the rows; closing hands the focus back to where it was.
//
// Submenus (audit A-14): an item with `submenu` opens a second menu beside it —
// on hover, click, Enter/Space or ArrowRight, which also moves the focus into
// it; ArrowLeft or Escape closes it and puts the focus back on its parent row.
// One level deep: the grid's menu needs no more.
export function ContextMenu() {
  let el: HTMLDivElement | undefined;
  const [pos, setPos] = createSignal<{ x: number; y: number } | null>(null);
  // Index (in the top-level items) of the row whose submenu is open.
  const [sub, setSub] = createSignal<number | null>(null);
  let restoreTo: Element | null = null;

  onMount(() => onCleanup(installContextMenuKey(document)));

  // The rows of ONE menu level: the submenu's rows live inside the top menu's
  // element, so they are told apart by the nearest menu that owns them.
  const rows = (menu: Element | undefined = el) =>
    menu
      ? Array.from(menu.querySelectorAll<HTMLButtonElement>(".context-menu-item")).filter(
          (r) => r.closest('[role="menu"]') === menu,
        )
      : [];

  const firstEnabled = (list: HTMLButtonElement[]) =>
    stepIndex(list.length, -1, "ArrowDown", (i) => list[i].disabled);

  const focusRow = (i: number) => {
    const r = rows()[i];
    if (r) r.focus();
  };

  const subMenuEl = () => el?.querySelector<HTMLDivElement>(".context-submenu") ?? undefined;

  // Opens submenu `i`; with `focus`, its first enabled row takes the focus (the
  // keyboard path). Solid renders it synchronously, so it is there to measure.
  const openSub = (i: number, focus: boolean) => {
    setSub(i);
    const menu = subMenuEl();
    if (!menu) return;
    // Flip to the left when it would leave the window on the right.
    menu.classList.toggle("flip", menu.getBoundingClientRect().right > window.innerWidth);
    if (focus) {
      const list = rows(menu);
      list[firstEnabled(list)]?.focus();
    }
  };

  const closeSub = () => {
    const i = sub();
    if (i === null) return;
    setSub(null);
    el?.querySelector<HTMLButtonElement>(`[data-sub="${i}"]`)?.focus();
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
    setSub(null);
    restoreTo = document.activeElement;
    queueMicrotask(() => {
      // Untracked reads: a menu closed or replaced meanwhile owns the position.
      if (contextMenu() !== state || !el?.isConnected) return;
      focusRow(firstEnabled(rows()));
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
      const active = document.activeElement;
      const inSub = !!active && !!subMenuEl()?.contains(active);
      if ((e.key === "Escape" || e.key === "ArrowLeft") && inSub) {
        e.preventDefault();
        closeSub();
        return;
      }
      if (e.key === "Escape" || e.key === "Tab") {
        e.preventDefault();
        closeContextMenu();
        return;
      }
      if (e.key === "ArrowRight" && active instanceof HTMLElement && active.dataset.sub) {
        e.preventDefault();
        openSub(Number(active.dataset.sub), true);
        return;
      }
      const list = rows(inSub ? subMenuEl() : el);
      const next = stepIndex(
        list.length,
        list.findIndex((r) => r === document.activeElement),
        e.key,
        (i) => list[i].disabled,
      );
      if (next >= 0 && next !== list.findIndex((r) => r === document.activeElement)) {
        e.preventDefault();
        list[next].focus();
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
    if (item.disabled || item.separator || item.heading) return;
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
          <For each={state().items}>{(item, i) => <Row item={item} index={i()} />}</For>
        </div>
      )}
    </Show>
  );

  // One row. `index` is set on the top level only, which is what lets a row
  // open a submenu (and what keeps a submenu's own `submenu` inert).
  function Row(p: { item: MenuItem; index?: number }) {
    return (
      <Show
        when={!p.item.separator && !p.item.heading}
        fallback={
          p.item.heading ? (
            <div class="context-menu-heading" role="presentation">
              {p.item.label}
            </div>
          ) : (
            <div class="context-menu-sep" role="separator" />
          )
        }
      >
        <Show
          when={p.item.submenu && p.index !== undefined}
          fallback={
            <button
              type="button"
              role="menuitem"
              class={`context-menu-item ${p.item.danger ? "danger" : ""}`}
              disabled={p.item.disabled}
              title={p.item.title}
              onClick={() => activate(p.item)}
              onMouseEnter={() => {
                // Hovering another top-level row closes an open submenu.
                if (p.index !== undefined) setSub(null);
              }}
            >
              <RowBody item={p.item} />
            </button>
          }
        >
          <div class="context-menu-branch" role="none">
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={sub() === p.index}
              class="context-menu-item"
              classList={{ open: sub() === p.index }}
              data-sub={p.index}
              disabled={p.item.disabled}
              title={p.item.title}
              onClick={() => openSub(p.index!, true)}
              onMouseEnter={() => openSub(p.index!, false)}
            >
              <RowBody item={p.item} />
              <span class="context-menu-arrow" aria-hidden="true">
                <Icon name="chevron-right" size={12} />
              </span>
            </button>
            <Show when={sub() === p.index}>
              <div class="context-menu context-submenu" role="menu" aria-label={p.item.label}>
                <For each={p.item.submenu}>{(child) => <Row item={child} />}</For>
              </div>
            </Show>
          </div>
        </Show>
      </Show>
    );
  }
}

function RowBody(p: { item: MenuItem }) {
  return (
    <>
      <Show when={p.item.Icon}>
        {(Icon) => (
          <span class="context-menu-ic" aria-hidden="true">
            <Dynamic component={Icon()} />
          </span>
        )}
      </Show>
      {p.item.label}
      <Show when={p.item.hint}>
        <span class="context-menu-hint">{p.item.hint}</span>
      </Show>
    </>
  );
}
