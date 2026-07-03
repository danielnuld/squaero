import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { Modal } from "../../src/components/Modal";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(onClose: () => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <Modal title="Prueba" onClose={onClose}>
          <p>contenido</p>
        </Modal>
      ),
      host!,
    );
  });
}

describe("Modal", () => {
  it("exposes dialog semantics and an accessible name", () => {
    mount(() => {});
    const dialog = host!.querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog).not.toBeNull();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.getAttribute("aria-label")).toBe("Prueba");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    mount(onClose);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click but not on inner click", () => {
    const onClose = vi.fn();
    mount(onClose);
    (host!.querySelector('[role="dialog"]') as HTMLElement).click();
    expect(onClose).not.toHaveBeenCalled();
    (host!.querySelector(".modal-backdrop") as HTMLElement).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
