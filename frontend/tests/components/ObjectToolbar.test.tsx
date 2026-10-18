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
    onRefresh: vi.fn(),
    refreshBlocked: null as string | null,
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

  it("disables Editar and says why when the table lacks a primary key", () => {
    const p = mount({ editable: false });
    const edit = btn("Editar")!;
    expect(edit.disabled).toBe(true);
    edit.click();
    expect(p.onEdit).not.toHaveBeenCalled();
    const hint = document.getElementById(edit.getAttribute("aria-describedby")!);
    expect(hint?.textContent).toMatch(/clave primaria/);
  });

  it("shows a query result's reason on a disabled Editar, without the table actions", () => {
    mount({ isTable: false, editable: false, readOnlyReason: "Solo lectura: un join" });
    const edit = btn("Editar")!;
    expect(edit.disabled).toBe(true);
    expect(document.getElementById(edit.getAttribute("aria-describedby")!)?.textContent).toBe(
      "Solo lectura: un join",
    );
    expect(btn("Importar")).toBeUndefined();
    expect(btn("Sincronizar")).toBeUndefined();
  });

  it("shows no edit section for a query result with nothing to say", () => {
    mount({ isTable: false, editable: false, readOnlyReason: null });
    expect(btn("Editar")).toBeUndefined();
  });

  it("opens the Sincronizar menu: schema always, data only when editable + columns", () => {
    const p = mount(); // editable + hasColumns
    btn("Sincronizar")!.click();
    let menu = contextMenu();
    expect(menu?.items.map((i) => i.label)).toEqual([
      "Estructura…",
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
      "Estructura…",
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

  it("refreshes what the tab is showing (issue #448)", () => {
    const p = mount();
    const refresh = btn("Refrescar")!;
    expect(refresh).toBeTruthy();
    expect(refresh.disabled).toBe(false);
    refresh.click();
    expect(p.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the refresh visible but disabled, carrying its reason", () => {
    // A button that disappears leaves "it stopped being there" as the only
    // explanation; the reason rides in the tooltip instead (#344 / #448).
    const p = mount({ refreshBlocked: "Hay cambios sin confirmar" });
    const refresh = btn("Refrescar")!;
    expect(refresh.disabled).toBe(true);
    expect(refresh.title).toBe("Hay cambios sin confirmar");
    refresh.click();
    expect(p.onRefresh).not.toHaveBeenCalled();
  });

  it("offers the refresh even for a result that is not a table", () => {
    // A query tab's page goes stale exactly like a table's.
    mount({ isTable: false, hasColumns: true });
    expect(btn("Refrescar")).toBeTruthy();
  });

  // Issue #670: columns as rows.
  it("toggles the transposed view, and says whether it is on", () => {
    const onTranspose = vi.fn();
    mount({ onTranspose, transposed: true });
    const b = btn("Transponer")!;
    expect(b.getAttribute("aria-pressed")).toBe("true");
    b.click();
    expect(onTranspose).toHaveBeenCalledTimes(1);
  });

  it("offers no transposed view while editing, nor without a handler", () => {
    mount({ onTranspose: vi.fn(), editing: true });
    expect(btn("Transponer")!.disabled).toBe(true);
    dispose?.();
    host?.remove();
    mount();
    expect(btn("Transponer")).toBeUndefined();
  });

  // Issue #669: pin the result, and compare it with another.
  it("pins the result, or says why it cannot", () => {
    const onPin = vi.fn();
    mount({ onPin });
    btn("Fijar resultado")!.click();
    expect(onPin).toHaveBeenCalledTimes(1);
    dispose?.();
    host?.remove();
    mount({ onPin, pinBlocked: "lleno" });
    expect(btn("Fijar resultado")!.disabled).toBe(true);
    expect(btn("Fijar resultado")!.title).toBe("lleno");
  });

  it("opens the compare menu, and shows neither button without handlers", () => {
    const onCompare = vi.fn();
    mount({ onCompare });
    btn("Comparar con…")!.click();
    expect(onCompare).toHaveBeenCalledTimes(1);
    dispose?.();
    host?.remove();
    mount();
    expect(btn("Comparar con…")).toBeUndefined();
    expect(btn("Fijar resultado")).toBeUndefined();
  });
});

// Safe mode (issue #666): a read-only connection offers nothing that writes.
describe("ObjectToolbar on a read-only connection", () => {
  it("says why, with Edit disabled and no Import or Generate", () => {
    mount({ editable: false, readOnly: true });
    expect(host!.querySelector(".edit-hint-ro")?.textContent).toBe(
      "Solo lectura: la conexión está protegida.",
    );
    expect(btn("Editar")?.disabled).toBe(true);
    expect(btn("Importar")).toBeUndefined();
    expect(btn("Generar")).toBeUndefined();
    expect(btn("Exportar")).toBeDefined(); // reading out is still fine
  });
});
