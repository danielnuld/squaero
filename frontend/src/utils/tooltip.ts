// The app's own tooltips (issue #687).
//
// Components keep writing `title="…"`: it is the declarative source, it is what
// the tests assert on, and it stays the accessible description. What changes is
// who draws it. One delegated handler on the document moves `title` into
// `data-tip` the first time the pointer or the focus reaches an element — so the
// browser never gets to show its own box — and draws a single themed <div
// role="tooltip"> after a desktop-like delay, placed inside the viewport, on
// hover AND on keyboard focus, dismissed by Escape, scroll or a mousedown.
//
// A MutationObserver keeps `data-tip` honest when Solid later changes or removes
// a `title` (a disabled button's reason going away, say): a title that is set
// again is re-moved, a title that disappears takes its tip with it. Our own
// removals are discarded from the observer's queue (takeRecords) as they happen,
// so every record it does deliver is somebody else's doing.

import { placeBelow } from "./popover";

export const TOOLTIP_DELAY_MS = 500;
export const TOOLTIP_ID = "app-tooltip";

const SELECTOR = "[title],[data-tip]";

export interface TooltipHandle {
  /** Removes the listeners and the tooltip element. */
  dispose(): void;
}

/**
 * Moves an element's `title` into `data-tip`, so the native tooltip cannot
 * appear while ours still has the text. Returns the tip text, or "" if none.
 */
export function adoptTitle(el: Element): string {
  const title = el.getAttribute("title");
  if (title !== null) {
    el.removeAttribute("title");
    if (title) el.setAttribute("data-tip", title);
    else el.removeAttribute("data-tip");
  }
  return el.getAttribute("data-tip") ?? "";
}

/** Installs the delegated tooltip on `doc`. Call once, from the entry point. */
export function installTooltips(doc: Document = document): TooltipHandle {
  const win = doc.defaultView ?? window;
  const tip = doc.createElement("div");
  tip.id = TOOLTIP_ID;
  tip.className = "tooltip";
  tip.setAttribute("role", "tooltip");
  tip.hidden = true;
  doc.body.appendChild(tip);

  let anchor: Element | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hide = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (!tip.hidden) {
      tip.hidden = true;
      anchor?.removeAttribute("aria-describedby");
    }
    anchor = null;
  };

  const show = (el: Element) => {
    const text = el.getAttribute("data-tip");
    if (!text || !el.isConnected) return hide();
    anchor = el;
    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = "0px";
    tip.style.top = "0px";
    const a = el.getBoundingClientRect();
    const s = tip.getBoundingClientRect();
    const p = placeBelow({
      anchor: a,
      size: s,
      viewport: { width: win.innerWidth, height: win.innerHeight },
      gap: 6,
      align: "center",
    });
    tip.style.left = `${p.x}px`;
    tip.style.top = `${p.y}px`;
    tip.classList.toggle("above", p.above);
    // Only when the element has no description of its own: a described control
    // keeps what its author wrote.
    if (!el.hasAttribute("aria-describedby")) el.setAttribute("aria-describedby", TOOLTIP_ID);
  };

  const schedule = (el: Element) => {
    if (el === anchor && !tip.hidden) return;
    const text = adopt(el);
    if (!text) return hide();
    // A tooltip already on screen hands over without the wait, as desktop
    // toolbars do when the pointer slides from one button to the next.
    const warm = !tip.hidden;
    hide();
    anchor = el;
    if (warm) show(el);
    else timer = setTimeout(() => show(el), TOOLTIP_DELAY_MS);
  };

  const owner = (t: EventTarget | null): Element | null =>
    t instanceof Element ? t.closest(SELECTOR) : null;

  const onOver = (e: MouseEvent) => {
    const el = owner(e.target);
    if (el) schedule(el);
    else if (anchor && !(e.target instanceof Node && anchor.contains(e.target))) hide();
  };
  const onOut = (e: MouseEvent) => {
    if (!anchor) return;
    const to = e.relatedTarget;
    if (!(to instanceof Node) || !anchor.contains(to)) hide();
  };
  const onFocusIn = (e: FocusEvent) => {
    const el = owner(e.target);
    if (el) schedule(el);
  };
  const onFocusOut = () => hide();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") hide();
  };
  const onMutate = (records: MutationRecord[]) => {
    for (const el of new Set(records.map((r) => r.target as Element))) {
      if (el.hasAttribute("title")) {
        // Solid rendered a new or changed title: it becomes the tip at once, so
        // a tooltip already open for this element says the new thing.
        adopt(el);
        if (el === anchor && !tip.hidden) show(el);
      } else {
        // Solid took the title away (the reason a button was disabled, say).
        el.removeAttribute("data-tip");
        if (el === anchor) hide();
      }
    }
  };
  const observer = new win.MutationObserver(onMutate);
  // Settle what others changed first, then strip, then forget our own record.
  const adopt = (el: Element): string => {
    onMutate(observer.takeRecords());
    const text = adoptTitle(el);
    observer.takeRecords();
    return text;
  };

  doc.addEventListener("mouseover", onOver);
  doc.addEventListener("mouseout", onOut);
  doc.addEventListener("focusin", onFocusIn);
  doc.addEventListener("focusout", onFocusOut);
  doc.addEventListener("mousedown", hide, true);
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("scroll", hide, true);
  win.addEventListener("blur", hide);
  observer.observe(doc.documentElement, { attributes: true, attributeFilter: ["title"], subtree: true });

  return {
    dispose() {
      hide();
      observer.disconnect();
      doc.removeEventListener("mouseover", onOver);
      doc.removeEventListener("mouseout", onOut);
      doc.removeEventListener("focusin", onFocusIn);
      doc.removeEventListener("focusout", onFocusOut);
      doc.removeEventListener("mousedown", hide, true);
      doc.removeEventListener("keydown", onKey, true);
      doc.removeEventListener("scroll", hide, true);
      win.removeEventListener("blur", hide);
      tip.remove();
    },
  };
}
