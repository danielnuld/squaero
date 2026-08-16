import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { SnippetsPanel } from "../../src/components/SnippetsPanel";
import { ContextMenu } from "../../src/components/ContextMenu";
import type { Snippet } from "../../src/utils/snippets";

// The library panel (issue #338): find one among many, look at it, act on it.
// It deliberately holds no editor and no "save the current query" — both belong
// to the snippet's own tab and the editor toolbar.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  document.querySelector(".context-menu")?.remove();
});

const entries: Snippet[] = [
  { id: "snip-1", name: "Orders", body: "SELECT * FROM orders" },
  { id: "snip-2", name: "Impagadas", body: "SELECT f.folio\nFROM facturas f\nLEFT JOIN clientes c" },
];

function mount(props: Partial<Parameters<typeof SnippetsPanel>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const full = {
    entries,
    onOpen: () => {},
    onInsert: () => {},
    onRename: () => {},
    onDuplicate: () => {},
    onRemove: () => {},
    onExport: () => {},
    onImport: () => {},
    onClose: () => {},
    ...props,
  };
  createRoot((d) => {
    dispose = d;
    // The ⋯ / right-click menu is rendered by the app, not by the panel, so the
    // panel's menu actions are only reachable with it mounted alongside.
    render(
      () => (
        <>
          <SnippetsPanel {...full} />
          <ContextMenu />
        </>
      ),
      host!,
    );
  });
}

const typeInto = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const search = () => host!.querySelector(".snippet-search") as HTMLInputElement;
const rows = () => [...host!.querySelectorAll(".snippet-row")] as HTMLButtonElement[];
const rowNames = () => rows().map((r) => r.querySelector(".snippet-row-name")?.textContent);
const detailBody = () => host!.querySelector(".snippet-body")?.textContent;
const detailName = () => host!.querySelector(".snippet-detail-name")?.textContent;
const byText = (sel: string, text: string) =>
  [...host!.querySelectorAll(sel)].find((b) => b.textContent?.trim() === text) as HTMLElement;

describe("SnippetsPanel", () => {
  it("lists every snippet with the first line of what it does", () => {
    mount();
    expect(rowNames()).toEqual(["Orders", "Impagadas"]);
    expect(rows()[1].querySelector(".snippet-row-hint")?.textContent).toBe("SELECT f.folio");
  });

  it("shows the selected snippet's whole body beside the list", () => {
    mount();
    // The first is selected by default, so the pane is never blank.
    expect(detailName()).toBe("Orders");
    expect(detailBody()).toBe("SELECT * FROM orders");

    rows()[1].click();
    expect(detailName()).toBe("Impagadas");
    expect(detailBody()).toContain("LEFT JOIN clientes c");
  });

  it("filters by name", () => {
    mount();
    typeInto(search(), "impag");
    expect(rowNames()).toEqual(["Impagadas"]);
  });

  it("filters by what the query does, not only by its name", () => {
    mount();
    // "left join" appears nowhere except inside a body.
    typeInto(search(), "left join");
    expect(rowNames()).toEqual(["Impagadas"]);
  });

  it("keeps the detail on a snippet that survived the filter", () => {
    mount();
    rows()[1].click();
    typeInto(search(), "orders");
    // The selection was filtered out; showing it anyway would point at a row that
    // is no longer on screen.
    expect(detailName()).toBe("Orders");
  });

  it("tells nothing-saved apart from nothing-matching", () => {
    mount({ entries: [] });
    expect(host!.querySelector(".snippet-empty")?.textContent).toContain("no has guardado");

    dispose?.();
    host?.remove();
    mount();
    typeInto(search(), "zzz");
    expect(host!.querySelector(".snippet-empty")?.textContent).toContain("Ningún snippet");
  });

  it("opens the selected snippet", () => {
    const onOpen = vi.fn();
    mount({ onOpen });
    rows()[1].click();
    byText(".snippet-detail-head .primary", "Abrir").click();
    expect(onOpen).toHaveBeenCalledWith(entries[1]);
  });

  it("moves the selection with the arrows and opens on Enter", () => {
    const onOpen = vi.fn();
    mount({ onOpen });
    const list = host!.querySelector(".snippet-list")!;
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    expect(detailName()).toBe("Impagadas");
    list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onOpen).toHaveBeenCalledWith(entries[1]);
  });

  it("renames from the detail pane on Enter", () => {
    const onRename = vi.fn();
    mount({ onRename });
    menuItem("Renombrar").click();
    const input = host!.querySelector(".snippet-rename") as HTMLInputElement;
    typeInto(input, "Pedidos");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(onRename).toHaveBeenCalledWith("snip-1", "Pedidos");
  });

  it("offers insert, duplicate and delete in the row's menu", () => {
    const onDuplicate = vi.fn();
    const onRemove = vi.fn();
    const onInsert = vi.fn();
    mount({ onDuplicate, onRemove, onInsert });

    menuItem("Insertar en el cursor").click();
    expect(onInsert).toHaveBeenCalledWith(entries[0]);

    menuItem("Duplicar").click();
    expect(onDuplicate).toHaveBeenCalledWith(entries[0]);

    menuItem("Borrar").click();
    expect(onRemove).toHaveBeenCalledWith("snip-1");
  });

  it("imports a file and exports the set", () => {
    const onImport = vi.fn();
    const onExport = vi.fn();
    mount({ onImport, onExport });
    // Import/export moved from a footer to the shared panel bar (#372).
    const exportBtn = byText(".panel-bar button", "Exportar") as HTMLButtonElement;
    expect(exportBtn.disabled).toBe(false);
    exportBtn.click();
    expect(onExport).toHaveBeenCalled();

    const file = new File(['[{"id":"x","name":"n","body":"b"}]'], "s.json", {
      type: "application/json",
    });
    const fileInput = host!.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(onImport).toHaveBeenCalledWith(file);
  });
});

/** Opens the first row's context menu and returns the item labelled `label`. */
function menuItem(label: string): HTMLButtonElement {
  rows()[0].dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
  const found = [...host!.querySelectorAll(".context-menu button")].find(
    (b) => b.textContent?.trim() === label,
  );
  if (!found) throw new Error(`no menu item "${label}"`);
  return found as HTMLButtonElement;
}
