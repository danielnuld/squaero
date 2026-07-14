import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { App } from "../../src/App";

// Integration: a failed conn.open (bad credentials, host down…) must surface as
// a visible, dismissible toast. Before this, the error was written into the
// current tab's result pane — and with no tab open (the very first connect,
// exactly when credentials are usually wrong) it vanished without a trace.
//
// The core is faked at the bridge (globalThis.quaeroRpc), the same seam the
// webview binds — so App runs unmodified (see AppFkPicker.test.tsx).

/** When true, conn.open answers with a JSON-RPC domain error (-32000). */
let failConnect = true;

const rs = (columns: [string, string][], rows: (string | null)[][]) => ({
  columns: columns.map(([name, type]) => ({ name, type })),
  rows,
  rowsAffected: rows.length,
  truncated: false,
});

const answer = (method: string): unknown => {
  switch (method) {
    case "conn.open":
      return { connId: "c1" };
    case "schema.tree":
      return rs([["name", "text"]], [["testdb"]]);
    default:
      return {};
  }
};

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  failConnect = true;
  localStorage.clear();
  localStorage.setItem(
    "quaero.connections",
    JSON.stringify([{ id: "k1", name: "local", driver: "mysql", params: { host: "127.0.0.1" } }]),
  );
  (globalThis as Record<string, unknown>).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string };
    if (req.method === "conn.open" && failConnect) {
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32000, message: "Access denied for user 'root'@'localhost'" },
      };
    }
    return { jsonrpc: "2.0", id: req.id, result: answer(req.method) };
  };
});

afterEach(() => {
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as Record<string, unknown>).quaeroRpc;
});

/** Let every pending microtask/promise chain settle (the App's IPC is async). */
const settle = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

const click = (el: Element | null | undefined) => (el as HTMLElement).click();

function mountApp() {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <App />, host!);
  });
}

/** Open the connections popover and click the saved connection. */
const connect = async () => {
  click(host!.querySelector(".connbar-active"));
  click(host!.querySelector(".conn-list .conn-open"));
  await settle();
};

describe("App — connect failures are visible (toast)", () => {
  it("shows a toast with the connection name and the core's detail", async () => {
    mountApp();
    await connect();
    const toast = host!.querySelector(".app-toast-error");
    expect(toast, "a failed connect must show the error toast").not.toBeNull();
    expect(toast!.textContent).toContain('"local"');
    expect(toast!.textContent).toContain("Access denied for user 'root'@'localhost'");
    // And the connection bar does not claim to be connected.
    expect(host!.querySelector(".connbar-status")).toBeNull();
  });

  it("dismisses the toast with its close button", async () => {
    mountApp();
    await connect();
    click(host!.querySelector(".app-toast-close"));
    expect(host!.querySelector(".app-toast-error")).toBeNull();
  });

  it("clears the toast when a retry succeeds", async () => {
    mountApp();
    await connect();
    expect(host!.querySelector(".app-toast-error")).not.toBeNull();
    failConnect = false; // the user fixes the credentials / the server is back
    await connect();
    expect(host!.querySelector(".app-toast-error")).toBeNull();
    expect(host!.querySelector(".connbar-status")).not.toBeNull(); // now connected
  });
});
