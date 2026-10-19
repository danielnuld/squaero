import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { Welcome, ConnectedHome } from "../../src/components/Welcome";
import type { Connection } from "../../src/utils/connections";
import type { TreeNode } from "../../src/utils/tree";

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
});

function mountWith(ui: () => any) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(ui, host!);
  });
}

const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const ventas: Connection = {
  id: "k1",
  name: "Ventas",
  driver: "sqlite",
  params: { path: "C:\datos\ventas.db" },
  color: "#2f7dd6",
};
const prod: Connection = { id: "k2", name: "Producción", driver: "postgres", params: { host: "db", database: "v" } };

const byText = (text: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(text))!;

function mountWelcome(recent = [{ conn: ventas, at: NOW - 5 * 60_000 }, { conn: prod, at: null }], connectingId: string | null = null) {
  const h = {
    onConnect: vi.fn(),
    onNew: vi.fn(),
    onOpenFile: vi.fn(),
    onImport: vi.fn(),
    onShowAll: vi.fn(),
    onShortcuts: vi.fn(),
  };
  mountWith(() => (
    <Welcome recent={recent} connectingId={connectingId} isMac={false} now={() => NOW} {...h} />
  ));
  return h;
}

describe("Welcome", () => {
  it("offers the three ways to start", () => {
    const h = mountWelcome();
    byText("Nueva conexión").click();
    byText("Abrir archivo .sql…").click();
    byText("Importar conexiones…").click();
    expect(h.onNew).toHaveBeenCalledOnce();
    expect(h.onOpenFile).toHaveBeenCalledOnce();
    expect(h.onImport).toHaveBeenCalledOnce();
  });

  it("lists the recent connections with engine, target, colour and last use", () => {
    const h = mountWelcome();
    const rows = [...host!.querySelectorAll<HTMLButtonElement>(".welcome-conn")];
    expect(rows.map((r) => r.querySelector(".welcome-conn-name")?.textContent)).toEqual(["Ventas", "Producción"]);
    expect(rows[0].querySelector(".welcome-conn-sub")?.textContent).toContain("SQLite");
    expect(rows[0].style.getPropertyValue("--conn-accent")).toBe("#2f7dd6");
    expect(rows[0].querySelector(".welcome-conn-when")?.textContent).toMatch(/5 minutos/);
    expect(rows[1].querySelector(".welcome-conn-when")?.textContent).toBe("sin usar");
    rows[1].click();
    expect(h.onConnect).toHaveBeenCalledWith(prod);
    byText("Ver todas").click();
    expect(h.onShowAll).toHaveBeenCalledOnce();
  });

  it("holds the list while a connection is opening", () => {
    mountWelcome(undefined, "k1");
    const rows = [...host!.querySelectorAll<HTMLButtonElement>(".welcome-conn")];
    expect(rows.every((r) => r.disabled)).toBe(true);
    expect(rows[0].getAttribute("aria-busy")).toBe("true");
  });

  it("hides «Recientes» with nothing saved and keeps the shortcuts", () => {
    const h = mountWelcome([]);
    expect(host!.textContent).not.toContain("Recientes");
    expect(host!.querySelector(".welcome-tips kbd")?.textContent).toBe("Ctrl+K");
    byText("Ver todos los atajos").click();
    expect(h.onShortcuts).toHaveBeenCalledOnce();
  });
});

describe("ConnectedHome", () => {
  const table = { key: "t:clientes", label: "clientes", kind: "table" } as TreeNode;

  it("names the connection and offers a new query, an object and recent tables", () => {
    const h = { onNewQuery: vi.fn(), onFindObject: vi.fn(), onOpenTable: vi.fn() };
    mountWith(() => (
      <ConnectedHome name="Ventas" engine="SQLite" db="main" recentTables={[table]} isMac={false} {...h} />
    ));
    expect(host!.querySelector("h1")?.textContent).toBe("Ventas está lista");
    expect(host!.textContent).toContain("SQLite · main.");
    byText("Nueva consulta").click();
    byText("Buscar un objeto…").click();
    byText("clientes").click();
    expect(h.onNewQuery).toHaveBeenCalledOnce();
    expect(h.onFindObject).toHaveBeenCalledOnce();
    expect(h.onOpenTable).toHaveBeenCalledWith(table);
    expect(byText("Nueva consulta").querySelector("kbd")?.textContent).toBe("Ctrl+T");
  });

  it("leaves out recent tables when there are none", () => {
    mountWith(() => (
      <ConnectedHome name="Ventas" engine="SQLite" recentTables={[]} isMac onNewQuery={() => {}} onFindObject={() => {}} onOpenTable={() => {}} />
    ));
    expect(host!.textContent).not.toContain("Tablas recientes");
  });
});
