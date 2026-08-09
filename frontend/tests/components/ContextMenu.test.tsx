import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ContextMenu } from "../../src/components/ContextMenu";
import { openContextMenu, closeContextMenu, type MenuItem } from "../../src/utils/contextMenu";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  closeContextMenu();
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const mount = () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <ContextMenu />, host!);
  });
};

const evAt = (x: number, y: number) =>
  ({ clientX: x, clientY: y, preventDefault() {}, stopPropagation() {} }) as unknown as MouseEvent;

describe("ContextMenu", () => {
  it("renders nothing until a menu is opened", () => {
    mount();
    expect(host!.querySelector(".context-menu")).toBeNull();
  });

  it("renders items and runs an action then closes on click", () => {
    mount();
    const action = vi.fn();
    const items: MenuItem[] = [
      { label: "Uno", action },
      { separator: true },
      { label: "Dos", action: () => {} },
    ];
    openContextMenu(evAt(5, 5), items);
    const buttons = [...host!.querySelectorAll(".context-menu-item")];
    expect(buttons.map((b) => b.textContent)).toEqual(["Uno", "Dos"]);
    expect(host!.querySelector(".context-menu-sep")).not.toBeNull();

    (buttons[0] as HTMLButtonElement).click();
    expect(action).toHaveBeenCalledTimes(1);
    expect(host!.querySelector(".context-menu")).toBeNull(); // closed
  });

  it("does not fire a disabled item", () => {
    mount();
    const action = vi.fn();
    openContextMenu(evAt(0, 0), [{ label: "X", action, disabled: true }]);
    (host!.querySelector(".context-menu-item") as HTMLButtonElement).click();
    expect(action).not.toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    mount();
    openContextMenu(evAt(0, 0), [{ label: "X", action: () => {} }]);
    expect(host!.querySelector(".context-menu")).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(host!.querySelector(".context-menu")).toBeNull();
  });
});

describe("ContextMenu placement (issue #318)", () => {
  // jsdom has no layout: every element measures 0x0, which is exactly the shape
  // of the bug (the clamp used to measure a still-detached element and so never
  // moved anything). Stub the box so the clamp has a real size to work with.
  const stubSize = (width: number, height: number) => {
    const proto = HTMLDivElement.prototype;
    const original = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function (this: HTMLDivElement) {
      return this.classList?.contains("context-menu")
        ? ({ width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height } as DOMRect)
        : original.call(this);
    };
    return () => {
      proto.getBoundingClientRect = original;
    };
  };
  const flush = () => new Promise((r) => queueMicrotask(() => r(null)));
  const menu = () => host!.querySelector<HTMLElement>(".context-menu")!;

  it("pulls a menu opened at the right edge back inside the window", async () => {
    const restore = stubSize(180, 120);
    try {
      mount();
      // jsdom's window is 1024x768.
      openContextMenu(evAt(1000, 40), [{ label: "CSV" }, { label: "JSON" }]);
      await flush();
      expect(menu().style.left).toBe(`${1024 - 180 - 4}px`);
      expect(menu().style.top).toBe("40px");
    } finally {
      restore();
    }
  });

  it("leaves a menu with room to spare at the click position", async () => {
    const restore = stubSize(180, 120);
    try {
      mount();
      openContextMenu(evAt(120, 60), [{ label: "CSV" }]);
      await flush();
      expect(menu().style.left).toBe("120px");
      expect(menu().style.top).toBe("60px");
    } finally {
      restore();
    }
  });
});
