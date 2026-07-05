import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { IndexManager } from "../../src/components/IndexManager";

// Drives the real index/constraint manager against a mocked bridge (issue #139):
// lists a table's indexes + constraints, creates an index, and drops one — each
// applied in a transaction.

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
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
    const rs = (columns: string[], rows: (string | null)[][]) =>
      ok({ columns: columns.map((name) => ({ name, type: "text" })), rows, truncated: false, rowsAffected: 0 });
    if (req.method === "schema.describe") return rs(["name", "type", "notnull", "dflt_value", "pk"], [["id", "INT", "1", null, "1"], ["email", "VARCHAR", "0", null, "0"]]);
    if (req.method === "query.run") {
      const sql: string = req.params.sql;
      if (sql.includes("information_schema.STATISTICS")) {
        // The listing SQL carries the table name as a literal — vary by table so
        // a tab swap can be observed.
        const idxName = sql.includes("'orders'") ? "idx_total" : "idx_email";
        return rs(["name", "columnas", "unico"], [["PRIMARY", "id", "Sí"], [idxName, "email", "No"]]);
      }
      if (sql.includes("TABLE_CONSTRAINTS")) return rs(["name", "tipo"], [["PRIMARY", "PRIMARY KEY"]]);
      return rs([], []); // applied DDL
    }
    return ok({ ok: true }); // tx.*
  };
  return calls;
}

const setInput = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const clickText = (text: string) =>
  ([...host!.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement).click();

function mount(node: () => any) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(node, host!);
  });
}

describe("IndexManager", () => {
  it("lists indexes and constraints", async () => {
    installBridge();
    mount(() => <IndexManager connId="c1" engine="mysql" table="users" db="shop" onClose={() => {}} />);
    await flush();
    const text = host!.textContent ?? "";
    expect(text).toContain("idx_email");
    expect(text).toContain("PRIMARY KEY");
  });

  it("creates an index in a transaction and reloads", async () => {
    const calls = installBridge();
    const onChanged = vi.fn();
    mount(() => <IndexManager connId="c1" engine="mysql" table="users" db="shop" onClose={() => {}} onChanged={onChanged} />);
    await flush();

    const nameInput = [...host!.querySelectorAll("input.td-in")].find((i) => (i as HTMLInputElement).placeholder.includes("nombre_del_indice")) as HTMLInputElement;
    const colsInput = [...host!.querySelectorAll("input.td-in")].find((i) => (i as HTMLInputElement).placeholder.includes("columnas")) as HTMLInputElement;
    setInput(nameInput, "idx_new");
    setInput(colsInput, "email");

    // Preview reflects the CREATE INDEX.
    const previews = [...host!.querySelectorAll("pre.ddl-text")].map((p) => p.textContent);
    expect(previews.some((p) => p?.includes("CREATE INDEX `idx_new` ON `shop`.`users` (`email`)"))).toBe(true);

    clickText("Crear índice");
    await flush();

    const runs = calls.filter((c) => c.method === "query.run").map((c) => c.params.sql);
    expect(runs).toContain("CREATE INDEX `idx_new` ON `shop`.`users` (`email`)");
    const methods = calls.map((c) => c.method);
    expect(methods).toContain("tx.begin");
    expect(methods).toContain("tx.commit");
    expect(onChanged).toHaveBeenCalled();
  });

  it("drops an index via a confirmation bar in a transaction", async () => {
    const calls = installBridge();
    mount(() => <IndexManager connId="c1" engine="mysql" table="users" db="shop" onClose={() => {}} />);
    await flush();

    // Click the first index row's trash button.
    const del = host!.querySelector("button.grid-action.danger") as HTMLButtonElement;
    del.click();
    await flush();

    // Confirmation dialog shows the exact DROP.
    const dialog = host!.querySelector(".confirm-dialog");
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain("DROP INDEX `PRIMARY` ON `shop`.`users`");

    clickText("Eliminar"); // confirm in the dialog
    await flush();

    const runs = calls.filter((c) => c.method === "query.run").map((c) => c.params.sql);
    expect(runs).toContain("DROP INDEX `PRIMARY` ON `shop`.`users`");
    expect(calls.map((c) => c.method)).toContain("tx.begin");
  });

  it("resets and reloads when the target table changes on the shared instance", async () => {
    // App renders one shared IndexManager across all "indexes" tabs, so a prop
    // change must fully replace the listing (no stale bleed / no race overwrite).
    installBridge();
    const [table, setTable] = createSignal("users");
    mount(() => <IndexManager connId="c1" engine="mysql" table={table()} db="shop" onClose={() => {}} />);
    await flush();
    expect(host!.textContent).toContain("idx_email");

    setTable("orders");
    await flush();
    expect(host!.textContent).toContain("idx_total");
    expect(host!.textContent).not.toContain("idx_email");
    // Title reflects the new table.
    expect(host!.querySelector("h2")!.textContent).toContain("orders");
  });

  it("keeps the confirmation dialog open and shows the error when a drop fails", async () => {
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
      const rs = (columns: string[], rows: (string | null)[][]) =>
        ok({ columns: columns.map((name) => ({ name, type: "text" })), rows, truncated: false, rowsAffected: 0 });
      if (req.method === "schema.describe") return rs(["name", "type", "notnull", "dflt_value", "pk"], [["id", "INT", "1", null, "1"]]);
      if (req.method === "query.run") {
        const sql: string = req.params.sql;
        if (sql.includes("information_schema.STATISTICS")) return rs(["name", "columnas", "unico"], [["idx_a", "a", "No"]]);
        if (sql.includes("TABLE_CONSTRAINTS")) return rs(["name", "tipo"], []);
        // The DROP fails.
        return { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "cannot drop" } };
      }
      return ok({ ok: true }); // tx.*
    };
    mount(() => <IndexManager connId="c1" engine="mysql" table="users" db="shop" onClose={() => {}} />);
    await flush();

    (host!.querySelector("button.grid-action.danger") as HTMLButtonElement).click();
    await flush();
    clickText("Eliminar"); // confirm -> drop fails
    await flush();

    // Dialog stays open and surfaces the error for a retry.
    expect(host!.querySelector(".confirm-dialog")).not.toBeNull();
    expect(host!.querySelector(".confirm-dialog")!.textContent).toContain("cannot drop");
  });

  it("shows honest unsupported messages for SQLite constraints", async () => {
    installBridge();
    mount(() => <IndexManager connId="c1" engine="sqlite" table="t" onClose={() => {}} />);
    await flush();
    expect(host!.textContent).toMatch(/SQLite no cataloga constraints/i);
  });
});
