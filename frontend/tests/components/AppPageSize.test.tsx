import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render } from "solid-js/web";
import { App } from "../../src/App";

// Integration (A-20, R-38): the table pager's page size. utils/pager covers the
// arithmetic; this covers the WIRING — picking a size re-reads the table with
// that LIMIT, and the size is remembered for the next table opened.
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

/** Connect and open `pedidos` from the tree: a table tab with its filter panel. */
const openTable = async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  dispose = render(() => <App />, host);
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

describe("App — the table's page size (A-20, R-38)", () => {
  it("reads the table with the chosen size and remembers it", async () => {
    await openTable();
    expect(sqls.some((s) => s.includes("pedidos") && /LIMIT 1000;/.test(s))).toBe(true);
    const combo = host!.querySelector<HTMLButtonElement>('.pager [role="combobox"]')!;
    expect(combo.textContent).toContain("1000 por página");
    combo.click();
    sqls = [];
    const opt = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (o) => o.textContent === "100 por página",
    )!;
    opt.click();
    await settle();
    expect(sqls.some((s) => s.includes("pedidos") && /LIMIT 100;/.test(s))).toBe(true);
    expect(localStorage.getItem("quaero.pageSize")).toBe("100");
    expect(host!.querySelector('.pager [role="combobox"]')!.textContent).toContain("100 por página");
  });

  it("opens a table with the remembered size", async () => {
    localStorage.setItem("quaero.pageSize", "500");
    await openTable();
    expect(sqls.some((s) => s.includes("pedidos") && /LIMIT 500;/.test(s))).toBe(true);
  });
});
