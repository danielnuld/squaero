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

  it("reads the same plan as a table, indented, costliest path marked (ExplainPlanTable)", async () => {
    installBridge(() => okCell(PG_PLAN));
    mount();
    await flush();
    const table = [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Tabla")!;
    table.click();
    expect(table.getAttribute("aria-pressed")).toBe("true");
    expect(host!.querySelector(".ep-svg")).toBeNull();
    const rows = [...host!.querySelectorAll(".ep-table tbody tr")];
    expect(rows.map((r) => r.querySelector("td")!.textContent)).toEqual([
      "Nested Loop",
      "Seq Scan",
      "Index Scan",
    ]);
    expect(rows[1].children[1].textContent).toBe("orders");
    expect(rows[1].classList.contains("hot")).toBe(true);
    expect(rows[2].classList.contains("hot")).toBe(false);
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

describe("ExplainPlan on MongoDB", () => {
  const mongoResult = (qp: unknown) => ({
    columns: [
      { name: "queryPlanner", type: "json" },
      { name: "ok", type: "int" },
    ],
    rows: [[JSON.stringify(qp), "1"]],
    truncated: false,
    rowsAffected: 0,
  });

  it("asks the driver for the plan and draws the winning plan's stages", async () => {
    const calls = installBridge(() =>
      mongoResult({
        namespace: "shop.orders",
        winningPlan: { stage: "FETCH", inputStage: { stage: "IXSCAN", indexName: "total_1" } },
      }),
    );
    mount({ engine: "mongodb", sql: "db.orders.find({total: {$gt: 5}})" });
    await flush();
    expect(calls[0]).toBe('db.orders.find({total: {$gt: 5}}).explain("queryPlanner")');
    const ops = [...host!.querySelectorAll(".ep-op")].map((e) => e.textContent);
    expect(ops).toEqual(expect.arrayContaining(["FETCH", "IXSCAN"]));
    expect(host!.querySelector(".ep-table")!.textContent).toBe("orders");
  });

  it("shows the driver's error as is (e.g. an insert has no plan)", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number };
      return { jsonrpc: "2.0", id: req.id, error: { code: -32003, message: "unexpected characters after the call" } };
    };
    mount({ engine: "mongodb", sql: "db.orders.insertOne({a: 1})" });
    await flush();
    expect(host!.querySelector("[role='alert']")!.textContent).toContain("unexpected characters");
  });
});
