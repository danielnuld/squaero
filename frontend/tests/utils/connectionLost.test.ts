import { describe, it, expect, afterEach, vi } from "vitest";
import { connIdOfParams, IPC_ERR_CONN } from "../../src/utils/ipc";
import { call, connActivity, onConnectionLost, type BridgeHost } from "../../src/utils/transport";

// A dead connection and a bad statement both come back as a failed call, and the
// app could not react differently to something it could not tell apart (issue
// #407). The distinction is made once, in call(), so every method inherits it.

afterEach(() => {
  onConnectionLost(null);
  delete (globalThis as BridgeHost).quaeroRpc;
});

/** A bridge that answers every call with `error`, or with a bare result. */
function bridge(error?: { code: number; message: string }) {
  (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number };
    return error
      ? { jsonrpc: "2.0", id: req.id, error }
      : { jsonrpc: "2.0", id: req.id, result: {} };
  };
}

describe("connIdOfParams", () => {
  it("reads the connection a request is about", () => {
    expect(connIdOfParams({ connId: "c1", sql: "SELECT 1" })).toBe("c1");
  });

  it("is null when there is none to read", () => {
    expect(connIdOfParams(undefined)).toBeNull();
    expect(connIdOfParams(null)).toBeNull();
    expect(connIdOfParams({})).toBeNull();
    expect(connIdOfParams({ connId: "" })).toBeNull();
    expect(connIdOfParams({ connId: 7 })).toBeNull();
    expect(connIdOfParams("c1")).toBeNull();
  });
});

describe("the connection-lost signal", () => {
  it("fires for a query that failed because the connection is gone", async () => {
    bridge({ code: IPC_ERR_CONN, message: "server has gone away" });
    const lost = vi.fn();
    onConnectionLost(lost);
    await call("query.run", { connId: "c1", sql: "SELECT 1" });
    // The second argument is the core's error data (none from this bridge).
    expect(lost).toHaveBeenCalledWith("c1", undefined);
  });

  it("fires for every other method too, not just queries", async () => {
    bridge({ code: IPC_ERR_CONN, message: "gone" });
    const lost = vi.fn();
    onConnectionLost(lost);
    // The point of putting this in call(): a commit, a row write and a catalog
    // read cannot forget to report it.
    for (const m of ["tx.commit", "row.update", "schema.describe", "conn.close"]) {
      await call(m, { connId: "c9" });
    }
    expect(lost).toHaveBeenCalledTimes(4);
  });

  it("does NOT fire for conn.open, where the same code means it never opened", async () => {
    bridge({ code: IPC_ERR_CONN, message: "could not connect" });
    const lost = vi.fn();
    onConnectionLost(lost);
    await call("conn.open", { driver: "mysql", dsn: {} });
    expect(lost).not.toHaveBeenCalled();
  });

  it("does NOT fire for an ordinary query error", async () => {
    // -32003: the SQL was wrong. Sending the user to reconnect over a typo is
    // the failure this whole thing has to avoid.
    bridge({ code: -32003, message: "syntax error" });
    const lost = vi.fn();
    onConnectionLost(lost);
    await call("query.run", { connId: "c1", sql: "SELEKT 1" });
    expect(lost).not.toHaveBeenCalled();
  });

  it("does NOT fire on success", async () => {
    bridge();
    const lost = vi.fn();
    onConnectionLost(lost);
    await call("query.run", { connId: "c1", sql: "SELECT 1" });
    expect(lost).not.toHaveBeenCalled();
  });

  it("stays quiet when the failing call named no connection", async () => {
    bridge({ code: IPC_ERR_CONN, message: "gone" });
    const lost = vi.fn();
    onConnectionLost(lost);
    await call("app.hello");
    expect(lost).not.toHaveBeenCalled();
  });

  it("still returns the response, so callers keep handling the error", async () => {
    bridge({ code: IPC_ERR_CONN, message: "gone" });
    onConnectionLost(() => {});
    const res = await call("query.run", { connId: "c1" });
    expect("error" in res && res.error.code).toBe(IPC_ERR_CONN);
  });

  it("can be unregistered", async () => {
    bridge({ code: IPC_ERR_CONN, message: "gone" });
    const lost = vi.fn();
    onConnectionLost(lost);
    onConnectionLost(null);
    await call("query.run", { connId: "c1" });
    expect(lost).not.toHaveBeenCalled();
  });
});

// Automatic reconnection (issue #676): the listener reopens the session, and
// call() re-sends the failed call once on it — only when the core proved it safe.
describe("retry after a reconnect", () => {
  type Req = { id: number; method: string; params: { connId?: string } };
  const LOST = (data?: object) => ({ code: IPC_ERR_CONN, message: "server closed the connection", data });
  const SAFE = { connLost: true, inTx: false, retrySafe: true };
  const UNSAFE = { connLost: true, inTx: false, retrySafe: false };

  /** Every call on a connection in `dead` fails with `lostErr`; others succeed.
      Returns the requests seen. */
  function server(dead: Set<string>, lostErr: object) {
    const seen: Req[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as Req;
      seen.push(req);
      return dead.has(req.params?.connId ?? "")
        ? { jsonrpc: "2.0", id: req.id, error: lostErr }
        : { jsonrpc: "2.0", id: req.id, result: { rows: [[1]] } };
    };
    return seen;
  }

  it("re-sends a retry-safe call once on the new session", async () => {
    const seen = server(new Set(["c1"]), LOST(SAFE));
    onConnectionLost(async () => ({ reconnectedTo: "c2", txLost: false }));
    const res = await call("query.run", { connId: "c1", sql: "SELECT 1" });
    expect("result" in res).toBe(true);
    expect(seen.map((r) => r.params.connId)).toEqual(["c1", "c2"]);
  });

  it("does not re-send what the core did not prove safe, and says why", async () => {
    const seen = server(new Set(["c1"]), LOST(UNSAFE));
    onConnectionLost(async () => ({ reconnectedTo: "c2", txLost: false }));
    const res = await call("query.run", { connId: "c1", sql: "UPDATE t SET x = 1" });
    expect(seen).toHaveLength(1);
    expect("error" in res && res.error.data).toEqual({ ...UNSAFE, notRetried: "unsafe" });
  });

  it("does not retry when the transaction died with the session", async () => {
    const seen = server(new Set(["c1"]), LOST({ connLost: true, inTx: true, retrySafe: false }));
    onConnectionLost(async () => ({ reconnectedTo: null, txLost: true }));
    const res = await call("query.run", { connId: "c1", sql: "SELECT 1" });
    expect(seen).toHaveLength(1);
    expect("error" in res && (res.error.data as { notRetried: string }).notRetried).toBe("tx");
  });

  it("retries at most once, even if the new session dies too", async () => {
    const seen = server(new Set(["c1", "c2", "c3"]), LOST(SAFE));
    let next = 2;
    onConnectionLost(async () => ({ reconnectedTo: `c${next++}`, txLost: false }));
    const res = await call("query.run", { connId: "c1", sql: "SELECT 1" });
    expect(seen.map((r) => r.params.connId)).toEqual(["c1", "c2"]);
    expect("error" in res && (res.error.data as { notRetried: string }).notRetried).toBe("unsafe");
  });

  it("an older core (no data) is never retried", async () => {
    const seen = server(new Set(["c1"]), LOST());
    onConnectionLost(async () => ({ reconnectedTo: "c2", txLost: false }));
    const res = await call("query.run", { connId: "c1", sql: "SELECT 1" });
    expect(seen).toHaveLength(1);
    expect("error" in res && res.error.data).toEqual({ notRetried: "unsafe" });
  });

  it("a listener that does not reconnect leaves the call failed as 'down'", async () => {
    server(new Set(["c1"]), LOST(SAFE));
    onConnectionLost(() => {});
    const res = await call("query.run", { connId: "c1", sql: "SELECT 1" });
    expect("error" in res && (res.error.data as { notRetried: string }).notRetried).toBe("down");
  });
});

describe("connection activity (keep-alive input)", () => {
  it("counts calls in flight and when the last one happened", async () => {
    let release: () => void = () => {};
    (globalThis as BridgeHost).quaeroRpc = (raw: string) =>
      new Promise((resolve) => {
        const req = JSON.parse(raw) as { id: number };
        release = () => resolve({ jsonrpc: "2.0", id: req.id, result: {} });
      });
    expect(connActivity("k1")).toEqual({ inFlight: 0, last: 0 });
    const before = Date.now();
    const pending = call("query.run", { connId: "k1", sql: "SELECT 1" });
    expect(connActivity("k1").inFlight).toBe(1);
    expect(connActivity("k1").last).toBeGreaterThanOrEqual(before);
    release();
    await pending;
    expect(connActivity("k1").inFlight).toBe(0);
  });

  it("forgets a connection once it is closed", async () => {
    bridge();
    await call("query.run", { connId: "k2", sql: "SELECT 1" });
    expect(connActivity("k2").last).toBeGreaterThan(0);
    await call("conn.close", { connId: "k2" });
    expect(connActivity("k2")).toEqual({ inFlight: 0, last: 0 });
  });
});
