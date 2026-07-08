import { describe, it, expect, vi, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { AppToolbar } from "../../src/components/AppToolbar";
import { TOOL_CATALOG } from "../../src/utils/toolCatalog";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(over: Partial<Parameters<typeof AppToolbar>[0]> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const props = {
    active: true,
    hasDb: true,
    onNewQuery: vi.fn(),
    onNewTable: vi.fn(),
    onObjectList: vi.fn(),
    onOpenTool: vi.fn(),
    ...over,
  };
  createRoot((d) => {
    dispose = d;
    render(() => <AppToolbar {...props} />, host!);
  });
  return props;
}

const btn = (label: string) =>
  [...host!.querySelectorAll(".att-btn")].find((b) =>
    b.querySelector(".att-lb")?.textContent === label,
  ) as HTMLButtonElement | undefined;

describe("AppToolbar", () => {
  it("renders object actions + every tool from the catalog", () => {
    mount();
    expect(btn("Consulta")).toBeTruthy();
    expect(btn("Tabla")).toBeTruthy();
    for (const t of TOOL_CATALOG) expect(btn(t.label)).toBeTruthy();
  });

  it("fires the object handlers", () => {
    const p = mount();
    btn("Consulta")!.click();
    btn("Tabla")!.click();
    btn("Objetos")!.click();
    expect(p.onNewQuery).toHaveBeenCalledTimes(1);
    expect(p.onNewTable).toHaveBeenCalledTimes(1);
    expect(p.onObjectList).toHaveBeenCalledTimes(1);
  });

  it("disables the object list until a working database is selected", () => {
    mount({ hasDb: false });
    expect(btn("Objetos")!.disabled).toBe(true);
  });

  it("opens a tool with its catalog entry", () => {
    const p = mount();
    btn(TOOL_CATALOG[0].label)!.click();
    expect(p.onOpenTool).toHaveBeenCalledWith(TOOL_CATALOG[0]);
  });

  it("disables actions when no connection is active", () => {
    mount({ active: false });
    expect(btn("Consulta")!.disabled).toBe(true);
    expect(btn("Tabla")!.disabled).toBe(true);
    expect(btn(TOOL_CATALOG[0].label)!.disabled).toBe(true);
  });
});
