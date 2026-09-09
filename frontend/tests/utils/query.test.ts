import { describe, it, expect, afterEach, vi } from "vitest";
import {
  parseQueryResult,
  QueryError,
  runQuery,
  queryNext,
  drainQuery,
  runScript,
} from "../../src/utils/query";
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
      cursor: false,
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
      cursor: false,
      rowsAffected: 3,
    });
  });

  it("carries the open cursor through (issue #478)", () => {
    const res: JsonRpcResponse = {
      jsonrpc: "2.0",
      id: 4,
      result: { columns: [], rows: [], truncated: true, cursor: true, rowsAffected: 0 },
    };
    expect(parseQueryResult(res).cursor).toBe(true);
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

  it("asks the core to keep a cursor open, but never together with an offset", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return { jsonrpc: "2.0", id: req.id, result: { rowsAffected: 0 } };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;

    await runQuery("c1", "SELECT 1", 100, 0, true);
    await runQuery("c1", "SELECT 1", 100, 100, true);

    const first = JSON.parse(rpc.mock.calls[0][0]) as { params: Record<string, unknown> };
    const second = JSON.parse(rpc.mock.calls[1][0]) as { params: Record<string, unknown> };
    expect(first.params.cursor).toBe(true);
    expect("cursor" in second.params).toBe(false);
    expect(second.params.offset).toBe(100);
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

describe("drainQuery (issue #479)", () => {
  /** A canned engine: `pages` are served in order, cursor-style. */
  const bridge = (pages: { rows: string[][]; truncated: boolean; cursor?: boolean }[]) => {
    const methods: string[] = [];
    let n = 0;
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string; method: string };
      methods.push(req.method);
      if (req.method === "query.cursorClose") {
        return { jsonrpc: "2.0", id: req.id, result: { closed: true } };
      }
      const page = pages[n++];
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          columns: [{ name: "id", type: "int" }],
          rows: page.rows,
          truncated: page.truncated,
          cursor: page.cursor ?? false,
          rowsAffected: 0,
        },
      };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;
    return { rpc, methods };
  };

  it("reads every page over the cursor, not just the first", async () => {
    const { methods } = bridge([
      { rows: [["1"], ["2"]], truncated: true, cursor: true },
      { rows: [["3"], ["4"]], truncated: true, cursor: true },
      { rows: [["5"]], truncated: false },
    ]);

    const all = await drainQuery("c1", "SELECT id FROM t", 2);

    expect(all.rows).toEqual([["1"], ["2"], ["3"], ["4"], ["5"]]);
    expect(all.truncated).toBe(false);
    // One execution, then continuations: query.run exactly once.
    expect(methods).toEqual(["query.run", "query.next", "query.next"]);
  });

  it("falls back to offsets when the cursor was lost", async () => {
    const { rpc, methods } = bridge([
      { rows: [["1"]], truncated: true },  // no cursor came back
      { rows: [["2"]], truncated: false },
    ]);

    const all = await drainQuery("c1", "SELECT id FROM t", 1);

    expect(all.rows).toEqual([["1"], ["2"]]);
    expect(methods).toEqual(["query.run", "query.run"]);
    const second = JSON.parse(rpc.mock.calls[1][0]) as { params: { offset: number } };
    expect(second.params.offset).toBe(1);
  });

  it("stops on an empty page (the last page of an exact multiple)", async () => {
    const { methods } = bridge([
      { rows: [["1"], ["2"]], truncated: true, cursor: true },
      { rows: [], truncated: true, cursor: false },
    ]);

    const all = await drainQuery("c1", "SELECT id FROM t", 2);

    expect(all.rows).toEqual([["1"], ["2"]]);
    expect(methods).toEqual(["query.run", "query.next"]);
  });

  it("closes a cursor the walk stopped on", async () => {
    const { methods } = bridge([
      { rows: [["1"], ["2"]], truncated: true, cursor: true },
      { rows: [], truncated: true, cursor: true },   // still open, nothing left
    ]);

    await drainQuery("c1", "SELECT id FROM t", 2);

    expect(methods).toEqual(["query.run", "query.next", "query.cursorClose"]);
  });

  it("reports the rows gathered so far", async () => {
    bridge([
      { rows: [["1"], ["2"]], truncated: true, cursor: true },
      { rows: [["3"]], truncated: false },
    ]);
    const seen: number[] = [];
    await drainQuery("c1", "SELECT id FROM t", 2, (rows) => seen.push(rows));
    expect(seen).toEqual([2, 3]);
  });
});

describe("queryNext", () => {
  it("asks for the next page of the connection's cursor", async () => {
    const rpc = vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number | string };
      return { jsonrpc: "2.0", id: req.id, result: { rowsAffected: 0 } };
    });
    (globalThis as BridgeHost).quaeroRpc = rpc;

    await queryNext("c1", 500);

    const sent = JSON.parse(rpc.mock.calls[0][0]) as {
      method: string;
      params: Record<string, unknown>;
    };
    expect(sent.method).toBe("query.next");
    expect(sent.params).toEqual({ connId: "c1", limit: 500 });
  });
});
