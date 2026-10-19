import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { EditorView } from "@codemirror/view";
import { App } from "../../src/App";
import { openQueryTab } from "./appHelpers";

// Integration (issue #676): a session that dies under a call. utils/reconnect
// covers the policy and transport.call the re-send; this covers the WIRING — the
// fresh session replacing the dead one, the "reconnected" notice, and the
// explicit error when nothing is retried.
//
// The core is faked at the bridge (globalThis.quaeroRpc). Sessions in `dead`
// answer every query.run / tx.* with -32000 and the data the core would attach.

let calls: string[] = [];
let dead = new Set<string>();
let opened = 0;
let inTx = false;

const LOST_SQL_READ = /^\s*select\b/i;

const respond = (method: string, params: Record<string, unknown>) => {
  const connId = String(params.connId ?? "");
  if (method === "conn.open") {
    opened += 1;
    calls.push("conn.open");
    return { result: { connId: `c${opened}` } };
  }
  if (dead.has(connId) && (method === "query.run" || method.startsWith("tx."))) {
    calls.push(`${method}@${connId}`);
    const sql = String(params.sql ?? "");
    return {
      error: {
        code: -32000,
        message: "server closed the connection unexpectedly",
        data: {
          connLost: true,
          inTx,
          retrySafe: method === "query.run" && !inTx && LOST_SQL_READ.test(sql),
        },
      },
    };
  }
  switch (method) {
    case "query.run":
      calls.push(`query.run@${connId}`);
      return {
        result: { columns: [{ name: "n", type: "int" }], rows: [["42"]], rowsAffected: 0, truncated: false },
      };
    case "tx.begin":
      inTx = true;
      calls.push(`tx.begin@${connId}`);
      return { result: { ok: true } };
    case "schema.tree":
      return { result: { columns: [{ name: "name", type: "text" }], rows: [], rowsAffected: 0, truncated: false } };
    default:
      return { result: {} };
  }
};

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  calls = [];
  dead = new Set();
  opened = 0;
  inTx = false;
  localStorage.clear();
  localStorage.setItem(
    "quaero.connections",
    JSON.stringify([{ id: "k1", name: "local", driver: "sqlite", params: { path: ":memory:" } }]),
  );
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params?: Record<string, unknown> };
    return { jsonrpc: "2.0", id: req.id, ...respond(req.method, req.params ?? {}) };
  };
});

afterEach(() => {
  vi.useRealTimers();
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as Record<string, unknown>).quaeroRpc;
});

const settle = async () => {
  for (let k = 0; k < 3; k++) {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  }
};

const click = (el: Element | null | undefined) => (el as HTMLElement).click();

const connect = async () => {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
  click(host.querySelector(".connbar-add"));
  click(host.querySelector(".connsearch-hit"));
  await settle();
  // Connecting lands on the connection's home (#694); open a query tab.
  openQueryTab(host);
  await settle();
};

const runSql = async (sql: string) => {
  const view = EditorView.findFromDOM(host!)!;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: sql } });
  click(host!.querySelector(".editor-run-main"));
  await settle();
};

const text = () => host!.textContent ?? "";

describe("App — automatic reconnection (issue #676)", () => {
  it("replaces a dead session and re-runs a read on the new one", async () => {
    await connect();
    dead.add("c1");
    calls = [];
    await runSql("SELECT 42 AS n");
    // The read met the dead session, a fresh one opened, and it ran there once.
    expect(calls.filter((c) => c !== "conn.close")).toEqual(["query.run@c1", "conn.open", "query.run@c2"]);
    expect(text()).toContain("42");
    // The bar says so, for a moment, where the "connected" dot was.
    expect(host!.querySelector(".connbar-reconnecting")?.textContent).toBe("reconectada");
    expect(host!.querySelector(".connbar-lost")).toBeNull();
    // The next statement goes straight to the new session.
    calls = [];
    await runSql("SELECT 1 AS n");
    expect(calls).toEqual(["query.run@c2"]);
  });

  it("reconnects but does not re-run a write, and says it may have run", async () => {
    await connect();
    dead.add("c1");
    calls = [];
    await runSql("UPDATE t SET a = 1");
    expect(calls.filter((c) => c !== "conn.close")).toEqual(["query.run@c1", "conn.open"]);
    expect(text()).toContain("pudo haberse ejecutado o no");
    expect(host!.querySelector(".connbar-lost")).toBeNull();
  });

  it("never reconnects with a transaction open: marked lost, and says it was rolled back", async () => {
    await connect();
    await runSql("BEGIN");
    dead.add("c1");
    calls = [];
    await runSql("SELECT 42 AS n");
    expect(calls).toEqual(["query.run@c1"]); // no conn.open, no re-send
    expect(text()).toContain("transacción abierta");
    expect(host!.querySelector(".connbar-lost")).not.toBeNull();
  });
});

describe("App — keep-alive (issue #676)", () => {
  // Only the interval and the clock are faked: settle() still needs setTimeout.
  const advance = async (ms: number) => {
    vi.advanceTimersByTime(ms);
    await settle();
  };

  it("probes an idle session, and a dropped one is replaced by itself", async () => {
    localStorage.setItem(
      "quaero.connections",
      JSON.stringify([
        { id: "k1", name: "remote", driver: "mysql", params: { host: "db" }, keepAlive: 30 },
      ]),
    );
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    await connect();
    calls = [];
    await advance(10_000);
    expect(calls).toEqual([]); // quiet for less than the interval
    await advance(21_000);
    expect(calls).toEqual(["query.run@c1"]);

    // The server drops the session while idle: the next probe finds it dead,
    // a fresh session opens, and the probe (a read) runs again there.
    dead.add("c1");
    calls = [];
    await advance(31_000);
    expect(calls.filter((c) => c !== "conn.close")).toEqual(["query.run@c1", "conn.open", "query.run@c2"]);
    expect(host!.querySelector(".connbar-lost")).toBeNull();
  });

  it("sends nothing when keep-alive is off", async () => {
    localStorage.setItem(
      "quaero.connections",
      JSON.stringify([{ id: "k1", name: "remote", driver: "mysql", params: { host: "db" } }]),
    );
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    await connect();
    calls = [];
    await advance(3_600_000);
    expect(calls).toEqual([]);
  });
});
