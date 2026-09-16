import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { PendingRowsBar } from "../../src/components/PendingRowsBar";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

type Props = Parameters<typeof PendingRowsBar>[0];

function mount(over: Partial<Props> = {}) {
  const handlers = {
    onTogglePk: vi.fn(),
    onToggleEmptyAsNull: vi.fn(),
    onReview: vi.fn(),
    onDiscard: vi.fn(),
    onImport: vi.fn(),
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <PendingRowsBar
          count={2}
          conflicts={0}
          pkMode={null}
          emptyAsNull={null}
          ignoredColumns={[]}
          busy={false}
          canImport={false}
          {...handlers}
          {...over}
        />
      ),
      host!,
    );
  });
  const button = (name: RegExp) =>
    [...host!.querySelectorAll("button")].find((b) => name.test(b.textContent ?? ""));
  return { handlers, button };
}

describe("PendingRowsBar", () => {
  it("counts the new rows and reviews them before saving", () => {
    const { handlers, button } = mount();
    expect(host!.querySelector('[role="toolbar"]')!.getAttribute("aria-label")).toBe(
      "Filas nuevas sin guardar",
    );
    expect(host!.textContent).toContain("2 filas nuevas sin guardar");
    button(/Revisar y guardar/)!.click();
    button(/^Descartar$/)!.click();
    expect(handlers.onReview).toHaveBeenCalledOnce();
    expect(handlers.onDiscard).toHaveBeenCalledOnce();
  });

  it("says one row in the singular", () => {
    mount({ count: 1 });
    expect(host!.textContent).toContain("1 fila nueva sin guardar");
  });

  it("blocks saving with the reason while rows collide", () => {
    const { button } = mount({ conflicts: 1 });
    expect(host!.textContent).toContain("1 choca con un valor que ya existe");
    const save = button(/Revisar y guardar/)!;
    expect(save.disabled).toBe(true);
    expect(save.title).toBe("Corrige las celdas marcadas en rojo antes de guardar");
  });

  it("counts several collisions", () => {
    mount({ conflicts: 3 });
    expect(host!.textContent).toContain("3 chocan con valores que ya existen");
  });

  it("offers no key or empty-cell choice for rows added by hand", () => {
    const { button } = mount();
    expect(button(/^Clave/)).toBeUndefined();
    expect(button(/^Vacías/)).toBeUndefined();
    expect(button(/asistente/)).toBeUndefined();
  });

  it("switches the key mode of a paste", () => {
    const { handlers, button } = mount({ pkMode: "generate" });
    const key = button(/^Clave: la genera la base$/)!;
    expect(key.getAttribute("aria-pressed")).toBe("false");
    key.click();
    expect(handlers.onTogglePk).toHaveBeenCalledOnce();
  });

  it("shows a kept key as pressed", () => {
    const { button } = mount({ pkMode: "keep" });
    expect(button(/^Clave: conservar la copiada$/)!.getAttribute("aria-pressed")).toBe("true");
  });

  it("switches how pasted text's empty cells are read", () => {
    const { handlers, button } = mount({ emptyAsNull: true });
    button(/^Vacías como NULL$/)!.click();
    expect(handlers.onToggleEmptyAsNull).toHaveBeenCalledOnce();
  });

  it("names the copied columns the table does not have", () => {
    mount({ ignoredColumns: ["ciudad", "rfc"] });
    expect(host!.textContent).toContain("No existen en esta tabla: ciudad, rfc");
  });

  it("hands the paste to the wizard when it can", () => {
    const { handlers, button } = mount({ canImport: true });
    button(/Importar con el asistente/)!.click();
    expect(handlers.onImport).toHaveBeenCalledOnce();
  });

  it("disables its actions while the session is busy", () => {
    const { button } = mount({ busy: true, canImport: true });
    expect(button(/Revisar y guardar/)!.disabled).toBe(true);
    expect(button(/^Descartar$/)!.disabled).toBe(true);
    expect(button(/asistente/)!.disabled).toBe(true);
  });
});
