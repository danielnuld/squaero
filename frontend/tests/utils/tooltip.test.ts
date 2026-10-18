import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  adoptTitle,
  installTooltips,
  TOOLTIP_DELAY_MS,
  TOOLTIP_ID,
  type TooltipHandle,
} from "../../src/utils/tooltip";

let handle: TooltipHandle | null = null;
let btn: HTMLButtonElement;

const tip = () => document.getElementById(TOOLTIP_ID) as HTMLDivElement;
const fire = (el: Element, type: string, init: Record<string, unknown> = {}) =>
  el.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }));
const hover = () => fire(btn, "mouseover");
/** MutationObserver callbacks run as microtasks. */
const observed = () => new Promise<void>((r) => queueMicrotask(r));

beforeEach(() => {
  vi.useFakeTimers();
  handle = installTooltips(document);
  btn = document.createElement("button");
  btn.title = "Guardar (Ctrl+S)";
  document.body.appendChild(btn);
});

afterEach(() => {
  handle?.dispose();
  handle = null;
  btn.remove();
  vi.useRealTimers();
});

describe("adoptTitle", () => {
  it("moves title into data-tip and reports the text", () => {
    const el = document.createElement("span");
    el.title = "hi";
    expect(adoptTitle(el)).toBe("hi");
    expect(el.hasAttribute("title")).toBe(false);
    expect(el.dataset.tip).toBe("hi");
  });

  it("drops an empty title and leaves an element without one alone", () => {
    const el = document.createElement("span");
    el.title = "";
    expect(adoptTitle(el)).toBe("");
    expect(el.hasAttribute("data-tip")).toBe(false);
    const bare = document.createElement("span");
    expect(adoptTitle(bare)).toBe("");
  });
});

describe("installTooltips", () => {
  it("creates one hidden tooltip element with the tooltip role", () => {
    expect(tip().hidden).toBe(true);
    expect(tip().getAttribute("role")).toBe("tooltip");
  });

  it("silences the native tooltip on hover and shows its own after the delay", () => {
    hover();
    expect(btn.hasAttribute("title")).toBe(false);
    expect(btn.dataset.tip).toBe("Guardar (Ctrl+S)");
    expect(tip().hidden).toBe(true);
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS - 1);
    expect(tip().hidden).toBe(true);
    vi.advanceTimersByTime(1);
    expect(tip().hidden).toBe(false);
    expect(tip().textContent).toBe("Guardar (Ctrl+S)");
    expect(btn.getAttribute("aria-describedby")).toBe(TOOLTIP_ID);
  });

  it("finds the titled ancestor of the hovered node", () => {
    const inner = document.createElement("span");
    btn.appendChild(inner);
    fire(inner, "mouseover");
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(tip().textContent).toBe("Guardar (Ctrl+S)");
  });

  it("hides when the pointer leaves, and never shows if it left early", () => {
    hover();
    vi.advanceTimersByTime(100);
    fire(btn, "mouseout", { relatedTarget: document.body });
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(tip().hidden).toBe(true);

    hover();
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(tip().hidden).toBe(false);
    fire(btn, "mouseout", { relatedTarget: document.body });
    expect(tip().hidden).toBe(true);
    expect(btn.hasAttribute("aria-describedby")).toBe(false);
  });

  it("hands over without the delay while a tooltip is already showing", () => {
    const other = document.createElement("button");
    other.title = "Otro";
    document.body.appendChild(other);
    hover();
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    fire(other, "mouseover");
    expect(tip().hidden).toBe(false);
    expect(tip().textContent).toBe("Otro");
    other.remove();
  });

  it("shows on keyboard focus and hides on blur", () => {
    btn.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(tip().hidden).toBe(false);
    btn.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(tip().hidden).toBe(true);
  });

  it("is dismissed by Escape, a mousedown and a scroll", () => {
    for (const dismiss of [
      () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
      () => fire(btn, "mousedown"),
      () => document.body.dispatchEvent(new Event("scroll")),
    ]) {
      hover();
      vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
      expect(tip().hidden).toBe(false);
      dismiss();
      expect(tip().hidden).toBe(true);
    }
  });

  it("does nothing for an element without a title", () => {
    const plain = document.createElement("button");
    document.body.appendChild(plain);
    fire(plain, "mouseover");
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(tip().hidden).toBe(true);
    plain.remove();
  });

  it("follows a title that changes after it was adopted", async () => {
    hover();
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    btn.title = "Guardado";
    await observed();
    expect(btn.hasAttribute("title")).toBe(false);
    expect(btn.dataset.tip).toBe("Guardado");
    expect(tip().textContent).toBe("Guardado");
  });

  it("forgets the tip when the title is taken away", async () => {
    hover();
    vi.advanceTimersByTime(TOOLTIP_DELAY_MS);
    expect(tip().hidden).toBe(false);
    // Solid can only remove a title that is present, i.e. one it set since the
    // last adoption — so a set-then-remove in one update is the real shape.
    btn.title = "x";
    btn.removeAttribute("title");
    await observed();
    expect(btn.hasAttribute("data-tip")).toBe(false);
    expect(tip().hidden).toBe(true);
  });

  it("dispose removes the element and stops listening", () => {
    handle!.dispose();
    handle = null;
    expect(document.getElementById(TOOLTIP_ID)).toBeNull();
    hover();
    expect(btn.hasAttribute("title")).toBe(true);
  });
});
