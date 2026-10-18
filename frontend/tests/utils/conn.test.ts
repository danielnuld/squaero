import { describe, it, expect, afterEach, vi } from "vitest";
import {
  parseConnId,
  parseConnFeatures,
  openSession,
  openConnection,
  closeConnection,
  testConnection,
  listDatabases,
} from "../../src/utils/conn";
import { QueryError } from "../../src/utils/query";
import type { JsonRpcResponse } from "../../src/utils/ipc";

interface BridgeHost {
  quaeroRpc?: (requestJson: string) => Promise<unknown>;
}

afterEach(() => {
  delete (globalThis as BridgeHost).quaeroRpc;
});

describe("parseConnId", () => {
  it("returns the connId from a success response", () => {
    const res: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: { connId: "c1" } };
    expect(parseConnId(res)).toBe("c1");
  });

  it("throws QueryError on an error response", () => {
    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "no se pudo conectar" },
    };
    expect(() => parseConnId(res)).toThrow(QueryError);
  });

  it("throws when connId is missing", () => {
    const res: JsonRpcResponse = { jsonrpc: "2.0", id: 1, result: {} };
    expect(() => parseConnId(res)).toThrow(/connId/);
  });
});

describe("parseConnFeatures", () => {
  const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: "2.0", id: 1, result });

  it("reads every capability the core reports", () => {
    const features = {
      cancel: true,
      transactions: true,
      ddl: false,
      dml: true,
      schemas: false,
      introspection: true,
    };
    expect(parseConnFeatures(ok({ connId: "c1", features }))).toEqual(features);
  });

  it("is null when the core reports none (older core: nothing known)", () => {
    expect(parseConnFeatures(ok({ connId: "c1" }))).toBeNull();
    expect(parseConnFeatures(ok({ connId: "c1", features: null }))).toBeNull();
    expect(parseConnFeatures(ok({ connId: "c1", features: "all" }))).toBeNull();
  });

  it("reads a missing or non-boolean key as unsupported", () => {
    const f = parseConnFeatures(ok({ connId: "c1", features: { cancel: "yes", dml: true } }));
    expect(f?.cancel).toBe(false);
    expect(f?.dml).toBe(true);
    expect(f?.transactions).toBe(false);
  });

  it("is null for an error response", () => {
    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      error: { code: -32000, message: "no" },
    };
    expect(parseConnFeatures(res)).toBeNull();
  });
});

describe("openSession", () => {
  it("resolves with the connId and the engine's features", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          connId: "c3",
          features: {
            cancel: false,
            transactions: true,
            ddl: true,
            dml: true,
            schemas: false,
            introspection: true,
          },
        },
      };
    };
    const s = await openSession("mongodb", { host: "h" });
    expect(s.connId).toBe("c3");
    expect(s.features?.cancel).toBe(false);
  });
});

describe("openConnection", () => {
  it("sends driver and dsn and resolves with the connId", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return { jsonrpc: "2.0", id: req.id, result: { connId: "c7" } };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;

    const id = await openConnection("sqlite", { path: ":memory:" });
    expect(id).toBe("c7");
    const sent = JSON.parse(rpc.mock.calls[0][0]) as {
      method: string;
      params: { driver: string; dsn: Record<string, string> };
    };
    expect(sent.method).toBe("conn.open");
    expect(sent.params).toEqual({ driver: "sqlite", dsn: { path: ":memory:" } });
  });
});

describe("testConnection", () => {
  it("opens then closes (two calls) on success", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string; method: string };
      if (req.method === "conn.open") {
        return { jsonrpc: "2.0", id: req.id, result: { connId: "c1" } };
      }
      return { jsonrpc: "2.0", id: req.id, result: { closed: true } };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;

    await expect(testConnection("sqlite", { path: ":memory:" })).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledTimes(2);
    const methods = rpc.mock.calls.map((c) => JSON.parse(c[0]).method);
    expect(methods).toEqual(["conn.open", "conn.close"]);
  });

  it("rejects (and does not close) when open fails", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32000, message: "unable to open database file" },
      };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;

    await expect(testConnection("sqlite", { path: "/nope" })).rejects.toThrow(QueryError);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});

describe("closeConnection", () => {
  it("sends conn.close with the connId", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return { jsonrpc: "2.0", id: req.id, result: { closed: true } };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;

    await closeConnection("c1");
    const sent = JSON.parse(rpc.mock.calls[0][0]) as {
      method: string;
      params: { connId: string };
    };
    expect(sent.method).toBe("conn.close");
    expect(sent.params).toEqual({ connId: "c1" });
  });

  it("resolves even when the core reports the connection was absent", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32002, message: "unknown connId" },
      };
    };
    await expect(closeConnection("c1")).resolves.toBeUndefined();
  });
});

describe("listDatabases", () => {
  it("opens, lists databases from schema.tree, then closes", async () => {
    const calls: string[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number; method: string };
      calls.push(req.method);
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
      if (req.method === "conn.open") return ok({ connId: "c9" });
      if (req.method === "schema.tree")
        return ok({
          columns: [{ name: "name", type: "text" }],
          rows: [["appdb"], ["reporting"]],
          truncated: false,
          rowsAffected: 0,
        });
      return ok({ closed: true }); // conn.close
    };
    const dbs = await listDatabases("mysql", { host: "h", user: "u" });
    expect(dbs).toEqual(["appdb", "reporting"]);
    expect(calls).toEqual(["conn.open", "schema.tree", "conn.close"]);
  });

  it("closes the probe connection even when listing fails", async () => {
    const calls: string[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number; method: string };
      calls.push(req.method);
      if (req.method === "conn.open")
        return { jsonrpc: "2.0", id: req.id, result: { connId: "c9" } };
      if (req.method === "schema.tree")
        return { jsonrpc: "2.0", id: req.id, error: { code: -32001, message: "no soportado" } };
      return { jsonrpc: "2.0", id: req.id, result: { closed: true } };
    };
    await expect(listDatabases("mongodb", {})).rejects.toThrow();
    expect(calls).toContain("conn.close");
  });
});
