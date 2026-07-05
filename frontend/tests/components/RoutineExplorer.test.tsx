import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { RoutineExplorer } from "../../src/components/RoutineExplorer";

// Drives the real RoutineExplorer in jsdom against a mocked bridge: it lists the
// routines from the catalog, selects one to fetch and render its definition,
// opens that DDL in a new tab, and shows the honest message for an unsupported
// engine.

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
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

function listResult(id: number, names: [string, string, string | null][]) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      columns: [
        { name: "ROUTINE_NAME", type: "text" },
        { name: "ROUTINE_TYPE", type: "text" },
        { name: "DATA_TYPE", type: "text" },
      ],
      rows: names,
      truncated: false,
      rowsAffected: 0,
    },
  };
}

const DEFAULT_ROWS: [string, string, string | null][] = [
  ["add_user", "PROCEDURE", null],
  ["tax_rate", "FUNCTION", "decimal"],
];

function ddlResult(id: number, kind: string, name: string) {
  const col = kind === "FUNCTION" ? "Create Function" : "Create Procedure";
  return {
    jsonrpc: "2.0",
    id,
    result: {
      columns: [
        { name: kind === "FUNCTION" ? "Function" : "Procedure", type: "text" },
        { name: col, type: "text" },
      ],
      rows: [[name, `CREATE ${kind} \`${name}\`() BEGIN END`]],
      truncated: false,
      rowsAffected: 0,
    },
  };
}

interface BridgeOpts {
  /** ms delay before SHOW CREATE PROCEDURE resolves (to force a select race). */
  procDelay?: number;
  /** rows returned by the list query, keyed by connId. */
  rowsByConn?: Record<string, [string, string, string | null][]>;
}

function installBridge(opts: BridgeOpts = {}) {
  const calls: { sql: string; connId: string }[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as {
      id: number;
      method: string;
      params: { sql?: string; connId?: string };
    };
    if (req.method !== "query.run") return { jsonrpc: "2.0", id: req.id, result: {} };
    const sql = req.params.sql ?? "";
    const connId = req.params.connId ?? "";
    calls.push({ sql, connId });
    if (sql.startsWith("SHOW CREATE PROCEDURE")) {
      if (opts.procDelay) await wait(opts.procDelay);
      return ddlResult(req.id, "PROCEDURE", "add_user");
    }
    if (sql.startsWith("SHOW CREATE FUNCTION")) return ddlResult(req.id, "FUNCTION", "tax_rate");
    const rows = opts.rowsByConn?.[connId] ?? DEFAULT_ROWS;
    return listResult(req.id, rows);
  };
  return calls;
}

function mount(engine: string, onOpenSql = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const onClose = vi.fn();
  const [connId, setConnId] = createSignal("c1");
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <RoutineExplorer
          connId={connId()}
          engine={engine}
          db="testdb"
          onOpenSql={onOpenSql}
          onClose={onClose}
        />
      ),
      host!,
    );
  });
  return { onClose, onOpenSql, setConnId };
}

describe("RoutineExplorer", () => {
  it("lists routines for MySQL and shows the object count", async () => {
    const calls = installBridge();
    mount("mysql");
    await flush();
    expect(calls[0].sql).toContain("information_schema.ROUTINES");
    expect(host!.querySelectorAll(".routine-item").length).toBe(2);
    expect(host!.textContent).toContain("2 objeto");
  });

  it("fetches and renders a routine's definition when selected", async () => {
    const calls = installBridge();
    mount("mysql");
    await flush();
    const items = host!.querySelectorAll<HTMLButtonElement>(".routine-item");
    items[0].click(); // add_user (PROCEDURE)
    await flush();
    const ddlCall = calls.find((c) => c.sql.startsWith("SHOW CREATE PROCEDURE"));
    expect(ddlCall!.sql).toBe("SHOW CREATE PROCEDURE `add_user`");
    expect(host!.querySelector(".routine-ddl")!.textContent).toContain("CREATE PROCEDURE");
  });

  it("opens the definition in a new tab via onOpenSql", async () => {
    installBridge();
    const onOpenSql = vi.fn();
    mount("mysql", onOpenSql);
    await flush();
    host!.querySelectorAll<HTMLButtonElement>(".routine-item")[1].click(); // tax_rate
    await flush();
    const openBtn = [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Abrir en editor",
    )!;
    openBtn.click();
    expect(onOpenSql).toHaveBeenCalledOnce();
    expect(onOpenSql.mock.calls[0][0]).toContain("CREATE FUNCTION");
  });

  it("shows an honest message and runs no query for an unsupported engine", async () => {
    const calls = installBridge();
    mount("sqlite");
    await flush();
    expect(host!.textContent).toContain("embebida");
    expect(calls.length).toBe(0);
    expect(host!.querySelector(".routine-item")).toBeNull();
  });

  it("reloads the list when the connection prop changes on the mounted tab", async () => {
    const calls = installBridge({
      rowsByConn: {
        c1: [["proc_a", "PROCEDURE", null]],
        c2: [["fn_b", "FUNCTION", "int"], ["fn_c", "FUNCTION", "int"]],
      },
    });
    const { setConnId } = mount("mysql");
    await flush();
    expect([...host!.querySelectorAll(".routine-name")].map((n) => n.textContent)).toEqual([
      "proc_a",
    ]);

    // Switch the active connection under the still-mounted tab.
    setConnId("c2");
    await flush();
    expect([...host!.querySelectorAll(".routine-name")].map((n) => n.textContent)).toEqual([
      "fn_b",
      "fn_c",
    ]);
    // Both connections were queried (initial + after the prop change).
    const listCalls = calls.filter((c) => c.sql.includes("information_schema.ROUTINES"));
    expect(listCalls.map((c) => c.connId)).toEqual(["c1", "c2"]);
  });

  it("reassembles an Informix definition from sysprocbody pinned to procid", async () => {
    const calls: { sql: string }[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: { sql?: string } };
      if (req.method !== "query.run") return { jsonrpc: "2.0", id: req.id, result: {} };
      const sql = req.params.sql ?? "";
      calls.push({ sql });
      if (sql.includes("sysprocbody")) {
        // Definition split across ordered text fragments (datakey 'T').
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            columns: [{ name: "data", type: "text" }],
            rows: [["CREATE PROCEDURE p_overload()\n"], ["  RETURN;\nEND PROCEDURE;"]],
            truncated: false,
            rowsAffected: 0,
          },
        };
      }
      // sysprocedures listing carrying procid.
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          columns: [
            { name: "procid", type: "int" },
            { name: "name", type: "text" },
            { name: "type", type: "text" },
          ],
          rows: [["101", "p_overload", "PROCEDURE"]],
          truncated: false,
          rowsAffected: 0,
        },
      };
    };
    mount("informix");
    await flush();
    host!.querySelector<HTMLButtonElement>(".routine-item")!.click();
    await flush();
    const defCall = calls.find((c) => c.sql.includes("sysprocbody"))!;
    expect(defCall.sql).toContain("b.procid = 101"); // pinned to the exact overload
    // The two fragments are concatenated in seqno order into valid DDL.
    expect(host!.querySelector(".routine-ddl")!.textContent).toBe(
      "CREATE PROCEDURE p_overload()\n  RETURN;\nEND PROCEDURE;",
    );
  });

  it("keeps the latest selection's definition when an earlier fetch resolves late", async () => {
    installBridge({ procDelay: 40 });
    mount("mysql");
    await flush();
    const items = host!.querySelectorAll<HTMLButtonElement>(".routine-item");
    items[0].click(); // add_user (PROCEDURE) — slow response
    items[1].click(); // tax_rate (FUNCTION) — fast response
    await wait(80); // let the slow procedure response land last
    // The FUNCTION definition must win, not the late procedure response.
    expect(host!.querySelector(".routine-ddl")!.textContent).toContain("CREATE FUNCTION");
    expect(host!.querySelector(".routine-detail-head")!.textContent).toContain("tax_rate");
  });
});
