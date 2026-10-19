import { For, Show, createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { openContextMenu } from "../utils/contextMenu";
import { hiddenTabs, type TabIconName } from "../utils/tabStrip";
import type { SafeMode } from "../utils/safeMode";
import { t } from "../utils/i18n";
import { Icon } from "./icons";

/** One document tab, as the strip draws it. The workspace computes these. */
export interface DocTabView {
  id: number;
  title: string;
  icon: TabIconName;
  /** The bound connection's colour: the stripe on top of the tab. */
  color?: string;
  /** The connection's name, shown after the title when several are open. */
  conn?: string;
  /** The connection is protected (#666): a lock before the title. */
  safe?: SafeMode;
  /** A query is running in it: a spinner takes the icon's place. */
  running?: boolean;
  /** Edits not saved back: a dot in the close button's place until hovered. */
  dirty?: boolean;
  /** A tool rather than a document of SQL or rows. */
  tool?: boolean;
}

// Desktop document tabs (issue #688): type icon, connection stripe and suffix,
// protection lock, running spinner, modified dot, 24 px close and an overflow
// menu for the tabs the strip cannot show. Purely presentational: the
// workspace owns the tab list and passes plain callbacks.
export function DocTabs(props: {
  tabs: DocTabView[];
  activeId: number;
  onSelect: (id: number) => void;
  onClose: (id: number, e: MouseEvent) => void;
  onKeyDown: (e: KeyboardEvent, id: number) => void;
  onContextMenu: (e: MouseEvent, id: number) => void;
  onNew: () => void;
  /**
   * The palette's search button and its keys ("Ctrl+K"). Optional: with the
   * app's title bar (issue #688) the search lives there, centred.
   */
  paletteKeys?: string;
  onPalette?: () => void;
}) {
  let strip: HTMLDivElement | undefined;
  const [hidden, setHidden] = createSignal<number[]>([]);

  const measure = () => {
    if (!strip) return;
    const view = strip.getBoundingClientRect();
    const spans = Array.from(strip.querySelectorAll<HTMLElement>(".tab")).map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    });
    setHidden(hiddenTabs(spans, { left: view.left, right: view.right }));
  };

  onMount(() => {
    if (typeof ResizeObserver === "undefined" || !strip) return;
    const ro = new ResizeObserver(measure);
    ro.observe(strip);
    onCleanup(() => ro.disconnect());
  });

  // The active tab is always brought into view, then the overflow re-measured.
  createEffect(
    on(
      () => [props.activeId, props.tabs.length] as const,
      () =>
        queueMicrotask(() => {
          strip
            ?.querySelector<HTMLElement>(".tab.active")
            ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
          measure();
        }),
    ),
  );

  const openOverflow = (e: MouseEvent) =>
    openContextMenu(
      e,
      hidden()
        .map((i) => props.tabs[i])
        .filter((tab) => !!tab)
        .map((tab) => ({
          label: tab.title,
          hint: tab.conn,
          action: () => props.onSelect(tab.id),
        })),
    );

  return (
    <div class="tabbar">
      <div
        class="tablist"
        role="tablist"
        aria-label={t("tab.listLabel")}
        ref={strip}
        onScroll={measure}
        /* A vertical wheel scrolls the strip sideways, as desktop tab strips do. */
        onWheel={(e) => {
          if (strip && e.deltaY !== 0 && e.deltaX === 0) {
            strip.scrollLeft += e.deltaY;
          }
        }}
      >
        <For each={props.tabs}>
          {(tab) => {
            const active = () => tab.id === props.activeId;
            return (
              <div
                class="tab"
                classList={{ active: active(), "is-dirty": !!tab.dirty, "tab-tool": !!tab.tool }}
                role="tab"
                aria-selected={active()}
                aria-label={tab.dirty ? t("tab.unsaved", { title: tab.title }) : tab.title}
                title={tab.conn ? `${tab.title} · ${tab.conn}` : tab.title}
                tabindex={active() ? 0 : -1}
                style={tab.color ? { "--conn-accent": tab.color } : undefined}
                onClick={() => props.onSelect(tab.id)}
                /* Middle click closes it (issue #459); the mousedown is cancelled
                   or Chromium answers it with its autoscroll cursor. */
                onMouseDown={(e) => e.button === 1 && e.preventDefault()}
                onAuxClick={(e) => e.button === 1 && props.onClose(tab.id, e)}
                onKeyDown={(e) => props.onKeyDown(e, tab.id)}
                onContextMenu={(e) => props.onContextMenu(e, tab.id)}
              >
                <span class="tab-stripe" aria-hidden="true" />
                <Show
                  when={tab.running}
                  fallback={
                    <span class={`tab-icon tab-icon-${tab.icon}`} aria-hidden="true">
                      <Icon name={tab.icon} size={14} />
                    </span>
                  }
                >
                  <span class="tab-spinner" role="img" aria-label={t("tab.running")} />
                </Show>
                <Show when={tab.safe}>
                  <span
                    class="tab-lock"
                    title={t(tab.safe === "readOnly" ? "safe.badgeReadOnly" : "safe.badgeConfirm")}
                  >
                    <Icon name={tab.safe === "readOnly" ? "lock" : "warning"} size={12} />
                  </span>
                </Show>
                <span class="tab-title">{tab.title}</span>
                <Show when={tab.conn}>
                  <span class="tab-conn">· {tab.conn}</span>
                </Show>
                <button
                  class="tab-close"
                  tabindex={-1}
                  title={t("tab.closeTitle")}
                  aria-label={t("tab.closeTitle")}
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onClose(tab.id, e);
                  }}
                >
                  <Show when={tab.dirty}>
                    <span class="tab-dot" aria-hidden="true" />
                  </Show>
                  <Icon name="close" size={12} class="tab-x" />
                </button>
              </div>
            );
          }}
        </For>
      </div>
      <button
        class="tab-new"
        title={t("toolbar.newQuery.title")}
        aria-label={t("toolbar.newQuery.title")}
        onClick={() => props.onNew()}
      >
        <Icon name="plus" size={14} />
      </button>
      <span class="tabbar-spacer" />
      <Show when={hidden().length > 0}>
        <button
          class="tab-overflow"
          aria-haspopup="menu"
          title={t("tab.overflow")}
          aria-label={t("tab.overflowN", { n: hidden().length })}
          onClick={openOverflow}
        >
          +{hidden().length}
          <Icon name="chevron-down" size={12} />
        </button>
      </Show>
      <Show when={props.onPalette}>
        <button
          class="tab-launch"
          title={`${t("toolbar.launchTitle")} (${props.paletteKeys})`}
          aria-label={t("toolbar.launchTitle")}
          onClick={() => props.onPalette?.()}
        >
          <Icon name="search" size={14} />
          <kbd class="tab-kbd">{props.paletteKeys}</kbd>
        </button>
      </Show>
    </div>
  );
}
