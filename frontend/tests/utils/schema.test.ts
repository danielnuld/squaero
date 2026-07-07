import { describe, it, expect, afterEach, vi } from "vitest";
import {
  parseTreeRows,
  quoteIdentifier,
  qualifiedName,
  schemaDdl,
  schemaTree,
  schemaDescribe,
} from "../../src/utils/schema";
import type { ResultSet } from "../../src/utils/query";

interface BridgeHost {
  quaeroRpc?: (requestJson: string) => Promise<unknown>;
}

afterEach(() => {
  delete (globalThis as BridgeHost).quaeroRpc;
});

const rs = (columns: { name: string; type: string }[], rows: (string | null)[][]): ResultSet => ({
  columns,
  rows,
  truncated: false,
  rowsAffected: 0,
});

describe("parseTreeRows", () => {
  it("reads databases/schemas (name only) with the fallback kind", () => {
    const res = rs([{ name: "name", type: "text" }], [["main"], ["temp"]]);
    expect(parseTreeRows(res, "database")).toEqual([
      { name: "main", kind: "database" },
      { name: "temp", kind: "database" },
    ]);
  });

  it("auto-detects tables vs views from the type column", () => {
    const res = rs(
      [{ name: "name", type: "text" }, { name: "type", type: "text" }],
      [["users", "table"], ["adults", "view"]],
    );
    expect(parseTreeRows(res, "schema")).toEqual([
      { name: "users", kind: "table" },
      { name: "adults", kind: "view" },
    ]);
  });

  it("returns [] when there is no name column", () => {
    expect(parseTreeRows(rs([{ name: "x", type: "text" }], [["a"]]), "database")).toEqual([]);
  });

  it("skips rows with a NULL name", () => {
    const res = rs([{ name: "name", type: "text" }], [["a"], [null]]);
    expect(parseTreeRows(res, "schema")).toEqual([{ name: "a", kind: "schema" }]);
  });
});

describe("quoteIdentifier", () => {
  it("defaults to ANSI double quotes, doubling embedded quotes", () => {
    expect(quoteIdentifier("users")).toBe('"users"');
    expect(quoteIdentifier('a"b')).toBe('"a""b"');
    expect(quoteIdentifier("users", "sqlite")).toBe('"users"');
    expect(quoteIdentifier("users", "postgres")).toBe('"users"');
  });
  it("uses backticks for MySQL/MariaDB, doubling embedded backticks", () => {
    expect(quoteIdentifier("users", "mysql")).toBe("`users`");
    expect(quoteIdentifier("users", "mariadb")).toBe("`users`");
    expect(quoteIdentifier("a`b", "mysql")).toBe("`a``b`");
    expect(quoteIdentifier("MySQL", "MYSQL")).toBe("`MySQL`"); // case-insensitive engine
  });
  it("quotes an empty identifier", () => {
    expect(quoteIdentifier("")).toBe('""');
  });
  it("leaves Informix identifiers bare (no delimited identifiers by default)", () => {
    expect(quoteIdentifier("customer", "informix")).toBe("customer");
    expect(quoteIdentifier("Customer", "INFORMIX")).toBe("Customer");
  });
});

describe("qualifiedName", () => {
  it("dot-joins quoted parts for LIMIT-dialect engines", () => {
    expect(qualifiedName({ db: "app", schema: "dbo", name: "users" }, "sqlite")).toBe(
      '"app"."dbo"."users"',
    );
    expect(qualifiedName({ db: "app", name: "users" }, "mysql")).toBe("`app`.`users`");
    expect(qualifiedName({ name: "users" }, "postgres")).toBe('"users"');
  });
  it("uses database:table on Informix, bare and without the owner", () => {
    // The owner is dropped: an owner-qualified reference stalls on some servers.
    expect(qualifiedName({ db: "prod", schema: "informix", name: "customer" }, "informix")).toBe(
      "prod:customer",
    );
    expect(qualifiedName({ schema: "informix", name: "customer" }, "informix")).toBe("customer");
    expect(qualifiedName({ name: "customer" }, "informix")).toBe("customer");
  });
});

describe("schemaDdl", () => {
  it("returns the sql cell of the first row", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (raw) => {
      const req = JSON.parse(raw) as { id: number | string };
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: { columns: [{ name: "sql", type: "text" }], rows: [["CREATE TABLE t(x)"]], truncated: false, rowsAffected: 0 },
      };
    };
    expect(await schemaDdl("c1", "t")).toBe("CREATE TABLE t(x)");
  });

  it("returns empty string when the object is unknown (no rows)", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (raw) => {
      const req = JSON.parse(raw) as { id: number | string };
      return { jsonrpc: "2.0", id: req.id, result: { columns: [{ name: "sql", type: "text" }], rows: [], truncated: false, rowsAffected: 0 } };
    };
    expect(await schemaDdl("c1", "nope")).toBe("");
  });
});

describe("schemaTree", () => {
  it("omits db/schema params when not provided", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return { jsonrpc: "2.0", id: req.id, result: { columns: [{ name: "name", type: "text" }], rows: [["main"]], truncated: false, rowsAffected: 0 } };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;
    await schemaTree("c1");
    const sent = JSON.parse(rpc.mock.calls[0][0]) as { params: Record<string, unknown> };
    expect(sent.params).toEqual({ connId: "c1" });
  });

  it("forwards db when provided", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return { jsonrpc: "2.0", id: req.id, result: { columns: [], rows: [], truncated: false, rowsAffected: 0 } };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;
    await schemaTree("c1", "main");
    const sent = JSON.parse(rpc.mock.calls[0][0]) as { params: Record<string, unknown> };
    expect(sent.params).toEqual({ connId: "c1", db: "main" });
  });
});

describe("schemaDescribe", () => {
  it("forwards connId and table", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return { jsonrpc: "2.0", id: req.id, result: { columns: [], rows: [], truncated: false, rowsAffected: 0 } };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;
    await schemaDescribe("c1", "users");
    const sent = JSON.parse(rpc.mock.calls[0][0]) as { method: string; params: unknown };
    expect(sent.method).toBe("schema.describe");
    expect(sent.params).toEqual({ connId: "c1", table: "users" });
  });

  it("forwards the db container when provided", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return { jsonrpc: "2.0", id: req.id, result: { columns: [], rows: [], truncated: false, rowsAffected: 0 } };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;
    await schemaDescribe("c1", "users", "shop");
    const sent = JSON.parse(rpc.mock.calls[0][0]) as { params: Record<string, unknown> };
    expect(sent.params).toEqual({ connId: "c1", table: "users", db: "shop" });
  });
});

describe("schemaDdl forwarding", () => {
  it("forwards connId and object", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return { jsonrpc: "2.0", id: req.id, result: { columns: [{ name: "sql", type: "text" }], rows: [["x"]], truncated: false, rowsAffected: 0 } };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;
    await schemaDdl("c1", "users");
    const sent = JSON.parse(rpc.mock.calls[0][0]) as { method: string; params: unknown };
    expect(sent.method).toBe("schema.ddl");
    expect(sent.params).toEqual({ connId: "c1", object: "users" });
  });
});
