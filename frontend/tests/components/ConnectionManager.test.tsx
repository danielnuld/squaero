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

function mount(activeConnId: string | null, cbs: Partial<Record<string, () => void>> = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const onDisconnect = cbs.onDisconnect ?? vi.fn();
  const onReconnect = cbs.onReconnect ?? vi.fn();
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ConnectionManager
          connections={conns}
          activeConnId={activeConnId}
          connectingId={null}
          onConnect={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
          onNew={() => {}}
          onDisconnect={onDisconnect}
          onReconnect={onReconnect}
        />
      ),
      host!,
    );
  });
  return { onDisconnect, onReconnect };
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
});
