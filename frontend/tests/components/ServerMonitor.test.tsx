import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ServerMonitor } from "../../src/components/ServerMonitor";

// Drives the real ServerMonitor in jsdom against a mocked bridge: it runs the
// per-engine process-list query, renders the sessions, kills one, and shows the
// honest message for an unsupported engine.

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

const flush = () => new Promise((r) => setTimeout(r, 0));

function processListResult(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      columns: [
        { name: "Id", type: "int" },
        { name: "User", type: "text" },
        { name: "Command", type: "text" },
        { name: "Info", type: "text" },
      ],
      rows: [
        ["7", "root", "Query", "SELECT * FROM big"],
        ["8", "app", "Sleep", null],
      ],
      truncated: false,
      rowsAffected: 0,
    },
  };
}

function installBridge() {
  const calls: { method: string; params: unknown }[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as { id: number; method: string; params: { sql?: string } };
    calls.push({ method: req.method, params: req.params });
    if (req.method === "query.run") {
      const sql = req.params.sql ?? "";
      if (sql.startsWith("KILL")) {
        return { jsonrpc: "2.0", id: req.id, result: { columns: [], rows: [], truncated: false, rowsAffected: 1 } };
      }
      return processListResult(req.id);
    }
    return { jsonrpc: "2.0", id: req.id, result: {} };
  };
  return calls;
}

function mount(engine: string) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const onClose = vi.fn();
  createRoot((d) => {
    dispose = d;
    render(() => <ServerMonitor connId="c1" engine={engine} onClose={onClose} />, host!);
  });
  return { onClose };
}

describe("ServerMonitor", () => {
  it("lists processes for MySQL and shows the session count", async () => {
    const calls = installBridge();
    mount("mysql");
    await flush();
    // The list query ran with SHOW PROCESSLIST.
    const listCall = calls.find((c) => c.method === "query.run");
    expect((listCall!.params as { sql: string }).sql).toContain("PROCESSLIST");
    // Two session rows + the count metric.
    expect(host!.querySelectorAll(".sm-table tbody tr").length).toBe(2);
    expect(host!.textContent).toContain("2 sesión");
    // A kill button per row (canKill).
    expect(host!.querySelectorAll(".sm-kill").length).toBe(2);
  });

  it("kills a session with KILL <id> then refreshes", async () => {
    const calls = installBridge();
    mount("mysql");
    await flush();
    const killBtn = host!.querySelector<HTMLButtonElement>(".sm-kill")!;
    killBtn.click();
    await flush();
    const killCall = calls.find(
      (c) => c.method === "query.run" && (c.params as { sql: string }).sql.startsWith("KILL"),
    );
    expect((killCall!.params as { sql: string }).sql).toBe("KILL 7");
    // A reload (another list query) followed the kill.
    const listCalls = calls.filter(
      (c) => c.method === "query.run" && (c.params as { sql: string }).sql.includes("PROCESSLIST"),
    );
    expect(listCalls.length).toBe(2);
  });

  it("shows an honest message and no query for an unsupported engine", async () => {
    const calls = installBridge();
    mount("sqlite");
    await flush();
    expect(host!.textContent).toContain("embebida");
    expect(calls.filter((c) => c.method === "query.run").length).toBe(0);
    expect(host!.querySelector(".sm-table")).toBeNull();
  });
});
