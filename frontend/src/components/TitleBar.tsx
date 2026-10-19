import { For, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { t } from "../utils/i18n";
import { stepIndex } from "../utils/listNav";
import { QUIT_ACTION, type Menu, type MenuEntry, type MenuItem } from "../utils/nativeMenu";
import {
  accessKeys,
  hasWindowBinding,
  menuForKey,
  onWindowEvent,
  titleBarLayout,
  windowCommand,
  type Os,
  type WindowState,
} from "../utils/titleBar";
import { BrandMark } from "./Brand";
import { Icon } from "./icons";

// The app's own title bar (issue #688): brand, the app menu (Windows), the
// Ctrl+K search in the middle, the notification history's bell and — on
// Windows — minimize / maximize / close. `data-os` picks the variant:
//
// - Windows, own bar: everything above; the empty bar drags the window, a
//   double click maximizes, a right click opens the window menu. The shell
//   puts a helper over the maximize button for Snap layouts and tells us when
//   it is hovered (main.cc, "The app's own title bar").
// - macOS, own bar: room on the left for the traffic lights; the menu is the
//   system's global one.
// - Linux, a browser, or the user's "system title bar" fallback: the system
//   frame stays and this is an in-app bar below it, without window buttons.
//
// The menu is the native menu bar's model (nativeMenu.ts), so the two cannot
// drift: same items, same accelerators, same enabled states, same handler.

export function TitleBar(props: {
  os: Os;
  /** The app's own bar is wanted (the setting); the shell may still refuse. */
  custom: boolean;
  /** The menu-bar setting. */
  showMenu: boolean;
  menus: Menu[];
  onMenuAction: (id: string) => void;
  /** Let the shell's backdrop (Mica) show through the chrome: the Nativo style. */
  backdrop: boolean;
  paletteKeys: string;
  onPalette: () => void;
  unread: number;
  notesOpen: boolean;
  onNotifications: () => void;
}) {
  const [state, setState] = createSignal<WindowState | null>(null);
  const [maxHover, setMaxHover] = createSignal(false);
  const layout = () => titleBarLayout(props.os, state(), props.showMenu);

  // The shell takes the setting on every start and whenever it changes; its
  // answer (the frame it actually has) is what the bar draws for.
  createEffect(() => {
    const custom = props.custom;
    if (!hasWindowBinding()) return;
    void windowCommand("frameless", custom).then((s) => s && setState(s));
  });
  onMount(() => {
    if (typeof window === "undefined") return;
    onCleanup(onWindowEvent(window, setState, setMaxHover));
  });

  // Mica only for the style that wants it (the shell turns it on, where the
  // system has it), and only where the page lets it through (styles.css).
  createEffect(() => {
    const want = props.backdrop;
    if (!hasWindowBinding()) return;
    void windowCommand("backdrop", want).then((s) => s && setState(s));
  });
  createEffect(() => {
    const on = props.backdrop && state()?.backdrop === "mica" && !!state()?.frameless;
    const root = document.documentElement;
    if (on) root.setAttribute("data-backdrop", "mica");
    else root.removeAttribute("data-backdrop");
  });
  onCleanup(() => document.documentElement.removeAttribute("data-backdrop"));

  // Where the maximize button is, for the shell's Snap layouts helper; an
  // empty rect when there is none.
  let maxButton: HTMLButtonElement | undefined;
  const reportSnap = () => {
    if (!hasWindowBinding()) return;
    const r = layout().windowButtons && maxButton ? maxButton.getBoundingClientRect() : null;
    void windowCommand("snap", r?.left ?? 0, r?.top ?? 0, r?.width ?? 0, r?.height ?? 0);
  };
  createEffect(() => {
    layout();
    queueMicrotask(reportSnap);
  });
  onMount(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("resize", reportSnap);
    onCleanup(() => window.removeEventListener("resize", reportSnap));
  });

  const onBarMouseDown = (e: MouseEvent) => {
    if (!layout().draggable || e.button !== 0) return;
    if ((e.target as Element).closest?.("button, a, input, [role='menu']")) return;
    e.preventDefault();
    void windowCommand(e.detail >= 2 ? "double-click" : "drag");
  };
  const onBarContextMenu = (e: MouseEvent) => {
    if (!layout().windowButtons) return;
    if ((e.target as Element).closest?.("button, a, input, [role='menu']")) return;
    e.preventDefault();
    void windowCommand("system-menu");
  };

  const runMenu = (id: string) => {
    if (id === QUIT_ACTION) void windowCommand("close");
    else props.onMenuAction(id);
  };

  return (
    <header
      class="titlebar"
      data-os={props.os}
      classList={{ "tb-own": layout().draggable }}
      onMouseDown={onBarMouseDown}
      onContextMenu={onBarContextMenu}
    >
      <Show when={layout().trafficLights}>
        <span class="tb-lights" aria-hidden="true" />
      </Show>
      <span class="tb-brand">
        <BrandMark size={16} />
        <Show when={!layout().menu}>
          <span class="tb-name">Squaero</span>
        </Show>
      </span>
      <Show when={layout().menu}>
        <MenuBar menus={props.menus} onAction={runMenu} />
      </Show>
      <span class="tb-spacer" />
      <button
        class="tb-search"
        title={`${t("toolbar.launchTitle")} (${props.paletteKeys})`}
        onClick={() => props.onPalette()}
      >
        <Icon name="search" size={14} />
        <span class="tb-search-text">{t("titlebar.search")}</span>
        <kbd class="tb-kbd">{props.paletteKeys}</kbd>
      </button>
      <span class="tb-spacer" />
      <button
        class="tb-icon tb-bell"
        classList={{ on: props.notesOpen }}
        aria-expanded={props.notesOpen}
        aria-label={t("titlebar.notifications")}
        title={
          props.unread
            ? t("titlebar.notificationsUnread", { n: props.unread })
            : t("titlebar.notifications")
        }
        onClick={() => props.onNotifications()}
      >
        <Icon name="bell" size={16} />
        <Show when={props.unread > 0}>
          <span class="tb-badge" aria-hidden="true">
            {props.unread > 9 ? "9+" : props.unread}
          </span>
        </Show>
      </button>
      <Show when={layout().windowButtons}>
        <span class="tb-winbtns">
          <button
            class="tb-winbtn"
            tabIndex={-1}
            aria-label={t("titlebar.minimize")}
            title={t("titlebar.minimize")}
            onClick={() => void windowCommand("minimize")}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0 5.5h10" stroke="currentColor" />
            </svg>
          </button>
          <button
            ref={maxButton}
            class="tb-winbtn"
            classList={{ hover: maxHover() }}
            tabIndex={-1}
            aria-label={state()?.maximized ? t("titlebar.restore") : t("titlebar.maximize")}
            title={state()?.maximized ? t("titlebar.restore") : t("titlebar.maximize")}
            onClick={() => void windowCommand("maximize")}
          >
            <Show
              when={state()?.maximized}
              fallback={
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor" />
                </svg>
              }
            >
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2.5 2.5V.5h7v7h-2" fill="none" stroke="currentColor" />
                <rect x=".5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" />
              </svg>
            </Show>
          </button>
          <button
            class="tb-winbtn tb-close"
            tabIndex={-1}
            aria-label={t("titlebar.close")}
            title={t("titlebar.close")}
            onClick={() => void windowCommand("close")}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
              <path d="M0 0l10 10M10 0 0 10" stroke="currentColor" />
            </svg>
          </button>
        </span>
      </Show>
    </header>
  );
}

const isItem = (e: MenuEntry): e is MenuItem => !("separator" in e);

// The app menu in the bar: top-level buttons with access keys (Alt+letter
// opens one; Alt alone moves the focus to the bar), a dropdown per menu with
// arrow keys, Home/End, Enter and Escape, Left/Right to the next menu.
function MenuBar(props: { menus: Menu[]; onAction: (id: string) => void }) {
  const [open, setOpen] = createSignal(-1);
  const [active, setActive] = createSignal(-1);
  const tops: HTMLButtonElement[] = [];
  let bar: HTMLElement | undefined;
  // Where the focus was before the bar took it: an item gets it back before it
  // runs, so Copiar or Pegar act on the field the user was in (A-11).
  let before: HTMLElement | null = null;
  const remember = () => {
    const el = document.activeElement;
    if (el instanceof HTMLElement && !bar?.contains(el)) before = el;
  };
  const labels = () => props.menus.map((m) => m.label);
  const keys = () => accessKeys(labels());

  const items = (i: number) => props.menus[i]?.items ?? [];
  const disabledAt = (i: number) => (j: number) => {
    const e = items(i)[j];
    return !e || !isItem(e) || e.enabled === false;
  };
  const first = (i: number) => stepIndex(items(i).length, -1, "ArrowDown", disabledAt(i));

  const show = (i: number, focusItem: boolean) => {
    remember();
    setOpen(i);
    setActive(focusItem ? first(i) : -1);
    tops[i]?.focus();
  };
  const close = (refocus: boolean) => {
    const i = open();
    setOpen(-1);
    setActive(-1);
    if (refocus) tops[i]?.focus();
  };
  const run = (item: MenuItem) => {
    if (item.enabled === false) return;
    close(false);
    before?.focus();
    props.onAction(item.id);
  };
  const neighbour = (i: number, dir: 1 | -1) => (i + dir + props.menus.length) % props.menus.length;

  const onTopKey = (e: KeyboardEvent, i: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const n = neighbour(i, e.key === "ArrowRight" ? 1 : -1);
      if (open() >= 0) show(n, true);
      else tops[n]?.focus();
    } else if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      show(i, true);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(i);
      setActive(stepIndex(items(i).length, -1, "ArrowUp", disabledAt(i)));
    } else if (e.key === "Escape") {
      if (open() >= 0) close(true);
      else tops[i]?.blur();
    } else if (open() === i && (e.key === "Home" || e.key === "End" || e.key === "Tab")) {
      if (e.key === "Tab") close(false);
      else {
        e.preventDefault();
        setActive(stepIndex(items(i).length, active(), e.key, disabledAt(i)));
      }
    }
  };
  // While a menu is open the focus stays on its top button; the arrows move
  // the active item, published through aria-activedescendant.
  const onOpenKey = (e: KeyboardEvent, i: number) => {
    if (open() !== i) return onTopKey(e, i);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(stepIndex(items(i).length, active(), e.key, disabledAt(i)));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const it = items(i)[active()];
      if (it && isItem(it)) run(it);
    } else onTopKey(e, i);
  };

  onMount(() => {
    // Alt+letter opens that menu; Alt pressed and released alone moves the
    // focus to the bar, as on any Windows menu bar. Ctrl/Meta combinations
    // (AltGr is Ctrl+Alt) are other shortcuts and pass.
    let altAlone = false;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        altAlone = !e.ctrlKey && !e.metaKey && !e.shiftKey;
        return;
      }
      altAlone = false;
      if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.key.length !== 1) return;
      const i = menuForKey(labels(), keys(), e.key);
      if (i < 0) return;
      e.preventDefault();
      e.stopPropagation();
      show(i, true);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== "Alt" || !altAlone) return;
      altAlone = false;
      e.preventDefault();
      if (open() >= 0) close(true);
      else if (bar?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur();
      else {
        remember();
        tops[0]?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      if (open() >= 0 && !bar?.contains(e.target as Node)) close(false);
    };
    const onBlur = () => {
      altAlone = false;
      if (open() >= 0) close(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("blur", onBlur);
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("blur", onBlur);
    });
  });

  const itemId = (i: number, j: number) => `tb-menu-${i}-${j}`;

  return (
    <nav class="tb-menubar" aria-label={t("titlebar.menu")} ref={bar}>
      <For each={props.menus}>
        {(menu, i) => {
          const k = () => keys()[i()];
          return (
            <span class="tb-menu-wrap">
              <button
                ref={(el) => (tops[i()] = el)}
                class="tb-menu-top"
                classList={{ on: open() === i() }}
                aria-haspopup="menu"
                aria-expanded={open() === i()}
                aria-controls={open() === i() ? `tb-menu-${i()}` : undefined}
                aria-activedescendant={
                  open() === i() && active() >= 0 ? itemId(i(), active()) : undefined
                }
                aria-keyshortcuts={k() >= 0 ? `Alt+${menu.label[k()].toUpperCase()}` : undefined}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => (open() === i() ? close(true) : show(i(), false))}
                onMouseEnter={() => open() >= 0 && open() !== i() && show(i(), false)}
                onKeyDown={(e) => onOpenKey(e, i())}
              >
                <Show when={k() >= 0} fallback={menu.label}>
                  {menu.label.slice(0, k())}
                  <span class="tb-access">{menu.label[k()]}</span>
                  {menu.label.slice(k() + 1)}
                </Show>
              </button>
              <Show when={open() === i()}>
                <div
                  id={`tb-menu-${i()}`}
                  class="context-menu tb-menu"
                  role="menu"
                  aria-label={menu.label}
                >
                  <For each={menu.items}>
                    {(entry, j) =>
                      isItem(entry) ? (
                        <button
                          id={itemId(i(), j())}
                          class="context-menu-item"
                          classList={{ active: active() === j() }}
                          role="menuitem"
                          tabIndex={-1}
                          disabled={entry.enabled === false}
                          aria-disabled={entry.enabled === false}
                          onMouseEnter={() => entry.enabled !== false && setActive(j())}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => run(entry)}
                        >
                          <span class="context-menu-label">{entry.label}</span>
                          <Show when={entry.accel}>
                            <span class="context-menu-hint">{entry.accel}</span>
                          </Show>
                        </button>
                      ) : (
                        <div class="context-menu-sep" role="separator" />
                      )
                    }
                  </For>
                </div>
              </Show>
            </span>
          );
        }}
      </For>
    </nav>
  );
}
