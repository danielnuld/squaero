import { describe, it, expect, afterEach, vi } from "vitest";
import {
  call,
  cancelQuery,
  hasBridge,
  setSafeModeUi,
  requestWrites,
  SAFE_MODE_BLOCKED,
  setConnGuard,
  withConfirmedWrites,
  withWriteConsent,
  type BridgeHost,
  type ConfirmWrites,
} from "../../src/utils/transport";
import { isError } from "../../src/utils/ipc";

afterEach(() => {
  delete (globalThis as BridgeHost).quaeroRpc;
});

describe("transport", () => {
  describe("hasBridge", () => {
    it("is false without a bridge", () => {
      expect(hasBridge()).toBe(false);
    });

    it("is true when the bridge is present", () => {
      (globalThis as BridgeHost).quaeroRpc = async () => "{}";
      expect(hasBridge()).toBe(true);
    });
  });

  describe("call", () => {
    it("rejects when the bridge is unavailable", async () => {
      await expect(call("ping")).rejects.toThrow(/bridge unavailable/);
    });

    it("sends a request and returns the parsed response (webview returns an object)", async () => {
      // Mirrors real webview behavior: the bound function resolves with an
      // already-parsed object, not a JSON string.
      const rpc = vi.fn(async (raw: string) => {
        const req = JSON.parse(raw) as { id: number | string };
        return { jsonrpc: "2.0", id: req.id, result: { pong: true } };
      });
      (globalThis as BridgeHost).quaeroRpc = rpc;

      const response = await call("ping", { message: "hi" });

      expect(rpc).toHaveBeenCalledOnce();
      const sent = JSON.parse(rpc.mock.calls[0][0]) as {
        method: string;
        params: unknown;
      };
      expect(sent.method).toBe("ping");
      expect(sent.params).toEqual({ message: "hi" });
      expect(isError(response)).toBe(false);
      if (!isError(response)) {
        expect(response.result).toEqual({ pong: true });
      }
    });

    it("also accepts a raw JSON string from the bridge (fallback)", async () => {
      (globalThis as BridgeHost).quaeroRpc = async () =>
        '{"jsonrpc":"2.0","id":1,"result":{"pong":true}}';

      const response = await call("ping");
      expect(isError(response)).toBe(false);
      if (!isError(response)) {
        expect(response.result).toEqual({ pong: true });
      }
    });
  });

  describe("cancelQuery", () => {
    it("sends op.cancel with the connId and returns the canceled flag", async () => {
      const rpc = vi.fn(async (raw: string) => {
        const req = JSON.parse(raw) as { id: number | string };
        return { jsonrpc: "2.0", id: req.id, result: { canceled: true } };
      });
      (globalThis as BridgeHost).quaeroRpc = rpc;

      const canceled = await cancelQuery("c3");

      const sent = JSON.parse(rpc.mock.calls[0][0]) as {
        method: string;
        params: unknown;
      };
      expect(sent.method).toBe("op.cancel");
      expect(sent.params).toEqual({ connId: "c3" });
      expect(canceled).toBe(true);
    });

    it("returns false when nothing was canceled", async () => {
      (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
        const req = JSON.parse(raw) as { id: number | string };
        return { jsonrpc: "2.0", id: req.id, result: { canceled: false } };
      };
      expect(await cancelQuery("c1")).toBe(false);
    });

    it("returns false on an error response instead of throwing", async () => {
      (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
        const req = JSON.parse(raw) as { id: number | string };
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32602, message: "malformed connId" },
        };
      };
      expect(await cancelQuery("bad")).toBe(false);
    });
  });
});

// Safe mode (issue #666): the guard in call() is the one choke point.
describe("safe mode guard", () => {
  const okRpc = () =>
    vi.fn(async (raw: string) => {
      const req = JSON.parse(raw) as { id: number };
      return { jsonrpc: "2.0", id: req.id, result: {} };
    });
  const sentMethods = (rpc: ReturnType<typeof okRpc>) =>
    rpc.mock.calls.map((c) => (JSON.parse(c[0]) as { method: string }).method);

  const onConfirm = (confirm: ConfirmWrites) =>
    setSafeModeUi({ confirm, blocked: (name) => `${name} is read-only`, declined: () => "declined" });

  afterEach(() => {
    setConnGuard("c1", null);
    setSafeModeUi(null);
  });

  describe("requestWrites", () => {
    it("classifies query.run with the engine's rules", () => {
      expect(requestWrites("query.run", { sql: "SELECT 1" }, "mysql")).toBeNull();
      expect(requestWrites("query.run", { sql: "DELETE FROM t" }, "mysql")).toEqual(["DELETE FROM t"]);
      expect(requestWrites("query.run", { sql: "db.a.find({})" }, "mongodb")).toBeNull();
      expect(requestWrites("query.run", {}, "mysql")).toBeNull(); // empty SQL
    });
    it("row edits write unless they only preview", () => {
      expect(requestWrites("row.update", { table: "t" }, "mysql")).toEqual(["row.update t"]);
      expect(requestWrites("row.delete", { table: "t", preview: true }, "mysql")).toBeNull();
    });
    it("other methods read", () => {
      for (const m of ["schema.tree", "tx.begin", "tx.commit", "query.next", "conn.close"]) {
        expect(requestWrites(m, { connId: "c1" }, "mysql")).toBeNull();
      }
    });
  });

  it("an unprotected connection passes everything", async () => {
    const rpc = okRpc();
    (globalThis as BridgeHost).quaeroRpc = rpc;
    const res = await call("query.run", { connId: "c1", sql: "DROP TABLE t" });
    expect(isError(res)).toBe(false);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("read-only refuses a write without sending it, and lets reads through", async () => {
    const rpc = okRpc();
    (globalThis as BridgeHost).quaeroRpc = rpc;
    setConnGuard("c1", { mode: "readOnly", engine: "postgres", name: "Prod" });

    const refused = await call("query.run", { connId: "c1", sql: "SELECT 1; DELETE FROM t" });
    expect(isError(refused) && refused.error.code).toBe(SAFE_MODE_BLOCKED);
    expect(isError(refused) && refused.error.message).toMatch(/Prod/);
    const row = await call("row.insert", { connId: "c1", table: "t", values: {} });
    expect(isError(row)).toBe(true);
    expect(rpc).not.toHaveBeenCalled();

    await call("query.run", { connId: "c1", sql: "SELECT 1" });
    await call("row.insert", { connId: "c1", table: "t", values: {}, preview: true });
    expect(sentMethods(rpc)).toEqual(["query.run", "row.insert"]);
  });

  it("confirm asks before a write; declined, nothing is sent", async () => {
    const rpc = okRpc();
    (globalThis as BridgeHost).quaeroRpc = rpc;
    setConnGuard("c1", { mode: "confirm", engine: "postgres", name: "Prod" });
    const ask = vi.fn<ConfirmWrites>(async () => false);
    onConfirm(ask);

    const res = await call("query.run", { connId: "c1", sql: "UPDATE t SET a = 1" });
    expect(isError(res) && res.error.code).toBe(SAFE_MODE_BLOCKED);
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ name: "Prod" }), ["UPDATE t SET a = 1"]);
    expect(rpc).not.toHaveBeenCalled();

    ask.mockResolvedValue(true);
    expect(isError(await call("query.run", { connId: "c1", sql: "UPDATE t SET a = 1" }))).toBe(false);
    expect(rpc).toHaveBeenCalledOnce();
  });

  it("confirm with no dialog registered fails closed", async () => {
    const rpc = okRpc();
    (globalThis as BridgeHost).quaeroRpc = rpc;
    setConnGuard("c1", { mode: "confirm", engine: "postgres", name: "Prod" });
    expect(isError(await call("query.run", { connId: "c1", sql: "DROP TABLE t" }))).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  describe("withWriteConsent", () => {
    it("asks ONCE for a whole action, listing only its writes", async () => {
      const rpc = okRpc();
      (globalThis as BridgeHost).quaeroRpc = rpc;
      setConnGuard("c1", { mode: "confirm", engine: "mysql", name: "Prod" });
      const ask = vi.fn<ConfirmWrites>(async () => true);
      onConfirm(ask);
      const stmts = ["SELECT 1", "DELETE FROM a", "UPDATE b SET x = 1"];

      await withWriteConsent("c1", stmts, async () => {
        for (const sql of stmts) await call("query.run", { connId: "c1", sql });
        await call("row.delete", { connId: "c1", table: "t", where: {} });
      });

      expect(ask).toHaveBeenCalledOnce();
      expect(ask.mock.calls[0][1]).toEqual(["DELETE FROM a", "UPDATE b SET x = 1"]);
      expect(rpc).toHaveBeenCalledTimes(4);
      // The consent ends with the action.
      ask.mockResolvedValue(false);
      expect(isError(await call("query.run", { connId: "c1", sql: "DELETE FROM a" }))).toBe(true);
    });

    it("a nested action inside a confirmed one is not asked again", async () => {
      (globalThis as BridgeHost).quaeroRpc = okRpc();
      setConnGuard("c1", { mode: "confirm", engine: "mysql", name: "Prod" });
      const ask = vi.fn<ConfirmWrites>(async () => true);
      onConfirm(ask);
      await withWriteConsent("c1", ["DELETE FROM a"], () =>
        withWriteConsent("c1", ["DELETE FROM b"], async () => "done"),
      );
      expect(ask).toHaveBeenCalledOnce();
    });

    it("declined, the action never starts", async () => {
      setConnGuard("c1", { mode: "confirm", engine: "mysql", name: "Prod" });
      onConfirm(async () => false);
      const fn = vi.fn(async () => 1);
      await expect(withWriteConsent("c1", ["DROP TABLE t"], fn)).rejects.toMatchObject({
        code: SAFE_MODE_BLOCKED,
      });
      expect(fn).not.toHaveBeenCalled();
    });

    it("read-only refuses before the action sends anything", async () => {
      setConnGuard("c1", { mode: "readOnly", engine: "mysql", name: "Prod" });
      const ask = vi.fn<ConfirmWrites>(async () => true);
      onConfirm(ask);
      const fn = vi.fn(async () => 1);
      await expect(withWriteConsent("c1", ["SELECT 1", "DROP TABLE t"], fn)).rejects.toThrow(/Prod/);
      expect(fn).not.toHaveBeenCalled();
      expect(ask).not.toHaveBeenCalled();
    });

    it("withConfirmedWrites: the caller's own dialog confirmed, the guard does not ask", async () => {
      const rpc = okRpc();
      (globalThis as BridgeHost).quaeroRpc = rpc;
      setConnGuard("c1", { mode: "confirm", engine: "mysql", name: "Prod" });
      const ask = vi.fn<ConfirmWrites>(async () => false);
      onConfirm(ask);
      const res = await withConfirmedWrites("c1", () => call("query.run", { connId: "c1", sql: "DROP TABLE t" }));
      expect(isError(res)).toBe(false);
      expect(ask).not.toHaveBeenCalled();
      // Only for that action.
      expect(isError(await call("query.run", { connId: "c1", sql: "DROP TABLE t" }))).toBe(true);
    });

    it("withConfirmedWrites never opens a read-only connection", async () => {
      const rpc = okRpc();
      (globalThis as BridgeHost).quaeroRpc = rpc;
      setConnGuard("c1", { mode: "readOnly", engine: "mysql", name: "Prod" });
      const res = await withConfirmedWrites("c1", () => call("query.run", { connId: "c1", sql: "DROP TABLE t" }));
      expect(isError(res)).toBe(true);
      expect(rpc).not.toHaveBeenCalled();
    });

    it("reads only, or an unprotected connection: just runs", async () => {
      const fn = vi.fn(async () => 7);
      expect(await withWriteConsent("c1", ["DROP TABLE t"], fn)).toBe(7);
      setConnGuard("c1", { mode: "readOnly", engine: "mysql", name: "Prod" });
      expect(await withWriteConsent("c1", ["SELECT 1", "USE x"], fn)).toBe(7);
    });
  });
});
