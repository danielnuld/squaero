import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { ConnectionBar } from "../../src/components/ConnectionBar";
import type { Connection } from "../../src/utils/connections";

// The explorer's head (#525, #689): its title, the + that searches the saved
// connections, and with nothing open an empty state that lists them. The open
// connections are rows at the top of their trees (ObjectTreeConnRow.test.tsx).

const conns: Connection[] = [
  { id: "a", name: "Prod", driver: "mysql", params: {}, color: "#e5484d" },
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
  over: { connections?: Connection[]; openIds?: string[]; connectingId?: string | null } = {},
) {
  const handlers = {
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
          openIds={over.openIds ?? []}
          connectingId={over.connectingId ?? null}
          {...handlers}
        />
      ),
      host!,
    );
  });
  return handlers;
}

const button = (name: RegExp | string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => {
    const label = b.getAttribute("aria-label") ?? b.title ?? b.textContent ?? "";
    return typeof name === "string" ? label === name : name.test(label);
  })!;

describe("ConnectionBar with nothing open", () => {
  it("says so in sentence case and offers to connect", () => {
    mount();
    expect(host!.querySelector(".explorer-title")?.textContent).toBe("Explorador");
    expect(host!.textContent).toContain("Sin conexión");
    expect(host!.textContent).toContain("No hay ninguna conexión abierta");
    // Its own wording: two buttons named the same would be ambiguous.
    expect(host!.querySelector(".connbar-empty-link")!.textContent).toBe(
      "Elegir una conexión guardada…",
    );
    expect(
      [...host!.querySelectorAll("button")].filter(
        (b) => (b.getAttribute("aria-label") ?? b.textContent) === "Conectar a una base de datos…",
      ),
    ).toHaveLength(1);
    // The search is not rendered until asked for.
    expect(host!.querySelector(".connbar-drop")).toBeNull();
  });

  it("opens the search from the empty state", () => {
    mount();
    host!.querySelector<HTMLButtonElement>(".connbar-empty-link")!.click();
    expect(host!.querySelector(".connsearch")).not.toBeNull();
  });

  it("lists the saved connections, each opened with one click", () => {
    const { onPick } = mount();
    const rows = [...host!.querySelectorAll<HTMLButtonElement>(".explorer-saved-row")];
    expect(rows.map((r) => r.querySelector(".connbar-name")?.textContent)).toEqual(["Prod", "Local"]);
    expect(rows[0].textContent).toContain("MY");
    // The colour rides the row, and a connection without one shows none.
    expect(rows[0].style.getPropertyValue("--conn-accent")).toBe("#e5484d");
    expect(rows[1].getAttribute("style")).toBeNull();
    rows[1].click();
    expect(onPick).toHaveBeenCalledWith(conns[1]);
  });

  it("keeps the saved rows still while a connection is being opened", () => {
    mount({ connectingId: "a" });
    expect(host!.querySelector<HTMLButtonElement>(".explorer-saved-row")!.disabled).toBe(true);
  });

  it("shows no saved list when there is none", () => {
    mount({ connections: [] });
    expect(host!.querySelector(".explorer-saved")).toBeNull();
  });
});

describe("ConnectionBar with a connection open", () => {
  it("drops the empty state: the open ones are rows in the tree", () => {
    mount({ openIds: ["a"] });
    expect(host!.textContent).not.toContain("Sin conexión");
    expect(host!.querySelector(".explorer-saved")).toBeNull();
  });
});

describe("ConnectionBar search", () => {
  it("toggles the search on the + button", () => {
    mount({ openIds: ["a"] });
    const add = button("Conectar a una base de datos…");
    add.click();
    const drop = host!.querySelector(".connbar-drop")!;
    expect(drop.querySelector(".connsearch")).not.toBeNull();
    expect(drop.textContent).toContain("Prod");
    expect(drop.textContent).toContain("Local");
    add.click();
    expect(host!.querySelector(".connbar-drop")).toBeNull();
  });

  it("opens the picked connection and closes the search", () => {
    const { onPick } = mount();
    button("Conectar a una base de datos…").click();
    host!.querySelector<HTMLButtonElement>(".connsearch-hit")!.click();
    expect(onPick).toHaveBeenCalledOnce();
    expect(host!.querySelector(".connbar-drop")).toBeNull();
  });

  // Reported after v0.27.0: it was drawn as a panel wedged into the sidebar,
  // stretched to its 280px. The prototype's is a 360px balloon, which the
  // sidebar would clip (overflow:hidden, for the virtualized tree), so it hangs
  // off the viewport and has to be told where the bar is.
  it("hangs as a balloon positioned against the viewport, not inside the sidebar", () => {
    mount({ openIds: ["a"] });
    button("Conectar a una base de datos…").click();
    const drop = host!.querySelector<HTMLElement>(".connbar-drop")!;
    expect(drop.style.top).not.toBe("");
    expect(drop.style.left).not.toBe("");
  });

  it("says which of the saved ones are already open", () => {
    mount({ openIds: ["a"] });
    button("Conectar a una base de datos…").click();
    const open = host!.querySelectorAll(".connsearch-open");
    expect(open).toHaveLength(1);
    expect(host!.querySelectorAll(".connsearch-hit")[0].textContent).toContain("Abierta");
  });

  it("sends the footer's actions out and closes behind them", () => {
    const { onNew, onManage } = mount();
    button("Conectar a una base de datos…").click();
    host!.querySelector<HTMLButtonElement>(".connsearch-foot button")!.click();
    expect(onNew).toHaveBeenCalledOnce();
    expect(host!.querySelector(".connbar-drop")).toBeNull();

    button("Conectar a una base de datos…").click();
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
            openIds={[]}
            connectingId={null}
            onPick={() => {}}
            onNew={() => {}}
            onImport={() => {}}
            onManage={() => {}}
          />
        ),
        host!,
      );
    });
    button("Conectar a una base de datos…").click();
    expect(host!.querySelector(".connbar-drop")!.textContent).toContain("Prod");
    expect(host!.querySelector(".connbar-drop")!.textContent).not.toContain("Reportes");
    setList([conns[0], { id: "c", name: "Reportes", driver: "postgres", params: {} }]);
    expect(host!.querySelector(".connbar-drop")!.textContent).toContain("Reportes");
  });
});
