import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { SnippetsPanel } from "../../src/components/SnippetsPanel";
import type { Snippet } from "../../src/utils/snippets";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const entries: Snippet[] = [{ id: "snip-1", name: "Orders", body: "SELECT * FROM orders" }];

function mount(props: Partial<Parameters<typeof SnippetsPanel>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const full = {
    entries,
    currentSql: "SELECT 1",
    onSave: () => {},
    onInsert: () => {},
    onRename: () => {},
    onRemove: () => {},
    onExport: () => {},
    onImport: () => {},
    onClose: () => {},
    ...props,
  };
  createRoot((d) => {
    dispose = d;
    render(() => <SnippetsPanel {...full} />, host!);
  });
}

const typeInto = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("SnippetsPanel", () => {
  it("saves the current query as a named favorite", () => {
    const onSave = vi.fn();
    mount({ onSave });
    typeInto(host!.querySelector(".snippet-name") as HTMLInputElement, "Mi consulta");
    (host!.querySelector(".snippet-save .primary") as HTMLButtonElement).click();
    expect(onSave).toHaveBeenCalledWith("Mi consulta", "SELECT 1");
  });

  it("disables save with a blank name or empty editor", () => {
    mount({ currentSql: "   " });
    const btn = host!.querySelector(".snippet-save .primary") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("inserts a snippet and closes", () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    mount({ onInsert, onClose });
    const insertBtn = [...host!.querySelectorAll(".snippet-actions .link")].find(
      (b) => b.textContent === "Insertar",
    ) as HTMLButtonElement;
    insertBtn.click();
    expect(onInsert).toHaveBeenCalledWith("SELECT * FROM orders");
    expect(onClose).toHaveBeenCalled();
  });

  it("renames a snippet inline on Enter", () => {
    const onRename = vi.fn();
    mount({ onRename });
    const renameBtn = [...host!.querySelectorAll(".snippet-actions .link")].find(
      (b) => b.textContent === "Renombrar",
    ) as HTMLButtonElement;
    renameBtn.click();
    const input = host!.querySelector(".snippet-rename") as HTMLInputElement;
    typeInto(input, "Pedidos");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onRename).toHaveBeenCalledWith("snip-1", "Pedidos");
  });

  it("removes a snippet", () => {
    const onRemove = vi.fn();
    mount({ onRemove });
    const del = [...host!.querySelectorAll(".snippet-actions .link")].find(
      (b) => b.textContent === "Borrar",
    ) as HTMLButtonElement;
    del.click();
    expect(onRemove).toHaveBeenCalledWith("snip-1");
  });

  it("imports a file and exports the set", () => {
    const onImport = vi.fn();
    const onExport = vi.fn();
    mount({ onImport, onExport });
    // Export button enabled with entries present.
    const exportBtn = [...host!.querySelectorAll(".modal-actions button")].find(
      (b) => b.textContent === "Exportar",
    ) as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(false);
    exportBtn.click();
    expect(onExport).toHaveBeenCalled();
    // Import forwards the chosen file.
    const file = new File(['[{"id":"x","name":"n","body":"b"}]'], "s.json", {
      type: "application/json",
    });
    const fileInput = host!.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onImport).toHaveBeenCalledWith(file);
  });

  it("shows an empty state when there are no snippets", () => {
    mount({ entries: [] });
    expect(host!.querySelector(".snippet-empty")).not.toBeNull();
  });
});
