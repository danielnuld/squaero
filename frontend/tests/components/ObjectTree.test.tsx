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

  it("shows lazy object-type folders and opens a routine's DDL (#135 phase 2)", async () => {
    const calls: { method: string; sql?: string }[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
      if (req.method === "schema.tree") {
        calls.push({ method: "schema.tree" });
        if (!req.params.db)
          return ok({ columns: [{ name: "name", type: "text" }], rows: [["main"]], truncated: false, rowsAffected: 0 });
        return ok({
          columns: [{ name: "name", type: "text" }, { name: "type", type: "text" }],
          rows: [["customers", "table"]],
          truncated: false,
          rowsAffected: 0,
        });
      }
      const sql = req.params.sql ?? "";
      calls.push({ method: "query.run", sql });
      if (sql.includes("information_schema.ROUTINES"))
        return ok({
          columns: [{ name: "ROUTINE_NAME", type: "text" }, { name: "ROUTINE_TYPE", type: "text" }],
          rows: [["add_user", "PROCEDURE"], ["tax_rate", "FUNCTION"]],
          truncated: false,
          rowsAffected: 0,
        });
      if (sql.startsWith("SHOW CREATE PROCEDURE"))
        return ok({
          columns: [{ name: "Procedure", type: "text" }, { name: "Create Procedure", type: "text" }],
          rows: [["add_user", "CREATE PROCEDURE `add_user`() BEGIN END"]],
          truncated: false,
          rowsAffected: 0,
        });
      return ok({ columns: [], rows: [], truncated: false, rowsAffected: 0 });
    };

    const opened: string[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <ObjectTree
            connId="c1"
            engine="mysql"
            onOpenData={() => {}}
            onOpenStructure={() => {}}
            onOpenSql={(sql) => opened.push(sql)}
            onRefresh={() => {}}
          />
        ),
        host!,
      );
    });
    await flush();

    const rowByText = (t: string) =>
      [...host!.querySelectorAll(".objtree-row")].find((r) => r.textContent?.includes(t)) as HTMLElement;

    rowByText("main").click(); // expand database -> Tablas + lazy folders
    await flush();
    expect(rowByText("Procedimientos")).toBeTruthy();
    expect(rowByText("Funciones")).toBeTruthy();
    expect(rowByText("Triggers")).toBeTruthy();
    expect(rowByText("Eventos")).toBeTruthy();
    // Members are not listed until the folder is expanded.
    expect(rowByText("add_user")).toBeFalsy();

    rowByText("Procedimientos").click(); // lazy-list the routines, filtered to PROCEDURE
    await flush();
    expect(rowByText("add_user")).toBeTruthy();
    expect(rowByText("tax_rate")).toBeFalsy(); // a FUNCTION, not in Procedimientos

    rowByText("add_user").click(); // open its DDL in a new query tab
    await flush();
    const ddlCall = calls.find((c) => c.sql?.startsWith("SHOW CREATE PROCEDURE"));
    expect(ddlCall!.sql).toBe("SHOW CREATE PROCEDURE `add_user`");
    expect(opened[0]).toContain("CREATE PROCEDURE");
  });

  it("opens a SQLite trigger's inline DDL without a definition query", async () => {
    const calls: { method: string; sql?: string }[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
      if (req.method === "schema.tree") {
        calls.push({ method: "schema.tree" });
        if (!req.params.db)
          return ok({ columns: [{ name: "name", type: "text" }], rows: [["main"]], truncated: false, rowsAffected: 0 });
        return ok({
          columns: [{ name: "name", type: "text" }, { name: "type", type: "text" }],
          rows: [["t1", "table"]],
          truncated: false,
          rowsAffected: 0,
        });
      }
      const sql = req.params.sql ?? "";
      calls.push({ method: "query.run", sql });
      if (sql.includes("sqlite_master"))
        return ok({
          columns: [
            { name: "name", type: "text" },
            { name: "table", type: "text" },
            { name: "sql", type: "text" },
          ],
          rows: [["trg_x", "t1", "CREATE TRIGGER trg_x AFTER INSERT ON t1 BEGIN SELECT 1; END"]],
          truncated: false,
          rowsAffected: 0,
        });
      return ok({ columns: [], rows: [], truncated: false, rowsAffected: 0 });
    };

    const opened: string[] = [];
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <ObjectTree
            connId="c1"
            engine="sqlite"
            onOpenData={() => {}}
            onOpenStructure={() => {}}
            onOpenSql={(sql) => opened.push(sql)}
            onRefresh={() => {}}
          />
        ),
        host!,
      );
    });
    await flush();

    const rowByText = (t: string) =>
      [...host!.querySelectorAll(".objtree-row")].find((r) => r.textContent?.includes(t)) as HTMLElement;

    rowByText("main").click();
    await flush();
    rowByText("Triggers").click(); // one query.run: the sqlite_master listing
    await flush();
    const before = calls.filter((c) => c.method === "query.run").length;
    rowByText("trg_x").click(); // inline DDL — must NOT run another query
    await flush();
    expect(opened[0]).toContain("CREATE TRIGGER trg_x");
    expect(calls.filter((c) => c.method === "query.run").length).toBe(before);
  });

  it("discards a lazy folder listing that resolves after a connection switch", async () => {
    let releaseListing: (() => void) | null = null;
    const [connId, setConnId] = createSignal("c1");
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
      if (req.method === "schema.tree") {
        if (!req.params.db)
          return ok({ columns: [{ name: "name", type: "text" }], rows: [["main"]], truncated: false, rowsAffected: 0 });
        return ok({
          columns: [{ name: "name", type: "text" }, { name: "type", type: "text" }],
          rows: [["t1", "table"]],
          truncated: false,
          rowsAffected: 0,
        });
      }
      const sql = req.params.sql ?? "";
      if (sql.includes("information_schema.ROUTINES")) {
        // Hold the response until the test releases it (after the conn switch).
        await new Promise<void>((r) => (releaseListing = r));
        return ok({
          columns: [{ name: "ROUTINE_NAME", type: "text" }, { name: "ROUTINE_TYPE", type: "text" }],
          rows: [["stale_proc", "PROCEDURE"]],
          truncated: false,
          rowsAffected: 0,
        });
      }
      return ok({ columns: [], rows: [], truncated: false, rowsAffected: 0 });
    };

    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <ObjectTree
            connId={connId()}
            engine="mysql"
            onOpenData={() => {}}
            onOpenStructure={() => {}}
            onOpenSql={() => {}}
            onRefresh={() => {}}
          />
        ),
        host!,
      );
    });
    await flush();

    const rowByText = (t: string) =>
      [...host!.querySelectorAll(".objtree-row")].find((r) => r.textContent?.includes(t)) as
        | HTMLElement
        | undefined;

    rowByText("main")!.click();
    await flush();
    rowByText("Procedimientos")!.click(); // starts the (held) listing fetch
    await flush();

    setConnId("c2"); // switch connections while the listing is in flight
    await flush();
    releaseListing!(); // now the stale response lands
    await flush();

    // The stale connection's members must not appear in the new tree.
    expect(rowByText("stale_proc")).toBeUndefined();
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
