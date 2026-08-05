import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ErDiagram } from "../../src/components/ErDiagram";

// Drives the real ErDiagram in jsdom against a mocked bridge: it walks the tree,
// describes each table, lays out boxes and draws FK edges — from real foreign-key
// metadata when the engine exposes it (issue #260), or naming inference otherwise.

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
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0));
};

const rs = (columns: { name: string; type: string }[], rows: (string | null)[][]) => ({
  columns,
  rows,
  truncated: false,
  rowsAffected: 0,
});

// `fkMode` shapes the query.run responses: "mysql" answers the bulk FK query,
// "sqlite" answers the pragma table-valued function, "error" makes it fail.
function installBridge(fkMode: "mysql" | "sqlite" | "error" = "mysql") {
  (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params: Record<string, unknown> };
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
    const fail = (message: string) => ({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message } });
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
    if (req.method === "query.run") {
      const sql = String(req.params.sql ?? "");
      if (fkMode === "error") return fail("permiso denegado");
      // The MySQL bulk FK query resolves the real foreign key.
      if (sql.includes("KEY_COLUMN_USAGE")) {
        return ok(
          rs(
            [
              { name: "from_table", type: "text" },
              { name: "from_column", type: "text" },
              { name: "to_table", type: "text" },
              { name: "to_column", type: "text" },
            ],
            [["orders", "customer_id", "customers", "id"]],
          ),
        );
      }
      // SQLite answers the same shape through pragma_foreign_key_list joined to
      // sqlite_master: one query for the whole database, like the other engines.
      if (sql.includes("pragma_foreign_key_list")) {
        return ok(
          rs(
            [
              { name: "from_table", type: "text" },
              { name: "from_column", type: "text" },
              { name: "to_table", type: "text" },
              { name: "to_column", type: "text" },
              { name: "constraint_name", type: "text" },
              { name: "position", type: "int" },
            ],
            [["orders", "customer_id", "customers", "id", "0", "0"]],
          ),
        );
      }
    }
    return { jsonrpc: "2.0", id: req.id, result: {} };
  };
}

function mount(engine: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <ErDiagram connId="c1" engine={engine} db="testdb" onClose={() => {}} />, host!);
  });
}

describe("ErDiagram", () => {
  it("draws real FK edges when the engine exposes foreign keys", async () => {
    installBridge();
    mount("mysql");
    await flush();

    const boxes = host!.querySelectorAll(".er-box");
    expect(boxes.length).toBe(2);
    const titles = [...host!.querySelectorAll(".er-box-title")].map((t) => t.textContent);
    expect(titles).toContain("orders");
    expect(titles).toContain("customers");
    // The real FK (orders.customer_id -> customers.id) yields one edge.
    const edges = host!.querySelectorAll(".er-edge");
    expect(edges.length).toBe(1);
    expect(edges[0].querySelector("title")?.textContent).toContain("customers.id");
    // Labelled as real, not inferred.
    expect(host!.textContent).toContain("(FK reales)");
    expect(host!.textContent).toContain("llaves foráneas reales");
    expect(host!.querySelector(".er-col-pk")).not.toBeNull();
  });

  it("resolves real FKs on SQLite through the pragma table-valued function", async () => {
    installBridge("sqlite");
    mount("sqlite");
    await flush();

    expect(host!.querySelectorAll(".er-box").length).toBe(2);
    // Only `orders` has a FK, resolved by the single catalog query.
    const edges = host!.querySelectorAll(".er-edge");
    expect(edges.length).toBe(1);
    expect(edges[0].querySelector("title")?.textContent).toContain("customers.id");
    expect(host!.textContent).toContain("(FK reales)");
  });

  it("falls back to name inference when the engine has no foreign keys", async () => {
    installBridge();
    mount("mongodb");
    await flush();

    expect(host!.querySelectorAll(".er-box").length).toBe(2);
    // orders.customer_id -> customers inferred by name.
    expect(host!.querySelectorAll(".er-edge").length).toBe(1);
    expect(host!.textContent).toContain("(inferidas)");
    expect(host!.textContent).toContain("convención de nombres");
    // MongoDB's honest per-engine reason is surfaced.
    expect(host!.textContent).toContain("MongoDB no tiene llaves foráneas");
  });

  it("falls back to name inference when the FK query fails (permissions)", async () => {
    installBridge("error");
    mount("mysql");
    await flush();

    expect(host!.querySelectorAll(".er-box").length).toBe(2);
    // Real FK query threw → still draws inferred edges rather than nothing.
    expect(host!.querySelectorAll(".er-edge").length).toBe(1);
    expect(host!.textContent).toContain("(inferidas)");
  });
});
