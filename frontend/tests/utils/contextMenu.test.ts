import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import {
  contextMenu,
  openContextMenu,
  closeContextMenu,
  clampToViewport,
  installContextMenuKey,
  keyboardMenuPoint,
  type MenuItem,
} from "../../src/utils/contextMenu";

const makeEvent = (x = 10, y = 20) => {
  const preventDefault = vi.fn();
  const stopPropagation = vi.fn();
  return {
    ev: { clientX: x, clientY: y, preventDefault, stopPropagation } as unknown as MouseEvent,
    preventDefault,
    stopPropagation,
  };
};

const items: MenuItem[] = [{ label: "A", action: () => {} }];

afterEach(() => closeContextMenu());

describe("openContextMenu", () => {
  it("stores position + items and suppresses the native menu", () => {
    const { ev, preventDefault, stopPropagation } = makeEvent(30, 40);
    openContextMenu(ev, items);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
    expect(contextMenu()).toEqual({ x: 30, y: 40, items });
  });

  it("does not open for an empty item list (still suppresses native)", () => {
    const { ev, preventDefault } = makeEvent();
    openContextMenu(ev, []);
    expect(preventDefault).toHaveBeenCalled();
    expect(contextMenu()).toBeNull();
  });
});

describe("closeContextMenu", () => {
  it("clears the open menu", () => {
    openContextMenu(makeEvent().ev, items);
    expect(contextMenu()).not.toBeNull();
    closeContextMenu();
    expect(contextMenu()).toBeNull();
  });
});

describe("clampToViewport", () => {
  const box = { width: 180, height: 120, viewportW: 1000, viewportH: 800 };

  it("leaves a menu with room to spare where it was asked for", () => {
    expect(clampToViewport({ x: 300, y: 200, ...box })).toEqual({ x: 300, y: 200 });
  });

  it("pulls a menu in from the right edge", () => {
    // 900 + 180 would end at 1080, past the 1000px window.
    expect(clampToViewport({ x: 900, y: 200, ...box })).toEqual({ x: 816, y: 200 });
  });

  it("pulls a menu up from the bottom edge", () => {
    expect(clampToViewport({ x: 300, y: 760, ...box })).toEqual({ x: 300, y: 676 });
  });

  it("pulls in from both edges at once", () => {
    expect(clampToViewport({ x: 990, y: 790, ...box })).toEqual({ x: 816, y: 676 });
  });

  it("pins a menu larger than the window at the margin", () => {
    expect(
      clampToViewport({ x: 50, y: 50, width: 400, height: 900, viewportW: 300, viewportH: 500 }),
    ).toEqual({ x: 4, y: 4 });
  });

  it("never places the menu before the margin", () => {
    expect(clampToViewport({ x: -20, y: -5, ...box })).toEqual({ x: 4, y: 4 });
  });

  it("honors an explicit margin", () => {
    expect(clampToViewport({ x: 900, y: 200, ...box, margin: 12 })).toEqual({ x: 808, y: 200 });
  });
});

describe("keyboardMenuPoint", () => {
  const viewport = { width: 1000, height: 800 };

  it("opens just inside the focused element's bottom-left corner", () => {
    expect(keyboardMenuPoint({ left: 100, top: 100, width: 200, height: 40 }, viewport)).toEqual({
      x: 108,
      y: 132,
    });
  });

  it("stays on screen for an element taller or wider than the window", () => {
    expect(keyboardMenuPoint({ left: 0, top: 0, width: 3000, height: 3000 }, viewport)).toEqual({
      x: 8,
      y: 792,
    });
    expect(keyboardMenuPoint({ left: 1500, top: 0, width: 10, height: 10 }, viewport).x).toBe(992);
  });

  it("never goes above the element itself", () => {
    expect(keyboardMenuPoint({ left: 10, top: 300, width: 50, height: 4 }, viewport).y).toBe(300);
  });
});

describe("installContextMenuKey", () => {
  let uninstall: (() => void) | null = null;
  let btn: HTMLButtonElement;

  beforeEach(() => {
    uninstall = installContextMenuKey(document);
    btn = document.createElement("button");
    document.body.appendChild(btn);
  });
  afterEach(() => {
    uninstall?.();
    uninstall = null;
    btn.remove();
  });

  const press = (key: string, init: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    btn.dispatchEvent(ev);
    return ev;
  };

  it("turns the Menu key on the focused element into a contextmenu event there", () => {
    const seen = vi.fn((e: MouseEvent) => e.preventDefault());
    btn.addEventListener("contextmenu", seen);
    btn.focus();
    const ev = press("ContextMenu");
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0].button).toBe(2);
    expect(ev.defaultPrevented).toBe(true);
  });

  it("does the same for Shift+F10, bubbling to the handlers a right-click reaches", () => {
    const seen = vi.fn();
    document.body.addEventListener("contextmenu", seen);
    btn.focus();
    press("F10", { shiftKey: true });
    expect(seen).toHaveBeenCalledTimes(1);
    document.body.removeEventListener("contextmenu", seen);
  });

  it("ignores F10 without Shift, and the keys when nothing is focused", () => {
    const seen = vi.fn();
    document.addEventListener("contextmenu", seen);
    btn.focus();
    press("F10");
    btn.blur();
    press("ContextMenu");
    expect(seen).not.toHaveBeenCalled();
    document.removeEventListener("contextmenu", seen);
  });

  it("stops after uninstall", () => {
    uninstall!();
    uninstall = null;
    const seen = vi.fn();
    btn.addEventListener("contextmenu", seen);
    btn.focus();
    press("ContextMenu");
    expect(seen).not.toHaveBeenCalled();
  });
});
