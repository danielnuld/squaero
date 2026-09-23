import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";

// Integration (issue #593): filtering a table by the value of the cell under
// the pointer, from the cell menu. utils/dataFilter covers the condition and its
// SQL; this covers the WIRING — the entries appear on a table tab, and picking
// one reaches the core as a WHERE on that column and value.
//
// The core is faked at the bridge (globalThis.quaeroRpc), as in AppRowMarks.

const rs = (columns: [string, string][], rows: (string | null)[][]) => ({
  columns: columns.map(([name, type]) => ({ name, type })),
  rows,
  rowsAffected: rows.length,
  truncated: false,
});

let sqls: string[] = [];

const answer = (method: string, params: Record<string, unknown>): unknown => {
  const sql = String(params.sql ?? "");
  switch (method) {
    case "conn.open":
      return { connId: "c1" };
    case "schema.tree":
      return params.db
        ? rs([["name", "text"], ["type", "text"]], [["pedidos", "table"]])
        : rs([["name", "text"]], [["testdb"]]);
    case "schema.describe":
      return rs(
        [["name", "text"], ["type", "text"], ["pk", "int"]],
        [["id", "int", "1"], ["cliente", "text", "0"]],
      );
    case "query.run":
      sqls.push(sql);
      if (sql.includes("pedidos")) {
        return rs(
          [["id", "int"], ["cliente", "text"]],
          [["1", "ana"], ["2", "beto"], ["3", null]],
        );
      }
      return rs([], []);
    default:
      return {};
  }
};

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  sqls = [];
  localStorage.clear();
  localStorage.setItem(
    "quaero.connections",
    JSON.stringify([{ id: "k1", name: "local", driver: "mysql", params: { host: "127.0.0.1" } }]),
  );
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
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
const treeRow = (text: string) =>
  [...host!.querySelectorAll(".objtree-row")].find((r) => r.textContent?.includes(text));
const menuItems = () =>
  [...document.querySelectorAll(".context-menu-item")].map((b) => b.textContent ?? "");
const menuItem = (text: string) =>
  [...document.querySelectorAll(".context-menu-item")].find((b) =>
    b.textContent?.includes(text),
  ) as HTMLElement | undefined;
const rightClick = (cell: string) =>
  host!
    .querySelector(`[data-cell="${cell}"]`)!
    .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));

/** Connect and open `pedidos` from the tree: a table tab with its filter panel. */
const openTable = async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
  click(host.querySelector(".connbar-add"));
  click(host.querySelector(".connsearch-hit"));
  await settle();
  click(treeRow("testdb"));
  await settle();
  click(treeRow("Tablas"));
  await settle();
  click(treeRow("pedidos"));
  await settle();
  expect(host.querySelectorAll(".grid-rows .grid-row").length).toBe(3);
};

describe("App — filter by the cell's value (issue #593)", () => {
  it("filters the table at the server by the cell's column and value", async () => {
    await openTable();
    rightClick("0-1"); // cliente = ana
    expect(menuItems()).toContain("Filtrar: cliente ≠ ana");
    sqls = [];
    click(menuItem("Filtrar: cliente = ana"));
    await settle();
    expect(sqls.some((s) => s.includes("WHERE `cliente` = 'ana'"))).toBe(true);
    // And, now that something is filtered, the menu offers the way back.
    rightClick("0-1");
    expect(menuItem("Quitar filtros y orden")).toBeTruthy();
  });

  it("offers only the NULL tests on a NULL cell", async () => {
    await openTable();
    rightClick("2-1");
    const filters = menuItems().filter((m) => m.startsWith("Filtrar"));
    expect(filters).toEqual(["Filtrar: cliente es nulo", "Filtrar: cliente no es nulo"]);
  });
});
