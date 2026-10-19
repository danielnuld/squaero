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
  it("runs the structured EXPLAIN and shows an accessible tree with the costliest node", async () => {
    const calls = installBridge(() => okCell(PG_PLAN));
    mount();
    await flush();
    expect(calls[0]).toBe("EXPLAIN (FORMAT JSON) SELECT 1");
    const items = [...host!.querySelectorAll('[role="treeitem"]')];
    expect(items.length).toBe(3); // Nested Loop + 2 scans
    expect(items.map((i) => i.getAttribute("aria-level"))).toEqual(["1", "2", "2"]);
    expect(items[0].getAttribute("aria-expanded")).toBe("true");
    expect(host!.textContent).toContain("Seq Scan");
    expect(host!.textContent).toContain("orders");
    // The costliest path (root -> Seq Scan/60) is highlighted, and the node
    // with the highest own cost is marked.
    expect(host!.querySelectorAll(".ep-item.hot").length).toBe(2);
    expect(host!.querySelector(".ep-item.costliest")!.textContent).toContain("Seq Scan");
    expect(host!.textContent).toContain("Coste total 100 · 3 nodos");
  });

  it("moves through the tree with the keyboard and shows the node's detail", async () => {
    installBridge(() => okCell(PG_PLAN));
    mount();
    await flush();
    const tree = host!.querySelector('[role="tree"]')!;
    const key = (k: string) => tree.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    key("ArrowDown");
    expect(host!.querySelector('[aria-selected="true"]')!.textContent).toContain("Seq Scan");
    expect(host!.querySelector(".ep-detail-pane")!.textContent).toContain("orders");
    key("ArrowLeft"); // a leaf: to its parent
    expect(host!.querySelector('[aria-selected="true"]')!.textContent).toContain("Nested Loop");
    key("ArrowLeft"); // fold
    expect(host!.querySelectorAll('[role="treeitem"]').length).toBe(1);
    key("ArrowRight"); // unfold
    expect(host!.querySelectorAll('[role="treeitem"]').length).toBe(3);
  });

  it("reads the same plan as a table and as text", async () => {
    installBridge(() => okCell(PG_PLAN));
    mount();
    await flush();
    const radio = (label: string) =>
      [...host!.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === label)!;
    radio("Tabla").click();
    expect(radio("Tabla").getAttribute("aria-checked")).toBe("true");
    expect(host!.querySelector('[role="tree"]')).toBeNull();
    const rows = [...host!.querySelectorAll(".ep-table tbody tr")];
    expect(rows.map((r) => r.querySelector("td")!.textContent)).toEqual([
      "Nested Loop",
      "Seq Scan",
      "Index Scan",
    ]);
    expect(rows[1].children[1].textContent).toBe("orders");
    expect(rows[1].classList.contains("hot")).toBe(true);
    expect(rows[2].classList.contains("hot")).toBe(false);
    radio("Texto").click();
    expect(host!.querySelector(".ep-raw")!.textContent).toContain("-> Seq Scan on orders");
  });

  it("runs ANALYZE only for a statement that reads", async () => {
    const calls = installBridge(() => okCell(PG_PLAN));
    mount();
    await flush();
    const box = host!.querySelector<HTMLInputElement>(".ep-analyze input")!;
    expect(box.disabled).toBe(false);
    box.checked = true;
    box.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(calls[calls.length - 1]).toBe("EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1");
    dispose?.();
    host?.remove();
    mount({ sql: "DELETE FROM orders" });
    await flush();
    const off = host!.querySelector<HTMLInputElement>(".ep-analyze input")!;
    expect(off.disabled).toBe(true);
    expect(off.closest("label")!.title).toContain("escribe");
  });

  it("shows the analysed statement and copies the plan in its own tab", async () => {
    installBridge(() => okCell(PG_PLAN));
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (s: string) => void written.push(s) }, configurable: true });
    mount({ sql: "SELECT * FROM orders" });
    await flush();
    expect(host!.querySelector(".ep-query")!.textContent).toContain("SELECT * FROM orders");
    const copy = [...host!.querySelectorAll("button")].find((b) => b.textContent?.includes("Copiar plan"))!;
    copy.click();
    await flush();
    expect(written[0]).toContain("Nested Loop");
  });

  it("shows an honest message and runs nothing for an engine without structured plans", async () => {
    const calls = installBridge(() => okCell(PG_PLAN));
    mount({ engine: "informix" });
    await flush();
    expect(host!.querySelector(".grid-empty")!.textContent).toContain("no expone un plan estructurado");
    expect(calls).toHaveLength(0);
    expect(host!.querySelector('[role="tree"]')).toBeNull();
  });

  it("falls back to raw text when the structured output can't be parsed", async () => {
    installBridge(() => okCell("this is not json"));
    mount({ engine: "mysql" });
    await flush();
    expect(host!.querySelector('[role="tree"]')).toBeNull();
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
    expect(host!.querySelector(".ep-obj")!.textContent).toBe("orders");
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
