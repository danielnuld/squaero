import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ObjectTree, type ConnRowState } from "../../src/components/ObjectTree";

// Each open connection is the row at the top of its own tree (issue #689):
// what the connection bar listed separately before, said once.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

const base: ConnRowState = {
  driver: "mysql",
  sub: "MySQL / MariaDB · ventas @ 10.0.4.12:3306",
  focused: false,
};

function mount(conn: Partial<ConnRowState> = {}, title = "Prod") {
  const h = {
    onFocusConn: vi.fn(),
    onReconnect: vi.fn(),
    onDisconnect: vi.fn(),
    onToggleCollapse: vi.fn(),
    onRefresh: vi.fn(),
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ObjectTree
          connId={null}
          title={title}
          conn={{ ...base, ...conn }}
          onOpenData={() => {}}
          onOpenStructure={() => {}}
          {...h}
        />
      ),
      host!,
    );
  });
  return h;
}

const row = () => host!.querySelector<HTMLElement>(".connbar-item")!;
const button = (label: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => (b.getAttribute("aria-label") ?? b.textContent?.trim()) === label,
  )!;

describe("ObjectTree connection row", () => {
  it("draws the engine, the name and where it points", () => {
    mount();
    expect(row().textContent).toContain("Prod");
    expect(row().textContent).toContain("MY");
    expect(row().textContent).toContain("ventas @ 10.0.4.12:3306");
  });

  it("marks a protected connection beside its name", () => {
    mount({ safeMode: "readOnly" });
    expect(row().querySelector(".safe-badge")?.getAttribute("aria-label")).toBe("Solo lectura");
  });

  it("marks the focused connection, and focuses it on click", () => {
    const h = mount({ focused: true });
    expect(row().classList.contains("is-focused")).toBe(true);
    const pick = row().querySelector<HTMLButtonElement>(".connbar-pick")!;
    expect(pick.getAttribute("aria-current")).toBe("true");
    pick.click();
    expect(h.onFocusConn).toHaveBeenCalledOnce();
    expect(h.onToggleCollapse).not.toHaveBeenCalled();
  });

  it("folds the tree from its own chevron, named after the connection", () => {
    const h = mount();
    button("Contraer Prod").click();
    expect(h.onToggleCollapse).toHaveBeenCalledOnce();
  });

  it("disconnects, named so several rows are not the same button", () => {
    const h = mount();
    button("Desconectar Prod").click();
    expect(h.onDisconnect).toHaveBeenCalledOnce();
  });

  it("says a lost session is lost and offers Reconectar instead of refresh (#407)", () => {
    const h = mount({ lost: true });
    expect(row().querySelector(".connbar-lost")).not.toBeNull();
    expect(row().classList.contains("is-lost")).toBe(true);
    button("Reconectar").click();
    expect(h.onReconnect).toHaveBeenCalledOnce();
  });

  it("says it is reconnecting by itself, without a second reconnect (#676)", () => {
    mount({ lost: true, reconnecting: true });
    expect(row().querySelector(".connbar-reconnecting")?.textContent).toBe("reconectando…");
    expect(row().querySelector(".connbar-lost")).toBeNull();
    expect(button("Reconectar")).toBeUndefined();
  });

  it("says it reconnected, for a moment", () => {
    mount({ reconnected: true });
    expect(row().querySelector(".connbar-reconnecting")?.getAttribute("title")).toBe(
      "Reconectado a «Prod».",
    );
  });

  it("shows its open transaction", () => {
    mount({ txStatements: 2 });
    expect(row().querySelector(".conn-tx")).not.toBeNull();
  });

  it("disables reconnect and disconnect while a connection is being opened", () => {
    mount({ lost: true, busy: true });
    expect(button("Reconectar").disabled).toBe(true);
    expect(button("Desconectar Prod").disabled).toBe(true);
  });
});
