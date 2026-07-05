import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { SlowQueries } from "../../src/components/SlowQueries";

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
    const select = host!.querySelector("select") as HTMLSelectElement;
    select.value = "total";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    expect(calls.some((s) => s.includes("ORDER BY SUM_TIMER_WAIT DESC"))).toBe(true);
  });

  it("opens a row's statement in the editor", async () => {
    installBridge();
    const onOpenSql = vi.fn();
    mount({ onOpenSql });
    await flush();
    const open = [...host!.querySelectorAll<HTMLButtonElement>(".sq-actions-col .edit-btn")].find(
      (b) => b.textContent === "Abrir",
    )!;
    open.click();
    expect(onOpenSql).toHaveBeenCalledWith("SELECT * FROM orders");
  });

  it("requests EXPLAIN for a row's statement", async () => {
    installBridge();
    const onExplain = vi.fn();
    mount({ onExplain });
    await flush();
    const explain = [...host!.querySelectorAll<HTMLButtonElement>(".sq-actions-col .edit-btn")].find(
      (b) => b.textContent === "EXPLAIN",
    )!;
    explain.click();
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
