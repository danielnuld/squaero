import { describe, it, expect, afterEach } from "vitest";
import { buildSqlSchema, loadCompletionSchema } from "../../src/utils/completion";

describe("buildSqlSchema", () => {
  it("maps tables to their columns", () => {
    expect(
      buildSqlSchema([
        { table: "users", columns: ["id", "name"] },
        { table: "orders", columns: ["id", "total"] },
      ]),
    ).toEqual({ users: ["id", "name"], orders: ["id", "total"] });
  });
  it("skips entries without a table name", () => {
    expect(buildSqlSchema([{ table: "", columns: ["x"] }])).toEqual({});
  });
});

interface BridgeHost {
  quaeroRpc?: (requestJson: string) => Promise<unknown>;
}

afterEach(() => {
  delete (globalThis as BridgeHost).quaeroRpc;
});

// A tree: db "main" -> tables users(id,name), orders(id,total).
function installBridge() {
  const calls: { method: string; params: any }[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
    calls.push({ method: req.method, params: req.params });
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
    const rs = (columns: string[], rows: (string | null)[][]) =>
      ok({ columns: columns.map((name) => ({ name, type: "text" })), rows, truncated: false, rowsAffected: 0 });

    if (req.method === "schema.tree") {
      if (req.params.db === undefined) return rs(["name"], [["main"]]); // databases
      // tables of "main"
      return rs(["name", "type"], [["users", "table"], ["orders", "table"]]);
    }
    if (req.method === "schema.describe") {
      const cols = req.params.table === "users" ? ["id", "name"] : ["id", "total"];
      return rs(["name", "type"], cols.map((c) => [c, "int"]));
    }
    return ok({});
  };
  return calls;
}

describe("loadCompletionSchema", () => {
  it("walks the tree and describes tables into a schema map", async () => {
    installBridge();
    const schema = await loadCompletionSchema("c1");
    expect(schema).toEqual({ users: ["id", "name"], orders: ["id", "total"] });
  });

  it("respects the maxTables cap", async () => {
    installBridge();
    const schema = await loadCompletionSchema("c1", 1);
    expect(Object.keys(schema).length).toBe(1);
  });

  it("returns an empty map when the tree walk fails", async () => {
    (globalThis as BridgeHost).quaeroRpc = async () => {
      throw new Error("bridge down");
    };
    expect(await loadCompletionSchema("c1")).toEqual({});
  });
});
