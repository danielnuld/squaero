import { describe, it, expect, afterEach, vi } from "vitest";
import {
  contextMenu,
  openContextMenu,
  closeContextMenu,
  clampToViewport,
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
