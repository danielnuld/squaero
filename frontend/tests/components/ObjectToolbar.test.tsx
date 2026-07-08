import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ObjectToolbar } from "../../src/components/ObjectToolbar";
import { contextMenu, closeContextMenu } from "../../src/utils/contextMenu";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  closeContextMenu(); // reset the shared menu between cases
});

function mount(over: Partial<Parameters<typeof ObjectToolbar>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const props = {
    isTable: true,
    hasColumns: true,
    editing: false,
    editable: true,
    busy: false,
    error: null,
    changeCount: 0,
    hasChanges: false,
    exportFormats: [
      { fmt: "csv", label: "CSV" },
      { fmt: "json", label: "JSON" },
    ],
    onEdit: vi.fn(),
    onImport: vi.fn(),
    onGenerate: vi.fn(),
    onSchemaSync: vi.fn(),
    onDataSync: vi.fn(),
    onTransfer: vi.fn(),
    onAddRow: vi.fn(),
    onConfirm: vi.fn(),
    onDiscard: vi.fn(),
    onChart: vi.fn(),
    onExport: vi.fn(),
    ...over,
  };
  createRoot((d) => {
    dispose = d;
    render(() => <ObjectToolbar {...props} />, host!);
  });
  return props;
}

// Buttons now carry a leading glyph, so match by label substring, not equality.
const btn = (label: string) =>
  [...host!.querySelectorAll("button.edit-btn")].find((b) =>
    b.textContent?.includes(label),
  ) as HTMLButtonElement | undefined;

describe("ObjectToolbar", () => {
  it("shows the at-rest table actions with Editar as the primary action", () => {
    const p = mount();
    const edit = btn("Editar")!;
    expect(edit).toBeTruthy();
    expect(edit.classList.contains("edit-btn-primary")).toBe(true);
    btn("Editar")!.click();
    btn("Importar")!.click();
    btn("Generar datos")!.click();
    btn("Transferir")!.click();
    expect(p.onEdit).toHaveBeenCalledTimes(1);
    expect(p.onImport).toHaveBeenCalledTimes(1);
    expect(p.onGenerate).toHaveBeenCalledTimes(1);
    expect(p.onTransfer).toHaveBeenCalledTimes(1);
  });

  it("shows the read-only hint (no Editar) when the table lacks a primary key", () => {
    mount({ editable: false });
    expect(btn("Editar")).toBeUndefined();
    expect(host!.querySelector(".edit-hint-ro")).toBeTruthy();
  });

  it("opens the Sincronizar menu: schema always, data only when editable + columns", () => {
    const p = mount(); // editable + hasColumns
    btn("Sincronizar")!.click();
    let menu = contextMenu();
    expect(menu?.items.map((i) => i.label)).toEqual([
      "Estructura (esquema)…",
      "Datos…",
    ]);
    // Invoking the items calls the right callbacks.
    menu!.items[0].action!();
    menu!.items[1].action!();
    expect(p.onSchemaSync).toHaveBeenCalledTimes(1);
    expect(p.onDataSync).toHaveBeenCalledTimes(1);
  });

  it("omits the Datos entry from the Sincronizar menu for a non-editable table", () => {
    mount({ editable: false });
    btn("Sincronizar")!.click();
    expect(contextMenu()?.items.map((i) => i.label)).toEqual([
      "Estructura (esquema)…",
    ]);
  });

  it("renders the edit-flow buttons while editing", () => {
    const p = mount({ editing: true, hasChanges: true, changeCount: 3 });
    expect(btn("Editar")).toBeUndefined();
    btn("Fila")!.click();
    const confirm = btn("Confirmar (3)")!;
    expect(confirm).toBeTruthy();
    expect(confirm.classList.contains("edit-btn-primary")).toBe(true);
    confirm.click();
    btn("Descartar")!.click();
    expect(p.onAddRow).toHaveBeenCalledTimes(1);
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
  });

  it("disables Confirmar when there are no pending changes", () => {
    mount({ editing: true, hasChanges: false, changeCount: 0 });
    expect(btn("Confirmar (0)")!.disabled).toBe(true);
  });

  it("disables mutating buttons while an edit is in flight", () => {
    mount({ editing: true, busy: true, hasChanges: true, changeCount: 1 });
    expect(btn("Confirmar (1)")!.disabled).toBe(true);
    expect(btn("Descartar")!.disabled).toBe(true);
  });

  it("opens the Exportar menu with one entry per format and fires them", () => {
    const p = mount();
    btn("Graficar")!.click();
    expect(p.onChart).toHaveBeenCalledTimes(1);
    btn("Exportar")!.click();
    const menu = contextMenu();
    expect(menu?.items.map((i) => i.label)).toEqual(["CSV", "JSON"]);
    menu!.items[0].action!();
    menu!.items[1].action!();
    expect(p.onExport).toHaveBeenNthCalledWith(1, "csv");
    expect(p.onExport).toHaveBeenNthCalledWith(2, "json");
  });

  it("hides table + export actions for a non-table result without columns", () => {
    mount({ isTable: false, hasColumns: false });
    expect(btn("Editar")).toBeUndefined();
    expect(btn("Graficar")).toBeUndefined();
    expect(btn("Exportar")).toBeUndefined();
  });

  it("surfaces the edit-session error", () => {
    mount({ error: "rollback failed" });
    expect(host!.querySelector(".edit-error")?.textContent).toBe("rollback failed");
  });
});
