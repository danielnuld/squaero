import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ConnectionManager } from "../../src/components/ConnectionManager";
import type { Connection } from "../../src/utils/connections";

// The active connection exposes Reconectar (↻) + Desconectar (⏏) actions; other
// connections do not. Both fire their callbacks.

const conns: Connection[] = [
  { id: "a", name: "Prod", driver: "mysql", params: {} },
  { id: "b", name: "Local", driver: "sqlite", params: {} },
];

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(
  activeConnId: string | null,
  cbs: {
    onDisconnect?: () => void;
    onReconnect?: () => void;
    onExport?: (p: boolean) => void;
    onImport?: (f: File) => Promise<string>;
  } = {},
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const onDisconnect = cbs.onDisconnect ?? vi.fn();
  const onReconnect = cbs.onReconnect ?? vi.fn();
  const onExport = cbs.onExport ?? vi.fn();
  const onImport = cbs.onImport ?? vi.fn(async () => "");
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ConnectionManager
          connections={conns}
          activeConnId={activeConnId}
          openIds={activeConnId ? [activeConnId] : []}
          connectingId={null}
          onConnect={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
          onNew={() => {}}
          onDisconnect={onDisconnect}
          onReconnect={onReconnect}
          onExport={onExport}
          onImport={onImport}
        />
      ),
      host!,
    );
  });
  return { onDisconnect, onReconnect, onExport, onImport };
}

const btn = (title: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.title === title) ?? null;

describe("ConnectionManager", () => {
  it("shows Reconectar + Desconectar only for the active connection", () => {
    mount(null);
    expect(btn("Reconectar")).toBeNull();
    expect(btn("Desconectar")).toBeNull();

    dispose?.();
    mount("a");
    expect(btn("Reconectar")).not.toBeNull();
    expect(btn("Desconectar")).not.toBeNull();
  });

  it("fires onReconnect and onDisconnect", () => {
    const { onDisconnect, onReconnect } = mount("a");
    btn("Reconectar")!.click();
    btn("Desconectar")!.click();
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(onDisconnect).toHaveBeenCalledTimes(1);
  });

  const textBtn = (label: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);

  it("exports without passwords by default and only warns on opt-in (#188)", () => {
    const onExport = vi.fn();
    mount(null, { onExport });
    textBtn("⬆ Exportar")!.click(); // open the export options
    expect(host!.querySelector(".conn-warn")).toBeNull(); // no warning until opt-in
    const check = host!.querySelector<HTMLInputElement>(".conn-export-opt input")!;
    check.checked = true;
    check.dispatchEvent(new Event("change", { bubbles: true }));
    expect(host!.querySelector(".conn-warn")).not.toBeNull(); // plaintext warning shown
    textBtn("Exportar")!.click();
    expect(onExport).toHaveBeenCalledWith(true);
  });

  it("imports a file and shows the returned summary (#188)", async () => {
    const onImport = vi.fn(async () => "Añadidas 2 · actualizadas 0 · omitidas 1");
    mount(null, { onImport });
    const input = host!.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["{}"], "conns.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file] });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(onImport).toHaveBeenCalledWith(file);
    expect(host!.querySelector(".conn-import-msg")!.textContent).toContain("Añadidas 2");
  });
});
