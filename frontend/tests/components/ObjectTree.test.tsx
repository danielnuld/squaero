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

    // A type folder shows a colored glyph icon + right-aligned count (move 2),
    // not a text badge; the count reflects its members (2 tables, 1 view).
    const tablasRow = rowByText("Tablas");
    expect(tablasRow.querySelector(".objtree-folder-ic")).toBeTruthy();
    expect(tablasRow.querySelector(".objtree-badge")).toBeFalsy();
    expect(tablasRow.querySelector(".objtree-count")?.textContent).toBe("2");
    expect(rowByText("Vistas").querySelector(".objtree-count")?.textContent).toBe("1");

    (rowByText("Tablas")).click(); // expand the Tablas folder
    await flush();
    expect(rowByText("customers")).toBeTruthy();
    expect(rowByText("orders")).toBeTruthy();

    // Unified iconography (#185): a table leaf carries the canonical TBL badge.
    const tblBadge = rowByText("customers").querySelector(".objtree-badge")!;
    expect(tblBadge.textContent).toBe("TBL");
    expect(tblBadge.classList.contains("kind-table")).toBe(true);

    (rowByText("Vistas")).click(); // expand the Vistas folder
    await flush();
    const vwBadge = rowByText("v1").querySelector(".objtree-badge")!;
    expect(vwBadge.textContent).toBe("VW");
    expect(vwBadge.classList.contains("kind-view")).toBe(true);
  });

  it("lifts loaded table/view leaves via onObjectsLoaded, excluding containers (#174)", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
      if (!req.params.db)
        return ok({ columns: [{ name: "name", type: "text" }], rows: [["main"]], truncated: false, rowsAffected: 0 });
      return ok({
        columns: [{ name: "name", type: "text" }, { name: "type", type: "text" }],
        rows: [["customers", "table"], ["orders", "table"], ["v1", "view"]],
        truncated: false,
        rowsAffected: 0,
      });
    };
    let loaded: { label: string; kind: string }[] = [];
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
            onObjectsLoaded={(nodes) => (loaded = nodes.map((n) => ({ label: n.label, kind: n.kind })))}
          />
        ),
        host!,
      );
    });
    await flush();

    const rowByText = (t: string) =>
      [...host!.querySelectorAll(".objtree-row")].find((r) => r.textContent?.includes(t)) as HTMLElement;

    rowByText("main").click(); // expand db -> pre-loads the table/view leaves under folders
    await flush();

    // The two tables and the view are lifted; the "main" database container and
    // the Tablas/Vistas group folders are not.
    expect(loaded.map((n) => n.label).sort()).toEqual(["customers", "orders", "v1"]);
    expect(loaded.every((n) => n.kind === "table" || n.kind === "view")).toBe(true);
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

    // Unified iconography (#185): the routine leaf refines its badge to PROC.
    // Per-type colours (design proposal): a procedure carries the kind-procedure hue class.
    const procBadge = rowByText("add_user").querySelector(".objtree-badge")!;
    expect(procBadge.textContent).toBe("PROC");
    expect(procBadge.classList.contains("kind-procedure")).toBe(true);

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

  it("filters visible nodes by text and restores on clear (#175)", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
      if (!req.params.db) return ok({ columns: [{ name: "name", type: "text" }], rows: [["main"]], truncated: false, rowsAffected: 0 });
      return ok({
        columns: [{ name: "name", type: "text" }, { name: "type", type: "text" }],
        rows: [["customers", "table"], ["orders", "table"], ["products", "table"]],
        truncated: false,
        rowsAffected: 0,
      });
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <ObjectTree connId="c1" onOpenData={() => {}} onOpenStructure={() => {}} onRefresh={() => {}} />, host!);
    });
    await flush();

    const rowByText = (t: string) =>
      [...host!.querySelectorAll(".objtree-row")].find((r) => r.textContent?.includes(t)) as HTMLElement | undefined;

    rowByText("main")!.click(); // expand db -> Tablas folder
    await flush();
    rowByText("Tablas")!.click(); // load the leaves
    await flush();
    expect(rowByText("customers")).toBeTruthy();
    expect(rowByText("orders")).toBeTruthy();

    // Type a filter: only "orders" matches (ancestors main + Tablas stay visible).
    const input = host!.querySelector(".objtree-filter-input") as HTMLInputElement;
    input.value = "order";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(rowByText("orders")).toBeTruthy();
    expect(rowByText("customers")).toBeFalsy();
    expect(rowByText("products")).toBeFalsy();
    expect(rowByText("main")).toBeTruthy();

    // Clear the filter -> the full expanded tree is back.
    (host!.querySelector(".objtree-filter-clear") as HTMLButtonElement).click();
    await flush();
    expect(rowByText("customers")).toBeTruthy();
    expect(rowByText("products")).toBeTruthy();
  });

  it("clicking a force-expanded ancestor while filtering does not corrupt the restored expansion (#175)", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
      if (!req.params.db) return ok({ columns: [{ name: "name", type: "text" }], rows: [["main"]], truncated: false, rowsAffected: 0 });
      return ok({
        columns: [{ name: "name", type: "text" }, { name: "type", type: "text" }],
        rows: [["customers", "table"], ["orders", "table"]],
        truncated: false,
        rowsAffected: 0,
      });
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <ObjectTree connId="c1" onOpenData={() => {}} onOpenStructure={() => {}} onRefresh={() => {}} />, host!);
    });
    await flush();

    const rowByText = (t: string) =>
      [...host!.querySelectorAll(".objtree-row")].find((r) => r.textContent?.includes(t)) as HTMLElement | undefined;

    rowByText("main")!.click(); // expand db
    await flush();
    rowByText("Tablas")!.click(); // load + expand the folder (children now cached)
    await flush();
    rowByText("Tablas")!.click(); // collapse it again
    await flush();
    expect(rowByText("customers")).toBeFalsy(); // collapsed

    // Filter reveals a nested match; "Tablas" is force-expanded in the view.
    const input = host!.querySelector(".objtree-filter-input") as HTMLInputElement;
    input.value = "order";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await flush();
    expect(rowByText("orders")).toBeTruthy();

    // Click the force-expanded "Tablas" row while filtering — must NOT toggle
    // the real expansion state.
    rowByText("Tablas")!.click();
    await flush();

    // Clear the filter: "Tablas" must still be collapsed as before.
    (host!.querySelector(".objtree-filter-clear") as HTMLButtonElement).click();
    await flush();
    expect(rowByText("Tablas")).toBeTruthy();
    expect(rowByText("customers")).toBeFalsy();
    expect(rowByText("orders")).toBeFalsy();
  });

  it("selects the working database when a db node is clicked", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
      if (!req.params.db)
        return ok({
          columns: [{ name: "name", type: "text" }],
          rows: [["shop"], ["analytics"]],
          truncated: false,
          rowsAffected: 0,
        });
      return ok({ columns: [{ name: "name", type: "text" }], rows: [], truncated: false, rowsAffected: 0 });
    };
    const selected: string[] = [];
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
            onSelectDatabase={(name) => selected.push(name)}
          />
        ),
        host!,
      );
    });
    await flush();

    const rowByText = (t: string) =>
      [...host!.querySelectorAll(".objtree-row")].find((r) => r.textContent?.includes(t)) as HTMLElement;

    rowByText("analytics").click();
    await flush();
    expect(selected).toContain("analytics");
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

  it("highlights the working-database node via activeDb (sidebar visual pass)", async () => {
    installBridge(); // root db list => ["main"]
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
            activeDb="main"
          />
        ),
        host!,
      );
    });
    await flush();

    const row = [...host!.querySelectorAll(".objtree-row")].find((r) =>
      r.textContent?.includes("main"),
    ) as HTMLElement;
    expect(row.classList.contains("is-active")).toBe(true);
  });

  it("does not mark any node active when activeDb does not match", async () => {
    installBridge(); // root db list => ["main"]
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
            activeDb="other"
          />
        ),
        host!,
      );
    });
    await flush();

    expect(host!.querySelector(".objtree-row.is-active")).toBeNull();
  });
});
