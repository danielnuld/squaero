import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ErDiagram } from "../../src/components/ErDiagram";

// Drives the real ErDiagram in jsdom against a mocked bridge: it walks the tree,
// describes each table, lays out boxes and draws an inferred FK edge.

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

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const rs = (columns: { name: string; type: string }[], rows: (string | null)[][]) => ({
  columns,
  rows,
  truncated: false,
  rowsAffected: 0,
});

function installBridge() {
  (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params: Record<string, unknown> };
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
    if (req.method === "schema.tree") {
      if (!req.params.db) return ok(rs([{ name: "name", type: "text" }], [["testdb"]]));
      return ok(
        rs(
          [{ name: "name", type: "text" }, { name: "type", type: "text" }],
          [["orders", "table"], ["customers", "table"]],
        ),
      );
    }
    if (req.method === "schema.describe") {
      const cols = [
        { name: "name", type: "text" },
        { name: "type", type: "text" },
        { name: "pk", type: "int" },
      ];
      if (req.params.table === "orders") {
        return ok(rs(cols, [["id", "int", "1"], ["customer_id", "int", "0"], ["total", "float", "0"]]));
      }
      return ok(rs(cols, [["id", "int", "1"], ["name", "text", "0"]]));
    }
    return { jsonrpc: "2.0", id: req.id, result: {} };
  };
}

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <ErDiagram connId="c1" onClose={() => {}} />, host!);
  });
}

describe("ErDiagram", () => {
  it("draws a box per table with its columns and an inferred edge", async () => {
    installBridge();
    mount();
    await flush();

    // Two table boxes.
    const boxes = host!.querySelectorAll(".er-box");
    expect(boxes.length).toBe(2);
    // Titles present.
    const titles = [...host!.querySelectorAll(".er-box-title")].map((t) => t.textContent);
    expect(titles).toContain("orders");
    expect(titles).toContain("customers");
    // One inferred edge (orders.customer_id -> customers).
    expect(host!.querySelectorAll(".er-edge").length).toBe(1);
    // The count line reports it.
    expect(host!.textContent).toContain("2 tabla(s)");
    expect(host!.textContent).toContain("1 relación(es) inferida(s)");
    // A primary-key column is marked.
    expect(host!.querySelector(".er-col-pk")).not.toBeNull();
  });
});
