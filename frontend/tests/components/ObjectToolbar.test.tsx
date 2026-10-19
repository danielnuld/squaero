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

// Buttons carry a leading glyph, so match by label substring; the icon-only
// tools are matched by their accessible name.
const btn = (label: string) =>
  [...host!.querySelectorAll("button.edit-btn, button.seg-btn")].find(
    (b) => b.textContent?.includes(label) || b.getAttribute("aria-label") === label,
  ) as HTMLButtonElement | undefined;

/** Opens the More menu and returns its labels (a separator reads as a dash). */
const moreLabels = () => {
  btn("Más acciones")!.click();
  return contextMenu()?.items.map((i) => i.label ?? "-");
};

describe("ObjectToolbar", () => {
  it("has no Editar button: an editable table only hints at editing in place", () => {
    mount({ editHint: "Doble clic para editar" });
    expect(btn("Editar")).toBeUndefined();
    expect(host!.querySelector(".edit-hint")?.textContent).toBe("Doble clic para editar");
    expect(host!.querySelector(".edit-btn-primary")).toBeNull();
  });

  it("puts the rarely used table actions under Más", () => {
    const p = mount();
    expect(btn("Importar")).toBeUndefined();
    expect(moreLabels()).toEqual([
      "Importar",
      "Generar datos",
      "Transferir",
      "Sincronizar estructura…",
      "Sincronizar datos…",
    ]);
    for (const item of contextMenu()!.items) item.action!();
    expect(p.onImport).toHaveBeenCalledTimes(1);
    expect(p.onGenerate).toHaveBeenCalledTimes(1);
    expect(p.onTransfer).toHaveBeenCalledTimes(1);
    expect(p.onSchemaSync).toHaveBeenCalledTimes(1);
    expect(p.onDataSync).toHaveBeenCalledTimes(1);
  });

  it("appends the tab's own entries to Más after a separator", () => {
    const plan = vi.fn();
    mount({ moreItems: [{ label: "Plan", action: plan }] });
    expect(moreLabels()?.slice(-2)).toEqual(["-", "Plan"]);
  });

  it("says why a table without a primary key cannot be edited, and offers no row", () => {
    mount({ editable: false });
    expect(host!.querySelector(".edit-hint-ro")?.textContent).toMatch(/clave primaria/);
    expect(btn("Fila")).toBeUndefined();
    expect(moreLabels()).not.toContain("Sincronizar datos…");
  });

  it("shows a query result's read-only reason, without the table actions", () => {
    mount({ isTable: false, editable: false, readOnlyReason: "Solo lectura: un join" });
    expect(host!.querySelector(".edit-hint-ro")?.textContent?.trim()).toBe("Solo lectura: un join");
    // A chip cut short by a narrow bar still reads in full on hover (A-03).
    expect(host!.querySelector(".edit-hint-ro")?.getAttribute("title")).toBe("Solo lectura: un join");
    expect(btn("Más acciones")).toBeUndefined();
  });

  it("says nothing for a query result with nothing to say", () => {
    mount({ isTable: false, editable: false, readOnlyReason: null });
    expect(host!.querySelector(".edit-hint-ro")).toBeNull();
  });

  it("adds a row, which the workspace turns into an edit session", () => {
    const p = mount();
    btn("Fila")!.click();
    expect(p.onAddRow).toHaveBeenCalledTimes(1);
  });

  it("leads with Guardar (n) and Descartar while editing", () => {
    const p = mount({ editing: true, hasChanges: true, changeCount: 3, editHint: "pista" });
    const save = btn("Guardar (3)")!;
    expect(save.classList.contains("edit-btn-primary")).toBe(true);
    save.click();
    btn("Descartar")!.click();
    expect(p.onConfirm).toHaveBeenCalledTimes(1);
    expect(p.onDiscard).toHaveBeenCalledTimes(1);
    expect(host!.querySelector(".edit-hint")).toBeNull();
  });

  it("disables Guardar without pending changes and both while busy", () => {
    mount({ editing: true, hasChanges: false, changeCount: 0 });
    expect(btn("Guardar (0)")!.disabled).toBe(true);
    dispose?.();
    host?.remove();
    mount({ editing: true, busy: true, hasChanges: true, changeCount: 1 });
    expect(btn("Guardar (1)")!.disabled).toBe(true);
    expect(btn("Descartar")!.disabled).toBe(true);
  });

  it("disables Guardar with the reason while the connection is lost (R-05)", () => {
    mount({ editing: true, hasChanges: true, changeCount: 1, saveBlocked: "Guardar necesita la conexión" });
    expect(btn("Guardar (1)")!.disabled).toBe(true);
    expect(btn("Guardar (1)")!.title).toBe("Guardar necesita la conexión");
    expect(btn("Descartar")!.disabled).toBe(false);
  });

  it("toggles the page search and the filter panel, saying whether each is open", () => {
    const onSearch = vi.fn();
    const onFilter = vi.fn();
    mount({ onSearch, searchOpen: true, onFilter, filterOpen: false });
    expect(btn("Buscar en la página")!.getAttribute("aria-pressed")).toBe("true");
    expect(btn("Filtrar")!.getAttribute("aria-pressed")).toBe("false");
    btn("Buscar en la página")!.click();
    btn("Filtrar")!.click();
    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onFilter).toHaveBeenCalledTimes(1);
  });

  it("offers no Filtrar outside a data tab", () => {
    mount();
    expect(btn("Filtrar")).toBeUndefined();
  });

  it("switches between Datos, Estructura, Índices and DDL", () => {
    const onView = vi.fn();
    mount({ onView });
    expect(btn("Datos")!.getAttribute("aria-selected")).toBe("true");
    btn("Datos")!.click();
    expect(onView).not.toHaveBeenCalled();
    btn("Índices")!.click();
    btn("DDL")!.click();
    expect(onView.mock.calls).toEqual([["indexes"], ["ddl"]]);
  });

  it("charts and opens the Exportar menu with one entry per format", () => {
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

  it("hides the result tools for a result without columns", () => {
    mount({ isTable: false, hasColumns: false });
    expect(btn("Graficar")).toBeUndefined();
    expect(btn("Exportar")).toBeUndefined();
    expect(btn("Buscar en la página")).toBeUndefined();
  });

  it("surfaces the edit-session error", () => {
    mount({ error: "rollback failed" });
    expect(host!.querySelector(".edit-error")?.textContent).toBe("rollback failed");
  });

  it("refreshes what the tab is showing (issue #448)", () => {
    const p = mount();
    btn("Refrescar")!.click();
    expect(p.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("keeps the refresh visible but disabled, carrying its reason", () => {
    const p = mount({ refreshBlocked: "Hay cambios sin guardar" });
    const refresh = btn("Refrescar")!;
    expect(refresh.disabled).toBe(true);
    expect(refresh.title).toBe("Hay cambios sin guardar");
    refresh.click();
    expect(p.onRefresh).not.toHaveBeenCalled();
  });

  it("offers the refresh even for a result that is not a table", () => {
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
  it("says why, with no row, Import or Generate", () => {
    mount({ editable: false, readOnly: true });
    expect(host!.querySelector(".edit-hint-ro")?.textContent?.trim()).toBe(
      "Solo lectura: la conexión está protegida.",
    );
    expect(btn("Fila")).toBeUndefined();
    const more = moreLabels();
    expect(more).not.toContain("Importar");
    expect(more).not.toContain("Generar datos");
    expect(btn("Exportar")).toBeDefined(); // reading out is still fine
  });
});
