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

    host!.querySelector<HTMLButtonElement>(".confirm-dialog .btn-danger")!.click(); // confirm in the dialog
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
    // The panel still says which table it is on — through its accessible name
    // now, since the title lives in the tab and no longer in an <h2> (#372).
    expect(host!.querySelector("[role='region']")!.getAttribute("aria-label")).toContain(
      "orders",
    );
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
    host!.querySelector<HTMLButtonElement>(".confirm-dialog .btn-danger")!.click(); // confirm -> drop fails
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

// Issue #719: the same manager runs on MongoDB, fed with mongosh statements. An
// index cannot be built inside a multi-document transaction, so no tx.* call is
// made, and the statement goes straight to query.run.
describe("IndexManager on MongoDB", () => {
  function mongoBridge() {
    const calls: { method: string; sql?: string }[] = [];
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
      calls.push({ method: req.method, sql: req.params?.sql });
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
      const rs = (columns: string[], rows: (string | null)[][]) =>
        ok({ columns: columns.map((name) => ({ name, type: "text" })), rows, truncated: false, rowsAffected: 0 });
      if (req.method === "schema.describe") return rs(["name", "type", "notnull", "dflt_value", "pk"], [["sku", "text", "0", null, "0"]]);
      if (req.method === "query.run" && req.params.sql.endsWith(".getIndexes()")) {
        return rs(["v", "key", "name", "unique"], [["2", '{ "_id" : 1 }', "_id_", null], ["2", '{ "sku" : 1 }', "sku_1", "true"]]);
      }
      if (req.method === "query.run") return rs([], []);
      return ok({ ok: true });
    };
    return calls;
  }

  it("lists the indexes from getIndexes() and says constraints are not a thing here", async () => {
    const calls = mongoBridge();
    mount(() => <IndexManager connId="c1" engine="mongodb" table="orders" db="shop" onClose={() => {}} />);
    await flush();
    const text = host!.textContent ?? "";
    expect(calls.some((c) => c.sql === "db.orders.getIndexes()")).toBe(true);
    expect(text).toContain("sku_1");
    expect(text).toContain('"sku"');
    expect(text).toContain("$jsonSchema");
  });

  it("creates an index with createIndex, outside any transaction", async () => {
    const calls = mongoBridge();
    const onChanged = vi.fn();
    mount(() => (
      <IndexManager connId="c1" engine="mongodb" table="orders" db="shop" onChanged={onChanged} onClose={() => {}} />
    ));
    await flush();
    const inputs = host!.querySelectorAll<HTMLInputElement>(".im-fields input.td-in");
    setInput(inputs[0], "by_sku");
    setInput(inputs[1], "sku");
    await flush();
    expect(host!.querySelector(".im-form pre.ddl-text")!.textContent).toBe(
      'db.orders.createIndex({"sku": 1}, {"name": "by_sku"})',
    );
    clickText("Crear");
    await flush();
    expect(calls.some((c) => c.sql === 'db.orders.createIndex({"sku": 1}, {"name": "by_sku"})')).toBe(true);
    expect(calls.some((c) => c.method.startsWith("tx."))).toBe(false);
    expect(onChanged).toHaveBeenCalled();
  });
});

// #692 (P5): the toolbar — Nuevo índice takes the cursor to the form, Eliminar
// acts on the selected row.
describe("IndexManager — toolbar", () => {
  it("deletes the selected index from the toolbar, behind the confirmation", async () => {
    installBridge();
    mount(() => <IndexManager connId="c1" engine="mysql" table="users" db="shop" onClose={() => {}} />);
    await flush();
    const tb = host!.querySelector('[role="toolbar"]')!;
    const drop = [...tb.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.startsWith("Eliminar"))!;
    expect(drop.disabled).toBe(true);
    host!.querySelector<HTMLTableRowElement>(".struct-table tbody tr")!.click();
    expect(drop.textContent).toBe("Eliminar PRIMARY…");
    drop.click();
    await flush();
    expect(host!.querySelector(".confirm-dialog")!.textContent).toContain("DROP INDEX `PRIMARY` ON `shop`.`users`");
  });

  it("Nuevo índice puts the cursor in the new index's name", async () => {
    installBridge();
    mount(() => <IndexManager connId="c1" engine="mysql" table="users" db="shop" onClose={() => {}} />);
    await flush();
    [...host!.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].find((b) => b.textContent === "Nuevo índice")!.click();
    expect(document.activeElement).toBe(host!.querySelector('input[aria-label="nombre_del_indice"]'));
  });
});

describe("IndexManager — accessible names", () => {
  it("names the drop button after the index, and labels every form field", async () => {
    installBridge();
    mount(() => <IndexManager connId="c1" engine="mysql" table="users" db="shop" onClose={() => {}} />);
    await flush();
    const del = host!.querySelector("button.grid-action.danger")!;
    expect(del.getAttribute("aria-label")).toBe("Eliminar el índice PRIMARY");
    for (const input of host!.querySelectorAll<HTMLInputElement>(".im-fields input.td-in")) {
      expect(input.getAttribute("aria-label"), input.placeholder).toBeTruthy();
    }
  });
});
