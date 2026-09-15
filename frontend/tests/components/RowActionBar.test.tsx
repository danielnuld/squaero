import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { RowActionBar } from "../../src/components/RowActionBar";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(over: Partial<Parameters<typeof RowActionBar>[0]> = {}) {
  const handlers = {
    onCopy: vi.fn(),
    onCopyInsert: vi.fn(),
    onDuplicate: vi.fn(),
    onPaste: vi.fn(),
    onClear: vi.fn(),
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <RowActionBar count={1} pasteCount={0} addBlocked={null} {...handlers} {...over} />
      ),
      host!,
    );
  });
  const button = (name: RegExp) =>
    [...host!.querySelectorAll("button")].find((b) =>
      name.test(b.getAttribute("aria-label") ?? b.textContent ?? ""),
    )!;
  return { handlers, button };
}

describe("RowActionBar", () => {
  it("is a named toolbar that counts one marked row", () => {
    mount();
    const bar = host!.querySelector('[role="toolbar"]')!;
    expect(bar.getAttribute("aria-label")).toBe("Acciones sobre las filas marcadas");
    expect(bar.textContent).toContain("1 fila marcada");
  });

  it("counts several marked rows", () => {
    mount({ count: 3 });
    expect(host!.textContent).toContain("3 filas marcadas");
  });

  it("runs copy, copy as INSERT, duplicate and unmark", () => {
    const { handlers, button } = mount();
    button(/^Copiar Ctrl\+C/).click();
    button(/Copiar como INSERT/).click();
    button(/^Duplicar/).click();
    button(/Desmarcar/).click();
    expect(handlers.onCopy).toHaveBeenCalledOnce();
    expect(handlers.onCopyInsert).toHaveBeenCalledOnce();
    expect(handlers.onDuplicate).toHaveBeenCalledOnce();
    expect(handlers.onClear).toHaveBeenCalledOnce();
  });

  it("disables paste with the reason when nothing has been copied", () => {
    const { button } = mount({ pasteCount: 0 });
    const paste = button(/^Pegar/);
    expect(paste.disabled).toBe(true);
    expect(paste.title).toBe("Todavía no has copiado filas");
  });

  it("offers to paste the copied rows, saying how many", () => {
    const { handlers, button } = mount({ pasteCount: 2 });
    const paste = button(/^Pegar 2$/);
    expect(paste.disabled).toBe(false);
    paste.click();
    expect(handlers.onPaste).toHaveBeenCalledOnce();
  });

  it("disables duplicate and paste with the table's reason when it cannot take rows", () => {
    const reason = "Duplicar: la tabla no tiene clave primaria";
    const { button } = mount({ pasteCount: 2, addBlocked: reason });
    expect(button(/^Duplicar/).disabled).toBe(true);
    expect(button(/^Duplicar/).title).toBe(reason);
    expect(button(/^Pegar/).disabled).toBe(true);
    expect(button(/^Pegar/).title).toBe(reason);
    // Copying never depends on being able to write.
    expect(button(/^Copiar Ctrl\+C/).disabled).toBe(false);
  });
});
