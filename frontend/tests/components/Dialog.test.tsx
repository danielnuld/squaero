import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, createSignal, Show } from "solid-js";
import { render } from "solid-js/web";
import { Dialog } from "../../src/components/Dialog";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
});

function mount(node: () => any) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(node, host!);
  });
}

const key = (target: EventTarget, k: string, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init }));
const actionLabels = () => [...host!.querySelectorAll(".dlg-actions button")].map((b) => b.textContent);

describe("Dialog", () => {
  it("is a modal dialog labelled by its title, in the size asked for", () => {
    mount(() => (
      <Dialog title="Valores" size="sm" onCancel={() => {}}>
        <p>cuerpo</p>
      </Dialog>
    ));
    const box = host!.querySelector(".dlg")!;
    expect(box.getAttribute("role")).toBe("dialog");
    expect(box.getAttribute("aria-modal")).toBe("true");
    expect(box.classList.contains("dlg-sm")).toBe(true);
    const title = document.getElementById(box.getAttribute("aria-labelledby")!)!;
    expect(title.textContent).toBe("Valores");
  });

  it("puts the primary first on Windows", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    mount(() => <Dialog title="t" onCancel={() => {}} primary={{ label: "Guardar", onClick: () => {} }} />);
    expect(actionLabels()).toEqual(["Guardar", "Cancelar"]);
  });

  it("puts Cancel first on macOS and Linux", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    mount(() => <Dialog title="t" onCancel={() => {}} primary={{ label: "Guardar", onClick: () => {} }} />);
    expect(actionLabels()).toEqual(["Cancelar", "Guardar"]);
    dispose?.();
    host?.remove();
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
    mount(() => <Dialog title="t" onCancel={() => {}} primary={{ label: "Guardar", onClick: () => {} }} />);
    expect(actionLabels()).toEqual(["Cancelar", "Guardar"]);
  });

  it("presses the primary with Enter from a field, but not from a textarea or a button", () => {
    const onClick = vi.fn();
    mount(() => (
      <Dialog title="t" onCancel={() => {}} primary={{ label: "Ejecutar", onClick }}>
        <input id="f" />
        <textarea id="ta" />
      </Dialog>
    ));
    const field = host!.querySelector<HTMLInputElement>("#f")!;
    expect(document.activeElement).toBe(field); // focus starts on the first field
    key(field, "Enter");
    expect(onClick).toHaveBeenCalledTimes(1);
    key(host!.querySelector("#ta")!, "Enter");
    expect(onClick).toHaveBeenCalledTimes(1);
    const cancel = [...host!.querySelectorAll<HTMLButtonElement>(".dlg-actions button")].find(
      (b) => b.textContent === "Cancelar",
    )!;
    cancel.focus();
    key(cancel, "Enter");
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("never presses a disabled primary", () => {
    const onClick = vi.fn();
    mount(() => (
      <Dialog title="t" onCancel={() => {}} primary={{ label: "Ejecutar", onClick, disabled: true }}>
        <input id="f" />
      </Dialog>
    ));
    key(host!.querySelector("#f")!, "Enter");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("never presses a danger button with Enter, and starts on Cancel", () => {
    const onClick = vi.fn();
    mount(() => (
      <Dialog title="t" onCancel={() => {}} primary={{ label: "Eliminar", onClick, danger: true }}>
        <input id="f" />
      </Dialog>
    ));
    expect(document.activeElement?.textContent).toBe("Cancelar");
    key(host!.querySelector("#f")!, "Enter");
    expect(onClick).not.toHaveBeenCalled();
    expect(host!.querySelector(".dlg")!.getAttribute("role")).toBe("alertdialog");
  });

  it("cancels with Escape, but not while busy", () => {
    const onCancel = vi.fn();
    const [busy, setBusy] = createSignal(true);
    mount(() => <Dialog title="t" busy={busy()} onCancel={onCancel} />);
    key(document, "Escape");
    expect(onCancel).not.toHaveBeenCalled();
    setBusy(false);
    key(document, "Escape");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("lets an open dropdown inside keep its Escape", () => {
    const onCancel = vi.fn();
    mount(() => (
      <Dialog title="t" onCancel={onCancel}>
        <button id="dd" aria-expanded="true" />
      </Dialog>
    ));
    key(host!.querySelector("#dd")!, "Escape");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("keeps Tab inside: from the last control back to the first, and the other way", () => {
    mount(() => (
      <Dialog title="t" onCancel={() => {}} primary={{ label: "Guardar", onClick: () => {} }}>
        <input id="f" />
      </Dialog>
    ));
    const field = host!.querySelector<HTMLInputElement>("#f")!;
    const buttons = [...host!.querySelectorAll<HTMLButtonElement>(".dlg-actions button")];
    const last = buttons[buttons.length - 1];
    last.focus();
    key(last, "Tab");
    expect(document.activeElement).toBe(field);
    key(field, "Tab", { shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("gives focus back to where it was on close", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const [open, setOpen] = createSignal(true);
    mount(() => (
      <Show when={open()}>
        <Dialog title="t" onCancel={() => setOpen(false)} primary={{ label: "Ok", onClick: () => {} }} />
      </Show>
    ));
    expect(document.activeElement).not.toBe(opener);
    key(document, "Escape");
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it("answers only in the topmost of two stacked dialogs", () => {
    const outer = vi.fn();
    const inner = vi.fn();
    mount(() => (
      <>
        <Dialog title="fuera" onCancel={outer} />
        <Dialog title="dentro" onCancel={inner} />
      </>
    ));
    key(document, "Escape");
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it("closes on a backdrop click only when the click started there", () => {
    const onCancel = vi.fn();
    mount(() => <Dialog title="t" onCancel={onCancel} />);
    const scrim = host!.querySelector<HTMLElement>(".dlg-scrim")!;
    host!.querySelector(".dlg")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    scrim.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onCancel).not.toHaveBeenCalled();
    scrim.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    scrim.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
