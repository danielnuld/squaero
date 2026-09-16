import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { ConnectionBar, type OpenConnRow } from "../../src/components/ConnectionBar";
import type { Connection } from "../../src/utils/connections";

// The bar lists the open connections and focuses one with a click (#525).
// Opening another one goes through the search behind the +; creating, editing
// and importing belong to the connections tab, which the search links to.

const conns: Connection[] = [
  { id: "a", name: "Prod", driver: "mysql", params: {} },
  { id: "b", name: "Local", driver: "sqlite", params: {} },
];

const row = (over: Partial<OpenConnRow> & { defId: string; name: string }): OpenConnRow => ({
  driver: "mysql",
  sub: "MySQL / MariaDB · ventas @ 10.0.4.12:3306",
  ...over,
});

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mount(
  over: {
    connections?: Connection[];
    open?: OpenConnRow[];
    focusedDefId?: string | null;
    connectingId?: string | null;
  } = {},
) {
  const handlers = {
    onFocus: vi.fn(),
    onDisconnect: vi.fn(),
    onReconnectConn: vi.fn(),
    onPick: vi.fn(),
    onNew: vi.fn(),
    onImport: vi.fn(),
    onManage: vi.fn(),
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ConnectionBar
          connections={over.connections ?? conns}
          open={over.open ?? []}
          focusedDefId={over.focusedDefId ?? null}
          connectingId={over.connectingId ?? null}
          {...handlers}
        />
      ),
      host!,
    );
  });
  return handlers;
}

const rows = () => [...host!.querySelectorAll<HTMLElement>(".connbar-item")];
const button = (name: RegExp | string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => {
    const label = b.getAttribute("aria-label") ?? b.title ?? b.textContent ?? "";
    return typeof name === "string" ? label === name : name.test(label);
  })!;

describe("ConnectionBar rows", () => {
  it("draws one row per open connection, with its engine and target", () => {
    mount({ open: [row({ defId: "a", name: "Prod" }), row({ defId: "b", name: "Local", driver: "sqlite", sub: "SQLite · C:/datos/notas.db" })] });
    expect(rows()).toHaveLength(2);
    expect(rows()[0].textContent).toContain("Prod");
    expect(rows()[0].textContent).toContain("MY"); // monogram
    expect(rows()[0].textContent).toContain("ventas @ 10.0.4.12:3306");
    expect(rows()[1].textContent).toContain("SQ");
    expect(host!.querySelector(".connbar-list")!.getAttribute("aria-label")).toBe(
      "Conexiones abiertas",
    );
  });

  it("counts what is open", () => {
    mount({ open: [row({ defId: "a", name: "Prod" })] });
    expect(host!.textContent).toContain("1 abierta");
    dispose?.();
    host?.remove();
    mount({ open: [row({ defId: "a", name: "Prod" }), row({ defId: "b", name: "Local" })] });
    expect(host!.textContent).toContain("2 abiertas");
  });

  it("marks the focused row for the eye and for assistive tech", () => {
    mount({ open: [row({ defId: "a", name: "Prod" }), row({ defId: "b", name: "Local" })], focusedDefId: "b" });
    expect(rows()[0].classList.contains("is-focused")).toBe(false);
    expect(rows()[1].classList.contains("is-focused")).toBe(true);
    const picks = host!.querySelectorAll<HTMLButtonElement>(".connbar-pick");
    expect(picks[0].getAttribute("aria-current")).toBeNull();
    expect(picks[1].getAttribute("aria-current")).toBe("true");
  });

  it("focuses a connection on click, without opening or closing anything", () => {
    const { onFocus, onPick, onDisconnect } = mount({
      open: [row({ defId: "a", name: "Prod" }), row({ defId: "b", name: "Local" })],
      focusedDefId: "a",
    });
    host!.querySelectorAll<HTMLButtonElement>(".connbar-pick")[1].click();
    expect(onFocus).toHaveBeenCalledWith("b");
    expect(onPick).not.toHaveBeenCalled();
    expect(onDisconnect).not.toHaveBeenCalled();
  });

  it("disconnects the row it belongs to, named so three of them are not the same button", () => {
    const { onDisconnect } = mount({
      open: [row({ defId: "a", name: "Prod" }), row({ defId: "b", name: "Local" })],
    });
    button("Desconectar Local").click();
    expect(onDisconnect).toHaveBeenCalledWith("b");
  });

  it("shows a row without colour without shifting the rest", () => {
    mount({ open: [row({ defId: "a", name: "Prod" })] });
    const accent = host!.querySelector<HTMLElement>(".connbar-accent")!;
    expect(accent.style.background).toBe("");
    dispose?.();
    host?.remove();
    mount({ open: [row({ defId: "a", name: "Prod", color: "#e5484d" })] });
    expect(host!.querySelector<HTMLElement>(".connbar-accent")!.style.background).not.toBe("");
  });

  it("says a lost session is lost and offers to reconnect it (issue #407)", () => {
    const { onReconnectConn } = mount({ open: [row({ defId: "a", name: "Prod", lost: true })] });
    expect(host!.textContent).toContain("desconectada");
    button("Reconectar").click();
    expect(onReconnectConn).toHaveBeenCalledWith("a");
  });

  it("marks a live session and offers no reconnect", () => {
    mount({ open: [row({ defId: "a", name: "Prod" })] });
    expect(host!.querySelector(".conn-live")).not.toBeNull();
    expect(host!.textContent).not.toContain("desconectada");
  });

  it("disables the row actions while a connection is being opened", () => {
    mount({ open: [row({ defId: "a", name: "Prod", lost: true })], connectingId: "b" });
    expect(button("Reconectar").disabled).toBe(true);
    expect(button("Desconectar Prod").disabled).toBe(true);
  });
});

describe("ConnectionBar with nothing open", () => {
  it("says so and offers to connect", () => {
    mount({ open: [] });
    expect(host!.querySelector(".connbar-list")).toBeNull();
    expect(host!.textContent).toContain("No hay ninguna conexión abierta");
    expect(host!.textContent).toContain("Ninguna abierta");
    // Its own wording: two buttons named the same would be ambiguous.
    expect(host!.querySelector(".connbar-empty-link")!.textContent).toBe(
      "Elegir una conexión guardada…",
    );
    expect(
      [...host!.querySelectorAll("button")].filter(
        (b) => (b.getAttribute("aria-label") ?? b.textContent) === "Conectar a una base…",
      ),
    ).toHaveLength(1);
    // The search is not rendered until asked for.
    expect(host!.querySelector(".connbar-drop")).toBeNull();
  });

  it("opens the search from the empty state", () => {
    mount({ open: [] });
    host!.querySelector<HTMLButtonElement>(".connbar-empty-link")!.click();
    expect(host!.querySelector(".connsearch")).not.toBeNull();
  });
});

describe("ConnectionBar search", () => {
  it("toggles the search on the + button", () => {
    mount({ open: [row({ defId: "a", name: "Prod" })] });
    const add = button("Conectar a una base…");
    add.click();
    const drop = host!.querySelector(".connbar-drop")!;
    expect(drop.querySelector(".connsearch")).not.toBeNull();
    expect(drop.textContent).toContain("Prod");
    expect(drop.textContent).toContain("Local");
    add.click();
    expect(host!.querySelector(".connbar-drop")).toBeNull();
  });

  it("opens the picked connection and closes the search", () => {
    const { onPick } = mount({ open: [] });
    button("Conectar a una base…").click();
    host!.querySelector<HTMLButtonElement>(".connsearch-hit")!.click();
    expect(onPick).toHaveBeenCalledOnce();
    expect(host!.querySelector(".connbar-drop")).toBeNull();
  });

  it("says which of the saved ones are already open", () => {
    mount({ open: [row({ defId: "a", name: "Prod" })] });
    button("Conectar a una base…").click();
    const open = host!.querySelectorAll(".connsearch-open");
    expect(open).toHaveLength(1);
    expect(host!.querySelectorAll(".connsearch-hit")[0].textContent).toContain("Abierta");
  });

  it("sends the footer's actions out and closes behind them", () => {
    const { onNew, onManage } = mount({ open: [] });
    button("Conectar a una base…").click();
    host!.querySelector<HTMLButtonElement>(".connsearch-foot button")!.click();
    expect(onNew).toHaveBeenCalledOnce();
    expect(host!.querySelector(".connbar-drop")).toBeNull();

    button("Conectar a una base…").click();
    [...host!.querySelectorAll<HTMLButtonElement>(".connsearch-foot button")].at(-1)!.click();
    expect(onManage).toHaveBeenCalledOnce();
    expect(host!.querySelector(".connbar-drop")).toBeNull();
  });

  // Regression: the popover used to forward props via `{...props}`, which
  // SNAPSHOTS the connection list at mount — a connection added afterwards never
  // showed until an app restart.
  it("reflects a connection added AFTER mount while the search is open", () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    const [list, setList] = createSignal<Connection[]>([conns[0]]);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <ConnectionBar
            connections={list()}
            open={[]}
            focusedDefId={null}
            connectingId={null}
            onFocus={() => {}}
            onReconnectConn={() => {}}
            onPick={() => {}}
            onNew={() => {}}
            onDisconnect={() => {}}
            onImport={() => {}}
            onManage={() => {}}
          />
        ),
        host!,
      );
    });
    button("Conectar a una base…").click();
    expect(host!.querySelector(".connbar-drop")!.textContent).toContain("Prod");
    expect(host!.querySelector(".connbar-drop")!.textContent).not.toContain("Reportes");
    setList([conns[0], { id: "c", name: "Reportes", driver: "postgres", params: {} }]);
    expect(host!.querySelector(".connbar-drop")!.textContent).toContain("Reportes");
  });
});
