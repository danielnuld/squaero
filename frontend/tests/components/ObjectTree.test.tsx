import { describe, it, expect, afterEach } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { ObjectTree } from "../../src/components/ObjectTree";

// Drives the real object tree against a mocked bridge to check the refresh
// wiring (issue #107): bumping reloadKey re-fetches the tree from the root.

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

function installBridge() {
  const calls: { method: string; params: any }[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
    calls.push({ method: req.method, params: req.params });
    // schema.tree with no db => the root database list.
    return {
      jsonrpc: "2.0",
      id: req.id,
      result: {
        columns: [{ name: "name", type: "text" }],
        rows: [["main"]],
        truncated: false,
        rowsAffected: 0,
      },
    };
  };
  return calls;
}

describe("ObjectTree refresh", () => {
  it("re-fetches the root when reloadKey is bumped", async () => {
    const calls = installBridge();
    const [reload, setReload] = createSignal(0);
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <ObjectTree
            connId="c1"
            onOpenData={() => {}}
            onOpenStructure={() => {}}
            reloadKey={reload()}
            onRefresh={() => {}}
          />
        ),
        host!,
      );
    });

    await flush();
    const before = calls.filter((c) => c.method === "schema.tree").length;
    expect(before).toBe(1);
    expect(host!.textContent).toContain("main");

    setReload(1); // request a refresh
    await flush();
    const after = calls.filter((c) => c.method === "schema.tree").length;
    expect(after).toBe(2);
  });

  it("groups tables and views under type folders (#135)", async () => {
    const calls: { method: string; params: any }[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
      calls.push({ method: req.method, params: req.params });
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
      // Root => one database; expanding it => tables + a view (has a `type` col).
      if (!req.params.db) {
        return ok({ columns: [{ name: "name", type: "text" }], rows: [["main"]], truncated: false, rowsAffected: 0 });
      }
      return ok({
        columns: [{ name: "name", type: "text" }, { name: "type", type: "text" }],
        rows: [["customers", "table"], ["orders", "table"], ["v1", "view"]],
        truncated: false,
        rowsAffected: 0,
      });
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => <ObjectTree connId="c1" onOpenData={() => {}} onOpenStructure={() => {}} onRefresh={() => {}} />,
        host!,
      );
    });
    await flush();

    const rowByText = (t: string) =>
      [...host!.querySelectorAll(".objtree-row")].find((r) => r.textContent?.includes(t)) as HTMLElement;

    (rowByText("main")).click(); // expand the database
    await flush();
    // The leaf objects are behind Tablas/Vistas folders, not listed flat yet.
    expect(rowByText("Tablas")).toBeTruthy();
    expect(rowByText("Vistas")).toBeTruthy();
    expect(rowByText("customers")).toBeFalsy();

    (rowByText("Tablas")).click(); // expand the Tablas folder
    await flush();
    expect(rowByText("customers")).toBeTruthy();
    expect(rowByText("orders")).toBeTruthy();
  });

  it("shows a refresh button only with a connection + handler", () => {
    installBridge();
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <ObjectTree
            connId="c1"
            onOpenData={() => {}}
            onOpenStructure={() => {}}
            onRefresh={() => {}}
          />
        ),
        host!,
      );
    });
    expect(host!.querySelector(".objtree-refresh")).not.toBeNull();
  });
});
