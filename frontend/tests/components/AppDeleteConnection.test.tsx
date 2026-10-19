import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";
import { contextMenu } from "../../src/utils/contextMenu";

// Deleting a saved connection (issue #762): it goes at once with an undo toast
// that brings back exactly what was deleted; an OPEN connection asks first,
// because deleting it disconnects the live session.

const saved = [
  { id: "k1", name: "local", driver: "sqlite", params: { path: ":memory:" } },
  {
    id: "k2",
    name: "Ventas",
    driver: "postgres",
    params: { host: "db", user: "u", password: "s3cret", ssh_host: "bastion", ssh_password: "t" },
    group: "Producción",
    color: "#d33",
    safeMode: "confirm",
  },
  { id: "k3", name: "notas", driver: "sqlite", params: { path: "/notas.db" } },
];
const SAVED_JSON = JSON.stringify(saved);

let calls: string[] = [];
let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  calls = [];
  localStorage.clear();
  localStorage.setItem("quaero.connections", SAVED_JSON);
  let opened = 0;
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string };
    calls.push(req.method);
    const empty = { columns: [{ name: "name", type: "text" }], rows: [], rowsAffected: 0, truncated: false };
    const result = req.method === "conn.open" ? { connId: `c${++opened}` } : req.method === "schema.tree" ? empty : {};
    return { jsonrpc: "2.0", id: req.id, result };
  };
});

afterEach(() => {
  vi.useRealTimers();
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
const click = (el: Element | null | undefined) => (el as HTMLElement).click();
const button = (label: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label || b.title === label,
  );
const stored = () => localStorage.getItem("quaero.connections");

const mount = () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
};

const openManager = async () => {
  click(host!.querySelector(".connbar-add"));
  click(button("Gestionar"));
  await settle();
};

const deleteFromMenu = async (name: string) => {
  click(button(`Más acciones: ${name}`));
  const items = contextMenu()!.items;
  items[items.length - 1].action!();
  await settle();
};

describe("App — deleting a saved connection (issue #762)", () => {
  it("deletes at once and Deshacer restores exactly what was deleted", async () => {
    mount();
    await openManager();
    await deleteFromMenu("Ventas");

    expect(JSON.parse(stored()!).map((c: { id: string }) => c.id)).toEqual(["k1", "k3"]);
    expect(host!.querySelector(".app-toast")!.textContent).toContain("Conexión «Ventas» eliminada");

    click(button("Deshacer"));
    await settle();
    // Same fields (password and tunnel included), same position.
    expect(JSON.parse(stored()!)).toEqual(saved);
    expect(host!.querySelector(".app-toast")).toBeNull();
  });

  it("the undo toast leaves after 10 s and the deletion stays", async () => {
    mount();
    await openManager();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    click(button("Más acciones: Ventas"));
    const items = contextMenu()!.items;
    items[items.length - 1].action!();
    await Promise.resolve();
    expect(host!.querySelector(".app-toast")).not.toBeNull();
    vi.advanceTimersByTime(9_000);
    expect(host!.querySelector(".app-toast")).not.toBeNull();
    vi.advanceTimersByTime(1_000);
    expect(host!.querySelector(".app-toast")).toBeNull();
    expect(JSON.parse(stored()!)).toHaveLength(2);
  });

  it("asks before deleting an open connection, and keeps it if cancelled", async () => {
    mount();
    // Connect the first saved connection ("local").
    click(host!.querySelector(".connbar-add"));
    click(host!.querySelector(".connsearch-hit"));
    await settle();
    await openManager();
    await deleteFromMenu("local");

    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.querySelector("h2")!.textContent).toBe("¿Eliminar la conexión «local»?");
    expect(dialog.textContent).toContain("Está abierta");
    expect(calls).not.toContain("conn.close");
    expect(stored()).toBe(SAVED_JSON);

    click(button("Cancelar"));
    await settle();
    expect(calls).not.toContain("conn.close");
    expect(stored()).toBe(SAVED_JSON);

    await deleteFromMenu("local");
    click(button("Desconectar y eliminar"));
    await settle();
    expect(calls).toContain("conn.close");
    expect(JSON.parse(stored()!).map((c: { id: string }) => c.id)).toEqual(["k2", "k3"]);
    expect(button("Deshacer")).toBeDefined();
  });
});
