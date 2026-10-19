import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { EditorToolbar } from "../../src/components/EditorToolbar";
import { contextMenu, closeContextMenu } from "../../src/utils/contextMenu";
import type { RunInfo } from "../../src/utils/runScope";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  closeContextMenu();
});

const INFO: RunInfo = { hasSelection: false, statement: { first: 2, last: 5 }, statements: 2 };

function mount(over: Partial<Parameters<typeof EditorToolbar>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const props = {
    conn: { name: "Ventas", color: "#2f7dd6", db: "main" },
    connItems: () => [{ label: "Producción", action: () => {} }],
    info: INFO,
    running: false,
    isMac: false,
    onRun: vi.fn(),
    onStop: vi.fn(),
    onFormat: vi.fn(),
    moreItems: () => [{ label: "Plan", action: () => {} }],
    ...over,
  };
  createRoot((d) => {
    dispose = d;
    render(() => <EditorToolbar {...props} />, host!);
  });
  return props;
}

const button = (name: string | RegExp) =>
  [...host!.querySelectorAll("button")].find((b) => {
    const label = b.getAttribute("aria-label") ?? b.textContent!.trim();
    return typeof name === "string" ? label === name : name.test(label);
  })!;

describe("EditorToolbar", () => {
  it("names the toolbar and leads with the tab's connection and database", () => {
    mount();
    expect(host!.querySelector('[role="toolbar"]')!.getAttribute("aria-label")).toBe("Ejecución de la consulta");
    const conn = host!.querySelector(".editor-conn")!;
    expect(conn.getAttribute("aria-label")).toBe("Conexión de esta pestaña: Ventas, base main");
    expect(conn.textContent).toContain("Ventas");
    expect(conn.textContent).toContain("main");
  });

  it("says so when the tab has no connection", () => {
    mount({ conn: null });
    expect(host!.querySelector(".editor-conn")!.textContent).toContain("Sin conexión");
  });

  it("opens the connection menu the workspace built", () => {
    mount();
    (host!.querySelector(".editor-conn") as HTMLButtonElement).click();
    expect(contextMenu()!.items.map((i) => i.label)).toEqual(["Producción"]);
  });

  it("names the statement on the run button, or the selection when there is one", () => {
    const p = mount();
    const run = button("Ejecutar sentencia");
    expect(run).toBeDefined();
    run.click();
    expect(p.onRun).toHaveBeenCalledWith();
    dispose?.();
    host?.remove();
    mount({ info: { ...INFO, hasSelection: true } });
    expect(button("Ejecutar selección")).toBeDefined();
  });

  it("offers the three scopes with what each covers, and runs the one chosen", () => {
    const p = mount();
    button("Qué ejecutar: sentencia actual, selección o script completo").click();
    const items = contextMenu()!.items;
    expect(items.map((i) => i.label)).toEqual(["Sentencia actual", "Selección", "Script completo"]);
    expect(items[0].hint).toBe("líneas 2–5 · Ctrl+Enter");
    expect(items[1]).toMatchObject({ disabled: true, hint: "no hay texto seleccionado" });
    expect(items[2].hint).toBe("2 sentencias · Ctrl+Shift+Enter");
    items[2].action!();
    expect(p.onRun).toHaveBeenCalledWith("document");
  });

  it("keeps Detener in place but disabled while nothing runs", () => {
    const p = mount();
    const stop = button("Detener (no hay nada en ejecución)");
    expect(stop.disabled).toBe(true);
    stop.click();
    expect(p.onStop).not.toHaveBeenCalled();
  });

  it("while running: Detener acts and Ejecutar waits", () => {
    const p = mount({ running: true });
    const stop = button("Detener");
    expect(stop.disabled).toBe(false);
    expect(stop.classList.contains("is-running")).toBe(true);
    stop.click();
    expect(p.onStop).toHaveBeenCalled();
    expect(button("Ejecutar sentencia").disabled).toBe(true);
  });

  it("explains a query that cannot be stopped", () => {
    mount({ running: true, stopBlocked: "Este motor no permite cancelar" });
    const stop = button("Detener");
    expect(stop.disabled).toBe(true);
    expect(stop.title).toBe("Este motor no permite cancelar");
  });

  it("formats, and keeps the rest under Más", () => {
    const p = mount();
    button(/^Formatear/).click();
    expect(p.onFormat).toHaveBeenCalled();
    button(/^Más:/).click();
    expect(contextMenu()!.items.map((i) => i.label)).toEqual(["Plan"]);
  });
});
