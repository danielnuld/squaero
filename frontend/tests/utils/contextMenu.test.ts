import { describe, it, expect, afterEach, vi } from "vitest";
import {
  contextMenu,
  openContextMenu,
  closeContextMenu,
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
