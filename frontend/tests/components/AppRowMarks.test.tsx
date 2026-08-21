import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";

// Integration (issue #382): marking rows in the grid and acting on them from the
// cell menu. The unit tests cover the pieces (utils/rowSelection, ResultGrid);
// this one covers the WIRING — that the workspace sees the marks, offers the
// bulk entries, and copies exactly the marked rows.
//
// The core is faked at the bridge (globalThis.quaeroRpc), the same seam the
// webview binds, so App runs unmodified.

const rs = (columns: [string, string][], rows: (string | null)[][]) => ({
  columns: columns.map(([name, type]) => ({ name, type })),
  rows,
  rowsAffected: rows.length,
  truncated: false,
});

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
let copied: string[] = [];

beforeEach(() => {
  copied = [];
  localStorage.clear();
  localStorage.setItem(
    "quaero.connections",
    JSON.stringify([{ id: "k1", name: "local", driver: "mysql", params: { host: "127.0.0.1" } }]),
  );
  localStorage.setItem(
    "quaero.history",
    JSON.stringify([
      { sql: "SELECT * FROM pedidos", ts: Date.now(), connId: "k1", connName: "local" },
    ]),
  );
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
    return { jsonrpc: "2.0", id: req.id, result: answer(req.method, req.params ?? {}) };
  };
  // jsdom has no clipboard; the copy helper is best-effort and silently skips
  // without one, which would make this test pass while copying nothing.
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: (t: string) => void copied.push(t) },
  });
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
const menuItem = (text: string) =>
  [...document.querySelectorAll(".context-menu-item")].find((b) =>
    b.textContent?.includes(text),
  ) as HTMLElement | undefined;

/** Connect and run the history query, leaving three rows in the grid. */
const openWithRows = async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
  click(host.querySelector(".connbar-active"));
  click(host.querySelector(".conn-list .conn-open"));
  await settle();
  click(host.querySelector(".empty-history button, .empty-state button"));
  await settle();
  expect(host.querySelectorAll(".grid-rows .grid-row").length).toBe(3);
};

const markRow = (r: number) =>
  host!
    .querySelector(`[data-cell="${r}-0"]`)!
    .dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));

describe("App — acting on the marked rows (issue #382)", () => {
  it("copies exactly the marked rows as TSV, in view order", async () => {
    await openWithRows();
    markRow(2);
    markRow(0);

    host!
      .querySelector('[data-cell="0-0"]')!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    click(menuItem("Copiar 2 filas seleccionadas"));
    // NULL copies as an empty cell, and the rows come out top-to-bottom.
    expect(copied).toEqual(["1\tana\n3\t"]);
  });

  it("copies the marked rows as INSERT statements for the source table", async () => {
    await openWithRows();
    markRow(0);
    markRow(1);
    host!
      .querySelector('[data-cell="0-0"]')!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    click(menuItem("Copiar 2 filas como INSERT"));
    expect(copied[0]).toContain("INSERT INTO");
    expect(copied[0].split("\n")).toHaveLength(2);
  });

  it("offers nothing bulk with a single row marked", async () => {
    await openWithRows();
    markRow(1);
    host!
      .querySelector('[data-cell="1-0"]')!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    expect(menuItem("filas seleccionadas")).toBeUndefined();
    expect(menuItem("Copiar fila")).toBeDefined();
  });

  it("counts the marked rows in the status bar", async () => {
    await openWithRows();
    markRow(0);
    markRow(1);
    expect(host!.querySelector(".statusbar")!.textContent).toContain("2 seleccionadas");
  });
});
