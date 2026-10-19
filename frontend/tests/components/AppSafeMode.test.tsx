import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";
import { openQueryTab } from "./appHelpers";

// Integration (issue #666): a protected connection, end to end through the App.
// The core is faked at the bridge (globalThis.quaeroRpc), the same seam the
// webview binds, so every request the App sends is recorded in `sent`.

let sent: { method: string; params: Record<string, unknown> }[] = [];

const rs = (columns: [string, string][], rows: (string | null)[][]) => ({
  columns: columns.map(([name, type]) => ({ name, type })),
  rows,
  rowsAffected: rows.length,
  truncated: false,
});

const answer = (method: string, params: Record<string, unknown>): unknown => {
  switch (method) {
    case "conn.open":
      return { connId: "c1" };
    case "schema.tree":
      return rs([["name", "text"]], [["testdb"]]);
    case "schema.describe":
      return rs([["name", "text"], ["type", "text"], ["pk", "int"]], [["id", "int", "1"], ["total", "float", "0"]]);
    case "query.run":
      return String(params.sql).startsWith("SELECT")
        ? rs([["id", "int"], ["total", "float"]], [["1", "1520.50"]])
        : rs([], []);
    default:
      return {};
  }
};

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

function setup(safeMode: string, historySql: string) {
  localStorage.setItem(
    "quaero.connections",
    JSON.stringify([
      { id: "k1", name: "prod", driver: "mysql", params: { host: "127.0.0.1" }, safeMode },
    ]),
  );
  // The empty state offers the history, which runs a query without driving CodeMirror.
  localStorage.setItem(
    "quaero.history",
    JSON.stringify([{ sql: historySql, ts: Date.now(), connId: "k1", connName: "prod" }]),
  );
}

beforeEach(() => {
  sent = [];
  localStorage.clear();
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
    sent.push({ method: req.method, params: req.params ?? {} });
    return { jsonrpc: "2.0", id: req.id, result: answer(req.method, req.params ?? {}) };
  };
});

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as Record<string, unknown>).quaeroRpc;
});

const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const click = (el: Element | null | undefined) => (el as HTMLElement).click();
const byText = (sel: string, text: string) =>
  [...document.querySelectorAll(sel)].find((b) => b.textContent?.trim() === text);
const ranSql = () =>
  sent.filter((r) => r.method === "query.run").map((r) => String(r.params.sql));

async function connectAndRunHistory() {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
  click(host.querySelector(".connbar-add"));
  click(host.querySelector(".connsearch-hit"));
  await settle();
  // Connecting lands on the connection's home (#694); open a query tab.
  openQueryTab(host);
  await settle();
  click(host.querySelector(".empty-history button, .empty-state .empty-sql"));
  await settle();
}

describe("App — safe mode per connection (issue #666)", () => {
  it("read-only: refuses a write with an explicit error, sending nothing", async () => {
    setup("readOnly", "DELETE FROM pedidos");
    await connectAndRunHistory();
    expect(ranSql().some((s) => s.startsWith("DELETE"))).toBe(false);
    expect(host!.textContent).toContain("es una conexión de solo lectura");
    // And the connection says it is protected.
    expect(host!.querySelector(".connbar-item .safe-badge")).not.toBeNull();
  });

  it("read-only: a read runs, and the toolbar says why it cannot be edited", async () => {
    setup("readOnly", "SELECT * FROM pedidos");
    await connectAndRunHistory();
    expect(ranSql()).toContain("SELECT * FROM pedidos");
    expect(host!.querySelectorAll(".grid-rows .grid-row").length).toBe(1);
    // No Editar button any more (#688), and no row to add on a protected one.
    expect(byText("button", "Editar")).toBeUndefined();
    expect(byText("button", "Fila")).toBeUndefined();
    expect(host!.querySelector(".edit-hint-ro")?.textContent).toContain("protegida");
  });

  it("confirm: asks first, listing the write; cancelling sends nothing", async () => {
    setup("confirm", "DELETE FROM pedidos WHERE id = 1");
    await connectAndRunHistory();
    const dialog = document.querySelector(".confirm-dialog");
    expect(dialog, "the write must be confirmed first").not.toBeNull();
    expect(dialog!.textContent).toContain("DELETE FROM pedidos WHERE id = 1;");
    expect(ranSql().some((s) => s.startsWith("DELETE"))).toBe(false);
    click(byText(".confirm-dialog button", "Cancelar"));
    await settle();
    expect(ranSql().some((s) => s.startsWith("DELETE"))).toBe(false);
    expect(host!.textContent).toContain("no se confirmó");
  });

  it("confirm: once accepted, the write runs", async () => {
    setup("confirm", "DELETE FROM pedidos WHERE id = 1");
    await connectAndRunHistory();
    click(byText(".confirm-dialog button", "Escribir"));
    await settle();
    expect(ranSql()).toContain("DELETE FROM pedidos WHERE id = 1");
    expect(document.querySelector(".confirm-dialog")).toBeNull();
  });
});
