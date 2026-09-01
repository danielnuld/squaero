import { describe, it, expect, afterEach, vi } from "vitest";
import { parseQueryResult, QueryError, runQuery, runScript } from "../../src/utils/query";
import type { JsonRpcResponse } from "../../src/utils/ipc";

interface BridgeHost {
  quaeroRpc?: (requestJson: string) => Promise<unknown>;
}

afterEach(() => {
  delete (globalThis as BridgeHost).quaeroRpc;
});

describe("parseQueryResult", () => {
  it("normalizes a SELECT result", () => {
    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 1,
      result: {
        columns: [
          { name: "id", type: "int" },
          { name: "name", type: "text" },
        ],
        rows: [["1", "alice"], ["2", null]],
        truncated: false,
        rowsAffected: 0,
      },
    };
    expect(parseQueryResult(res)).toEqual({
      columns: [
        { name: "id", type: "int" },
        { name: "name", type: "text" },
      ],
      rows: [["1", "alice"], ["2", null]],
      truncated: false,
      rowsAffected: 0,
    });
  });

  it("degrades a non-SELECT (no columns/rows) to safe empties", () => {
    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 2,
      result: { rowsAffected: 3 },
    };
    expect(parseQueryResult(res)).toEqual({
      columns: [],
      rows: [],
      truncated: false,
      rowsAffected: 3,
    });
  });

  it("carries truncated through", () => {
    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 3,
      result: { columns: [], rows: [], truncated: true, rowsAffected: 0 },
    };
    expect(parseQueryResult(res).truncated).toBe(true);
  });

  it("throws QueryError with code and data for an error response", () => {
    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 4,
      error: { code: -32003, message: "syntax error", data: { near: "FRM" } },
    };
    expect(() => parseQueryResult(res)).toThrow(QueryError);
    try {
      parseQueryResult(res);
    } catch (e) {
      const err = e as QueryError;
      expect(err.code).toBe(-32003);
      expect(err.message).toBe("syntax error");
      expect(err.data).toEqual({ near: "FRM" });
    }
  });
});

describe("runQuery", () => {
  it("sends connId, sql and limit and resolves with the normalized result", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          columns: [{ name: "n", type: "int" }],
          rows: [["1"]],
          truncated: false,
          rowsAffected: 0,
        },
      };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;

    const result = await runQuery("c1", "SELECT 1 AS n", 500);

    expect(rpc).toHaveBeenCalledOnce();
    const sent = JSON.parse(rpc.mock.calls[0][0]) as {
      method: string;
      params: { connId: string; sql: string; limit: number };
    };
    expect(sent.method).toBe("query.run");
    expect(sent.params).toEqual({ connId: "c1", sql: "SELECT 1 AS n", limit: 500 });
    expect(result.columns).toEqual([{ name: "n", type: "int" }]);
    expect(result.rows).toEqual([["1"]]);
  });

  it("omits limit when not provided", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return { jsonrpc: "2.0", id: req.id, result: { rowsAffected: 0 } };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;

    await runQuery("c1", "SELECT 1");

    const sent = JSON.parse(rpc.mock.calls[0][0]) as {
      params: Record<string, unknown>;
    };
    expect(sent.params).toEqual({ connId: "c1", sql: "SELECT 1" });
    expect("limit" in sent.params).toBe(false);
  });

  it("sends offset for pagination, and omits it at offset 0", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return { jsonrpc: "2.0", id: req.id, result: { rowsAffected: 0 } };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;

    await runQuery("c1", "SELECT 1", 1000, 2000);
    let sent = JSON.parse(rpc.mock.calls[0][0]) as { params: Record<string, unknown> };
    expect(sent.params).toEqual({ connId: "c1", sql: "SELECT 1", limit: 1000, offset: 2000 });

    // Offset 0 is the first page — no need to send it.
    await runQuery("c1", "SELECT 1", 1000, 0);
    sent = JSON.parse(rpc.mock.calls[1][0]) as { params: Record<string, unknown> };
    expect("offset" in sent.params).toBe(false);
  });

  it("throws QueryError on a domain error response", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32000, message: "no se pudo conectar" },
      };
    };
    await expect(runQuery("c1", "SELECT 1")).rejects.toThrow(QueryError);
  });
});

describe("runScript", () => {
  // One call per statement: MySQL rejects `PREPARE …; EXECUTE …;` sent as one.
  const bridge = (results: Record<string, unknown>[]) => {
    const sent: string[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string; params: { sql: string } };
      sent.push(req.params.sql);
      return { jsonrpc: "2.0", id: req.id, result: results[sent.length - 1] };
    };
    return sent;
  };

  it("runs every statement in order and shows the last one with columns", async () => {
    const sent = bridge([
      { rowsAffected: 0 },
      { columns: [{ name: "n", type: "int" }], rows: [["1"]], rowsAffected: 2 },
      { rowsAffected: 3 },
    ]);

    const r = await runScript("c1", ["PREPARE s FROM @q", "EXECUTE s", "DEALLOCATE PREPARE s"]);

    expect(sent).toEqual(["PREPARE s FROM @q", "EXECUTE s", "DEALLOCATE PREPARE s"]);
    expect(r.columns).toEqual([{ name: "n", type: "int" }]);
    expect(r.rows).toEqual([["1"]]);
    expect(r.rowsAffected).toBe(5); // summed over the script
  });

  it("falls back to the last result when no statement returned columns", async () => {
    bridge([{ rowsAffected: 1 }, { rowsAffected: 4 }]);
    const r = await runScript("c1", ["INSERT INTO t VALUES (1)", "UPDATE t SET a = 1"]);
    expect(r.columns).toEqual([]);
    expect(r.rows).toEqual([]);
    expect(r.rowsAffected).toBe(5);
  });

  it("stops at the first failing statement", async () => {
    const sent: string[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string; params: { sql: string } };
      sent.push(req.params.sql);
      return sent.length === 1
        ? { jsonrpc: "2.0", id: req.id, result: { rowsAffected: 0 } }
        : { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "boom" } };
    };

    await expect(runScript("c1", ["SELECT 1", "SELEC 2", "SELECT 3"])).rejects.toThrow(QueryError);
    expect(sent).toEqual(["SELECT 1", "SELEC 2"]);
  });

  it("resolves with empties for an empty script", async () => {
    await expect(runScript("c1", [])).resolves.toEqual({
      columns: [],
      rows: [],
      truncated: false,
      rowsAffected: 0,
    });
  });
});
