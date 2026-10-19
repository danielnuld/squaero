import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";
import { contextMenu, closeContextMenu } from "../../src/utils/contextMenu";

// The explorer's connection lifecycle and menus (audit A-15, A-17, A-18, R-05):
// a connection being opened is counted in the explorer, the working database
// has no separate dropdown any more, the connection's row has its own menu, and
// the tools menu disables what the engine cannot run, saying why.

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;
let hangOpen = false;

const rs = (cols: string[], rows: string[][]) => ({
  columns: cols.map((name) => ({ name, type: "text" })),
  rows,
  rowsAffected: 0,
  truncated: false,
});

beforeEach(() => {
  hangOpen = false;
  localStorage.clear();
  localStorage.setItem(
    "quaero.connections",
    JSON.stringify([{ id: "k1", name: "local", driver: "sqlite", params: { path: ":memory:" } }]),
  );
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string };
    if (req.method === "conn.open" && hangOpen) return new Promise(() => {});
    const result =
      req.method === "conn.open"
        ? { connId: "c1" }
        : req.method === "schema.tree"
          ? rs(["name"], [["main"]])
          : rs([], []);
    return { jsonrpc: "2.0", id: req.id, result };
  };
});

afterEach(() => {
  closeContextMenu();
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as Record<string, unknown>).quaeroRpc;
});

const settle = async () => {
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
};

async function connect() {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
  (host.querySelector(".connbar-add") as HTMLElement).click();
  (host.querySelector(".connsearch-hit") as HTMLElement).click();
  await settle();
}

describe("App — the explorer", () => {
  it("counts a connection being opened, with no Cancelar the core could not honour", async () => {
    hangOpen = true;
    await connect();
    const row = host!.querySelector(".objtree-connecting")!;
    expect(row.textContent).toContain("Conectando a local…");
    expect(row.textContent).toContain("00:00");
    expect(host!.querySelector(".side-explorer .objtree-skeleton")).not.toBeNull();
    expect([...host!.querySelectorAll(".side-explorer button")].some((b) => b.textContent === "Cancelar")).toBe(false);
  });

  it("marks the working database in the tree, with no separate dropdown (A-15)", async () => {
    await connect();
    expect(host!.querySelector(".sidebar-db")).toBeNull();
    expect(host!.querySelector(".objtree-row.is-active")?.getAttribute("aria-label")).toBe("main");
  });

  it("gives the connection's row its own menu, ending in Editar conexión and Desconectar", async () => {
    await connect();
    host!.querySelector(".objtree-header")!.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
    const labels = contextMenu()!.items.map((i) => i.label);
    expect(labels[0]).toBe("local · SQLite");
    expect(labels).toEqual(
      expect.arrayContaining(["Nueva consulta", "Lista de objetos", "Diagrama ER", "Buscar en los datos…"]),
    );
    expect(labels.slice(-2)).toEqual(["Editar conexión…", "Desconectar"]);
    contextMenu()!.items.at(-1)!.action!();
    await settle();
    expect(host!.querySelector(".objtree-header")).toBeNull();
  });

  it("disables in the tools menu what SQLite cannot run, with the reason (A-18)", async () => {
    await connect();
    (host!.querySelector(".objtree-header button[aria-label='Herramientas']") as HTMLElement).click();
    const items = contextMenu()!.items;
    expect(items.filter((i) => i.heading).map((i) => i.label)).toEqual([
      "Esquema",
      "Consultas",
      "Servidor",
      "Datos",
      "Comparar y respaldar",
    ]);
    const monitor = items.find((i) => i.label === "Monitor de servidor")!;
    expect(monitor.disabled).toBe(true);
    expect(monitor.hint).toMatch(/SQLite/);
    expect(items.find((i) => i.label === "Diagrama ER")!.disabled).toBe(false);
  });
});
