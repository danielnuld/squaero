import { describe, it, expect, afterEach, vi } from "vitest";
import { connIdOfParams, IPC_ERR_CONN } from "../../src/utils/ipc";
import { call, onConnectionLost, type BridgeHost } from "../../src/utils/transport";

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
    expect(lost).toHaveBeenCalledWith("c1");
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
