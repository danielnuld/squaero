import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";
import { openQueryTab } from "./appHelpers";

// A recent query picked from the empty editor (audit P1): a read runs again in a
// new tab, but a write only opens there — one click must never re-run an UPDATE.

const rs = (columns: [string, string][], rows: (string | null)[][]) => ({
  columns: columns.map(([name, type]) => ({ name, type })),
  rows,
  rowsAffected: rows.length,
  truncated: false,
});

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;
let runs: string[] = [];

const setup = (sql: string) => {
  runs = [];
  localStorage.clear();
  localStorage.setItem(
    "quaero.connections",
    JSON.stringify([{ id: "k1", name: "local", driver: "mysql", params: { host: "127.0.0.1" } }]),
  );
  localStorage.setItem(
    "quaero.history",
    JSON.stringify([{ sql, ts: Date.now(), connId: "k1", connName: "local" }]),
  );
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
    const p = req.params ?? {};
    let result: unknown = {};
    if (req.method === "conn.open") result = { connId: "c1" };
    else if (req.method === "schema.tree") result = rs([["name", "text"]], [["testdb"]]);
    else if (req.method === "query.run") {
      runs.push(String(p.sql));
      result = rs([["n", "int"]], [["1"]]);
    }
    return { jsonrpc: "2.0", id: req.id, result };
  };
};

beforeEach(() => localStorage.clear());

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

const pickRecent = async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
  click(host.querySelector(".connbar-add"));
  click(host.querySelector(".connsearch-hit"));
  await settle();
  openQueryTab(host);
  await settle();
  click(host.querySelector(".empty-sql"));
  await settle();
};

describe("App — recent queries of the empty editor", () => {
  it("re-runs a read", async () => {
    setup("SELECT * FROM pedidos");
    await pickRecent();
    expect(runs).toContain("SELECT * FROM pedidos");
  });

  it("only opens a write, without running it", async () => {
    setup("UPDATE pedidos SET estado = 'x'");
    await pickRecent();
    expect(runs.filter((s) => s.startsWith("UPDATE"))).toEqual([]);
    expect(host!.querySelector(".tab.active")).not.toBeNull();
  });
});
