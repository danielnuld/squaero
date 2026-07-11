import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
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

function mount(
  activeConnId: string | null,
  onConnect = vi.fn(),
  extra: { openIds?: string[]; onDisconnect?: (id?: string) => void } = {},
) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ConnectionBar
          connections={conns}
          activeConnId={activeConnId}
          openIds={extra.openIds}
          connectingId={null}
          onConnect={onConnect}
          onEdit={() => {}}
          onDelete={() => {}}
          onNew={() => {}}
          onDisconnect={extra.onDisconnect ?? (() => {})}
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

  it("shows a disconnect button on the bar only when the active connection is open", () => {
    mount("a"); // active but not in openIds
    expect(host!.querySelector(".connbar-disconnect")).toBeNull();
    dispose?.();
    host?.remove();
    mount("a", vi.fn(), { openIds: ["a"] });
    expect(host!.querySelector(".connbar-disconnect")).not.toBeNull();
  });

  it("disconnects the focused connection from the bar without opening the popover", () => {
    const onDisconnect = vi.fn();
    mount("a", vi.fn(), { openIds: ["a"], onDisconnect });
    host!.querySelector<HTMLButtonElement>(".connbar-disconnect")!.click();
    expect(onDisconnect).toHaveBeenCalledWith("a");
    // The click must not have toggled the manager popover open.
    expect(host!.querySelector(".connbar-drop")).toBeNull();
  });

  // Regression: the popover forwarded props via `{...props}`, which SNAPSHOTS the
  // connection list at mount — so a connection added afterwards never showed
  // until an app restart. mergeProps keeps it reactive.
  it("reflects a connection added AFTER mount while the popover is open", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const [list, setList] = createSignal<Connection[]>([conns[0]]); // just "Prod"
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <ConnectionBar
            connections={list()}
            activeConnId={null}
            connectingId={null}
            onConnect={() => {}}
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
    bar().click(); // open the popover
    expect(host!.querySelector(".connbar-drop")!.textContent).toContain("Prod");
    expect(host!.querySelector(".connbar-drop")!.textContent).not.toContain("Reportes");
    // Add a connection after mount, exactly as onSaveConnection does.
    setList([conns[0], { id: "c", name: "Reportes", driver: "postgres", params: {} }]);
    expect(host!.querySelector(".connbar-drop")!.textContent).toContain("Reportes");
  });

  it("reopens the popover on an openTick bump (so a saved connection is visible)", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const [list, setList] = createSignal<Connection[]>([]);
    const [tick, setTick] = createSignal(0);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <ConnectionBar
            connections={list()}
            openTick={tick()}
            activeConnId={null}
            connectingId={null}
            onConnect={() => {}}
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
    // Popover starts closed.
    expect(host!.querySelector(".connbar-drop")).toBeNull();
    // Save flow: a connection is added and the app bumps openTick.
    setList([{ id: "c", name: "Reportes", driver: "postgres", params: {} }]);
    setTick(1);
    const drop = host!.querySelector(".connbar-drop");
    expect(drop).not.toBeNull();
    expect(drop!.textContent).toContain("Reportes");
  });
});
