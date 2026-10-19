import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ConfirmDialog } from "../../src/components/ConfirmDialog";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(node: () => any) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(node, host!);
  });
}

const clickText = (text: string) =>
  ([...host!.querySelectorAll("button")].find((b) => b.textContent?.trim() === text) as HTMLButtonElement).click();

describe("ConfirmDialog", () => {
  it("renders the message and the exact SQL", () => {
    mount(() => (
      <ConfirmDialog message="Se eliminará x." sql="DROP TABLE `t`" onConfirm={() => {}} onCancel={() => {}} />
    ));
    const dialog = host!.querySelector(".confirm-dialog")!;
    expect(dialog.getAttribute("role")).toBe("alertdialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Se eliminará x.");
    expect(host!.querySelector("pre.ddl-text")!.textContent).toBe("DROP TABLE `t`");
  });

  it("calls onConfirm from the destructive button and onCancel from Cancel", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    mount(() => (
      <ConfirmDialog message="m" confirmLabel="Eliminar" onConfirm={onConfirm} onCancel={onCancel} />
    ));
    clickText("Eliminar");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    clickText("Cancelar");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape and on backdrop click", () => {
    const onCancel = vi.fn();
    mount(() => <ConfirmDialog message="m" onConfirm={() => {}} onCancel={onCancel} />);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);

    const scrim = host!.querySelector(".dlg-scrim") as HTMLElement;
    scrim.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    scrim.click(); // click the backdrop itself
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("cancels on Escape even when focus is outside the dialog", () => {
    const onCancel = vi.fn();
    mount(() => <ConfirmDialog message="m" onConfirm={() => {}} onCancel={onCancel} />);
    // Move focus out of the dialog, then fire Escape from there.
    (document.activeElement as HTMLElement)?.blur();
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("stops Escape from reaching an underlying Panel-style close handler", () => {
    const onCancel = vi.fn();
    const panelClose = vi.fn();
    // A Panel registers a bubble document keydown → onClose on Escape. The dialog's
    // capture-phase listener runs first and must swallow the event.
    const panelListener = (e: KeyboardEvent) => {
      if (e.key === "Escape") panelClose();
    };
    document.addEventListener("keydown", panelListener);
    try {
      mount(() => <ConfirmDialog message="m" onConfirm={() => {}} onCancel={onCancel} />);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(onCancel).toHaveBeenCalledTimes(1);
      expect(panelClose).not.toHaveBeenCalled(); // dialog swallowed the event
    } finally {
      document.removeEventListener("keydown", panelListener);
    }
  });

  it("disables buttons and shows an error while busy / on failure", () => {
    mount(() => (
      <ConfirmDialog message="m" busy error="Falló el DROP" onConfirm={() => {}} onCancel={() => {}} />
    ));
    const buttons = [...host!.querySelectorAll("button")] as HTMLButtonElement[];
    expect(buttons.every((b) => b.disabled)).toBe(true);
    expect(host!.textContent).toContain("Falló el DROP");
    expect(host!.textContent).toContain("Aplicando…");
  });

  it("focuses Cancel (not the destructive action) so Enter does not confirm", () => {
    const onConfirm = vi.fn();
    mount(() => <ConfirmDialog message="m" onConfirm={onConfirm} onCancel={() => {}} />);
    const cancel = [...host!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Cancelar");
    expect(document.activeElement).toBe(cancel);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("offers a third choice only when asked to (#667)", () => {
    const onAlt = vi.fn();
    const onConfirm = vi.fn();
    mount(() => (
      <ConfirmDialog
        message="m"
        confirmLabel="Revertir"
        altLabel="Confirmar"
        onAlt={onAlt}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />
    ));
    expect(host!.querySelectorAll(".dlg-f button").length).toBe(3);
    clickText("Confirmar");
    expect(onAlt).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("has two buttons without an alternative", () => {
    mount(() => <ConfirmDialog message="m" onConfirm={() => {}} onCancel={() => {}} />);
    expect(host!.querySelectorAll(".dlg-f button").length).toBe(2);
  });

  it("omits the SQL block when no sql is given", () => {
    mount(() => <ConfirmDialog message="m" onConfirm={() => {}} onCancel={() => {}} />);
    expect(host!.querySelector("pre.ddl-text")).toBeNull();
  });
});

describe("ConfirmDialog extra content", () => {
  it("renders the children between the message and the SQL", () => {
    mount(() => (
      <ConfirmDialog message="Elige el nombre." sql="db.a.renameCollection('b')" onConfirm={() => {}} onCancel={() => {}}>
        <input id="extra-field" />
      </ConfirmDialog>
    ));
    const body = host!.querySelector(".confirm-dialog .dlg-b")!;
    const kids = [...body.children].map((c) => c.tagName + (c.id ? "#" + c.id : ""));
    expect(kids.indexOf("INPUT#extra-field")).toBeGreaterThan(kids.indexOf("P"));
    expect(kids.indexOf("INPUT#extra-field")).toBeLessThan(kids.indexOf("PRE"));
  });
});

describe("ConfirmDialog typed name (audit A-25)", () => {
  it("keeps the danger button disabled until the exact name is typed", () => {
    const onConfirm = vi.fn();
    mount(() => (
      <ConfirmDialog message="m" confirmLabel="Eliminar tabla" typeToConfirm="clientes" onConfirm={onConfirm} onCancel={() => {}} />
    ));
    const danger = host!.querySelector(".btn-danger") as HTMLButtonElement;
    const input = host!.querySelector(".dlg-field input") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(host!.textContent).toContain("Escribe «clientes» para confirmar");
    expect(danger.disabled).toBe(true);
    input.value = "Clientes";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(danger.disabled).toBe(true);
    input.value = " clientes ";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    expect(danger.disabled).toBe(false);
    // Enter in the box still does not delete: only the button does.
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onConfirm).not.toHaveBeenCalled();
    danger.click();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
