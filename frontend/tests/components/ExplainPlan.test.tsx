import { describe, it, expect, afterEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { ExplainPlan } from "../../src/components/ExplainPlan";

interface BridgeHost {
  quaeroRpc?: (requestJson: string) => Promise<unknown>;
}

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as BridgeHost).quaeroRpc;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

const PG_PLAN = JSON.stringify([
  {
    Plan: {
      "Node Type": "Nested Loop",
      "Total Cost": 100,
      "Plan Rows": 10,
      Plans: [
        { "Node Type": "Seq Scan", "Relation Name": "orders", "Total Cost": 60, "Plan Rows": 100 },
        { "Node Type": "Index Scan", "Relation Name": "customers", "Total Cost": 30, "Plan Rows": 1 },
      ],
    },
  },
]);

function installBridge(handler: (sql: string) => unknown) {
  const calls: string[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; params: any };
    const sql = req.params?.sql ?? "";
    calls.push(sql);
    return { jsonrpc: "2.0", id: req.id, result: handler(sql) };
  };
  return calls;
}

function mount(over: { engine?: string; sql?: string } = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const [engine] = createSignal(over.engine ?? "postgres");
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ExplainPlan connId="c1" engine={engine()} sql={over.sql ?? "SELECT 1"} onClose={() => {}} />
      ),
      host!,
    );
  });
}

const okCell = (cell: string) => ({
  columns: [{ name: "QUERY PLAN", type: "text" }],
  rows: [[cell]],
  truncated: false,
  rowsAffected: 0,
});

describe("ExplainPlan", () => {
  it("runs the structured EXPLAIN and renders an SVG node tree", async () => {
    const calls = installBridge(() => okCell(PG_PLAN));
    mount();
    await flush();
    expect(calls[0]).toBe("EXPLAIN (FORMAT JSON) SELECT 1");
    const nodes = host!.querySelectorAll(".ep-node");
    expect(nodes.length).toBe(3); // Nested Loop + 2 scans
    expect(host!.textContent).toContain("Seq Scan");
    expect(host!.textContent).toContain("orders");
    // The costliest path (root -> Seq Scan/60) is highlighted.
    expect(host!.querySelectorAll(".ep-node.hot").length).toBeGreaterThan(0);
  });

  it("shows an honest message and runs nothing for an engine without structured plans", async () => {
    const calls = installBridge(() => okCell(PG_PLAN));
    mount({ engine: "informix" });
    await flush();
    expect(host!.querySelector(".grid-empty")!.textContent).toContain("no expone un plan estructurado");
    expect(calls).toHaveLength(0);
    expect(host!.querySelector(".ep-node")).toBeNull();
  });

  it("falls back to raw text when the structured output can't be parsed", async () => {
    installBridge(() => okCell("this is not json"));
    mount({ engine: "mysql" });
    await flush();
    expect(host!.querySelector(".ep-svg")).toBeNull();
    expect(host!.querySelector(".ep-raw")!.textContent).toContain("this is not json");
  });

  it("surfaces a server error", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number };
      return { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "syntax error near EXPLAIN" } };
    };
    mount();
    await flush();
    expect(host!.querySelector(".grid-error")!.textContent).toContain("syntax error");
  });

  it("parses a SQLite QUERY PLAN result", async () => {
    installBridge(() => ({
      columns: [
        { name: "id", type: "int" },
        { name: "parent", type: "int" },
        { name: "notused", type: "int" },
        { name: "detail", type: "text" },
      ],
      rows: [["2", "0", "0", "SCAN TABLE orders"]],
      truncated: false,
      rowsAffected: 0,
    }));
    mount({ engine: "sqlite" });
    await flush();
    expect(host!.textContent).toContain("SCAN");
    expect(host!.textContent).toContain("orders");
  });
});
