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
