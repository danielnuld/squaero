import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { SlowQueries } from "../../src/components/SlowQueries";
import { pickOption } from "./dropdownHarness";

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

// A bridge that records the SQL it runs and returns one slow-query row.
function installBridge(onSql?: (sql: string) => void) {
  const calls: string[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params: any };
    const sql = req.params?.sql ?? "";
    calls.push(sql);
    onSql?.(sql);
    return {
      jsonrpc: "2.0",
      id: req.id,
      result: {
        columns: [
          { name: "query", type: "text" },
          { name: "ejecuciones", type: "int" },
          { name: "avg_ms", type: "float" },
        ],
        rows: [["SELECT * FROM orders", "12", "820.5"]],
        truncated: false,
        rowsAffected: 0,
      },
    };
  };
  return calls;
}

function mount(over: {
  engine?: string;
  onOpenSql?: (s: string) => void;
  onExplain?: (s: string) => void;
} = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  const [engine] = createSignal(over.engine ?? "mysql");
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <SlowQueries
          connId="c1"
          engine={engine()}
          onOpenSql={over.onOpenSql ?? (() => {})}
          onExplain={over.onExplain ?? (() => {})}
          onClose={() => {}}
        />
      ),
      host!,
    );
  });
}

describe("SlowQueries", () => {
  it("loads the digest listing on mount and shows rows", async () => {
    const calls = installBridge();
    mount();
    await flush();
    expect(calls[0]).toContain("performance_schema.events_statements_summary_by_digest");
    expect(calls[0]).toContain("ORDER BY AVG_TIMER_WAIT DESC"); // default order = avg
    expect(host!.textContent).toContain("SELECT * FROM orders");
  });

  it("re-runs with a different ORDER BY when the order changes", async () => {
    const calls = installBridge();
    mount();
    await flush();
    pickOption(host!.querySelector(".dropdown")!, "total");
    await flush();
    expect(calls.some((s) => s.includes("ORDER BY SUM_TIMER_WAIT DESC"))).toBe(true);
  });

  // The per-row buttons became bar actions over the selected row (#372).
  const barButton = (label: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>(".panel-bar button")].find(
      (b) => b.textContent === label,
    )!;
  const selectFirstRow = () =>
    host!.querySelector<HTMLElement>(".grid-rows [role='gridcell']")!.click();

  it("opens the SELECTED row's statement in the editor", async () => {
    installBridge();
    const onOpenSql = vi.fn();
    mount({ onOpenSql });
    await flush();
    expect(barButton("Abrir").disabled).toBe(true); // nothing selected yet
    selectFirstRow();
    await flush();
    barButton("Abrir").click();
    expect(onOpenSql).toHaveBeenCalledWith("SELECT * FROM orders");
  });

  it("requests EXPLAIN for the SELECTED row's statement", async () => {
    installBridge();
    const onExplain = vi.fn();
    mount({ onExplain });
    await flush();
    selectFirstRow();
    await flush();
    barButton("EXPLAIN").click();
    expect(onExplain).toHaveBeenCalledWith("SELECT * FROM orders");
  });

  it("resets server stats then reloads", async () => {
    const calls = installBridge();
    mount();
    await flush();
    const reset = [...host!.querySelectorAll<HTMLButtonElement>(".edit-btn")].find(
      (b) => b.textContent?.includes("Reiniciar"),
    )!;
    reset.click();
    await flush();
    expect(calls.some((s) => s.startsWith("TRUNCATE performance_schema"))).toBe(true);
  });

  it("shows an honest reason and runs no query for an unsupported engine", async () => {
    const calls = installBridge();
    mount({ engine: "sqlite" });
    await flush();
    expect(host!.querySelector(".grid-empty")!.textContent).toContain("SQLite");
    expect(calls).toHaveLength(0);
  });

  it("clears the previous server's rows when the engine switches (no stale bleed)", async () => {
    // First engine resolves immediately; after the switch the second load is held
    // so we can observe that the old rows are gone before it resolves.
    let release: (() => void) | null = null;
    const [engine, setEngine] = createSignal("mysql");
    (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number; params: any };
      const sql = req.params?.sql ?? "";
      const ok = (rows: (string | null)[][]) => ({
        jsonrpc: "2.0",
        id: req.id,
        result: {
          columns: [{ name: "query", type: "text" }, { name: "avg_ms", type: "float" }],
          rows,
          truncated: false,
          rowsAffected: 0,
        },
      });
      if (sql.includes("pg_stat_statements")) {
        await new Promise<void>((r) => (release = r)); // hold the postgres load
        return ok([["SELECT 2", "5"]]);
      }
      return ok([["SELECT 1 FROM mysql_only", "999"]]);
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <SlowQueries connId="c1" engine={engine()} onOpenSql={() => {}} onExplain={() => {}} onClose={() => {}} />
        ),
        host!,
      );
    });
    await flush();
    expect(host!.textContent).toContain("mysql_only");

    setEngine("postgres"); // switch to a still-supported engine, load held
    await flush();
    // The previous server's rows must be gone even though the new load hasn't resolved.
    expect(host!.textContent).not.toContain("mysql_only");
    release!();
    await flush();
    expect(host!.textContent).toContain("SELECT 2");
  });

  it("surfaces the server error when the catalog is unavailable", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number };
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32000, message: "Table 'performance_schema...' doesn't exist" },
      };
    };
    mount();
    await flush();
    expect(host!.querySelector(".grid-error")!.textContent).toContain("performance_schema");
  });
});

// Issue #719: MongoDB's slow operations come from the profiler. The query cell
// is the profiled command; "Abrir" and EXPLAIN act on the mongosh statement
// rebuilt from it, and a hint says how to switch the profiler on.
describe("SlowQueries on MongoDB", () => {
  function mongoBridge(rows: (string | null)[][]) {
    const calls: string[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
      const req = JSON.parse(raw) as { id: number; method: string; params: any };
      calls.push(req.params?.sql ?? "");
      return {
        jsonrpc: "2.0",
        id: req.id,
        result: {
          // An empty aggregate has no documents, hence no columns.
          columns: rows.length === 0 ? [] : ["ns", "op", "query", "ejecuciones", "avg_ms", "total_ms", "max_ms"].map((name) => ({ name, type: "text" })),
          rows,
          truncated: false,
          rowsAffected: 0,
        },
      };
    };
    return calls;
  }
  const barButton = (label: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>(".panel-bar button")].find((b) => b.textContent === label)!;

  it("reads system.profile and opens the rebuilt statement", async () => {
    const calls = mongoBridge([
      ["shop.orders", "query", JSON.stringify({ find: "orders", filter: { total: { $gt: 5 } } }), "3", "12", "36", "20"],
    ]);
    const onOpenSql = vi.fn();
    const onExplain = vi.fn();
    mount({ engine: "mongodb", onOpenSql, onExplain });
    await flush();
    expect(calls[0].startsWith("db.system.profile.aggregate(")).toBe(true);
    host!.querySelector<HTMLElement>(".grid-rows [role='gridcell']")!.click();
    await flush();
    barButton("Abrir").click();
    expect(onOpenSql).toHaveBeenCalledWith('db.orders.find({"total":{"$gt":5}})');
    barButton("EXPLAIN").click();
    expect(onExplain).toHaveBeenCalledWith('db.orders.find({"total":{"$gt":5}})');
  });

  it("offers nothing to open for a profiled write", async () => {
    mongoBridge([["shop.orders", "update", JSON.stringify({ update: "orders" }), "1", "1", "1", "1"]]);
    mount({ engine: "mongodb" });
    await flush();
    host!.querySelector<HTMLElement>(".grid-rows [role='gridcell']")!.click();
    await flush();
    expect(barButton("Abrir").disabled).toBe(true);
    expect(barButton("EXPLAIN").disabled).toBe(true);
  });

  it("tells how to switch the profiler on when nothing was recorded, and has no reset button", async () => {
    mongoBridge([]);
    mount({ engine: "mongodb" });
    await flush();
    expect(host!.textContent).toContain("db.setProfilingLevel");
    expect([...host!.querySelectorAll("button")].some((b) => b.textContent?.includes("Reiniciar"))).toBe(false);
  });
});
