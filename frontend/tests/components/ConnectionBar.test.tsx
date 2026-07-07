import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ConnectionBar } from "../../src/components/ConnectionBar";
import type { Connection } from "../../src/utils/connections";

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

function mount(activeConnId: string | null, onConnect = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ConnectionBar
          connections={conns}
          activeConnId={activeConnId}
          connectingId={null}
          onConnect={onConnect}
          onEdit={() => {}}
          onDelete={() => {}}
          onNew={() => {}}
          onDisconnect={() => {}}
          onReconnect={() => {}}
          onExport={() => {}}
          onImport={async () => ""}
        />
      ),
      host!,
    );
  });
  return { onConnect };
}

const bar = () => host!.querySelector<HTMLButtonElement>(".connbar-active")!;

describe("ConnectionBar", () => {
  it("prompts to pick a connection when none is active, and hides the list", () => {
    mount(null);
    expect(host!.textContent).toContain("Elegir conexión");
    // Collapsed: the manager popover is not rendered yet.
    expect(host!.querySelector(".connbar-drop")).toBeNull();
  });

  it("shows the active connection's name in the bar", () => {
    mount("a");
    expect(bar().textContent).toContain("Prod");
    expect(bar().textContent).toContain("conectado");
  });

  it("toggles the manager popover (with the connection list) on click", () => {
    mount(null);
    bar().click();
    const drop = host!.querySelector(".connbar-drop");
    expect(drop).not.toBeNull();
    expect(drop!.textContent).toContain("Prod");
    expect(drop!.textContent).toContain("Local");
    bar().click();
    expect(host!.querySelector(".connbar-drop")).toBeNull();
  });

  it("connects and closes the popover when a connection is clicked", () => {
    const { onConnect } = mount(null);
    bar().click();
    const open = host!.querySelector<HTMLButtonElement>(".conn-open")!;
    open.click();
    expect(onConnect).toHaveBeenCalledOnce();
    expect(host!.querySelector(".connbar-drop")).toBeNull();
  });
});
