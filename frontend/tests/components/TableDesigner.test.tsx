import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { TableDesigner } from "../../src/components/TableDesigner";

// Drives the real table designer against a mocked bridge. Create mode names a
// table and creates it (CREATE TABLE in a tx, phase 1). Alter mode loads an
// existing table via schema.describe, diffs an edit into ALTER statements, and
// applies them in a tx (phase 2, issue #136).

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
    if (req.method === "schema.describe") {
      const cols = [
        { name: "name", type: "text" },
        { name: "type", type: "text" },
        { name: "notnull", type: "text" },
        { name: "dflt_value", type: "text" },
        { name: "pk", type: "text" },
      ];
      // Vary the structure by table so a tab swap can be observed.
      const rows =
        req.params.table === "orders"
          ? [["order_id", "BIGINT", "1", null, "1"]]
          : [
              ["id", "INT", "1", null, "1"],
              ["name", "VARCHAR(255)", "0", null, "0"],
            ];
      return ok({ columns: cols, rows, truncated: false, rowsAffected: 0 });
    }
    // query.run / tx.begin / tx.commit / tx.rollback
    return ok({ columns: [], rows: [], truncated: false, rowsAffected: 0 });
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

describe("TableDesigner — create mode", () => {
  it("previews and creates a table in a transaction", async () => {
    const calls = installBridge();
    const onApplied = vi.fn();
    const onClose = vi.fn();
    mount(() => (
      <TableDesigner connId="c1" engine="mysql" container="testdb" onClose={onClose} onApplied={onApplied} />
    ));

    // Name the table -> the preview reflects a valid CREATE TABLE.
    const nameInput = host!.querySelector(".field input") as HTMLInputElement;
    setInput(nameInput, "products");
    const preview = host!.querySelector(".ddl-text")!.textContent ?? "";
    expect(preview).toContain("CREATE TABLE `testdb`.`products`");
    expect(preview).toContain("AUTO_INCREMENT");

    clickText("Crear tabla");
    await flush();

    const methods = calls.map((c) => c.method);
    expect(methods).toContain("tx.begin");
    expect(methods).toContain("tx.commit");
    const create = calls.find((c) => c.method === "query.run");
    expect(create!.params.sql).toContain("CREATE TABLE `testdb`.`products`");
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a live validation error and disables create when a type is missing", async () => {
    installBridge();
    mount(() => <TableDesigner connId="c1" engine="mysql" onClose={() => {}} />);
    // Name ok, but clear the default column's type via the second .td-in input.
    setInput(host!.querySelector(".field input") as HTMLInputElement, "t");
    const typeInput = host!.querySelectorAll(".td-in")[1] as HTMLInputElement; // [0]=name,[1]=type
    setInput(typeInput, "");
    expect(host!.textContent).toMatch(/necesita un tipo/i);
    const createBtn = [...host!.querySelectorAll("button")].find(
      (b) => b.textContent?.includes("Crear tabla"),
    ) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
  });
});

describe("TableDesigner — alter mode", () => {
  it("loads the existing columns and shows 'Sin cambios' before any edit", async () => {
    installBridge();
    mount(() => <TableDesigner connId="c1" engine="mysql" table="users" onClose={() => {}} />);
    await flush(); // schema.describe resolves

    expect((host!.querySelector(".field input") as HTMLInputElement).value).toBe("users");
    expect(host!.querySelectorAll("table.td-table tbody tr")).toHaveLength(2);
    expect(host!.querySelector(".ddl-text")!.textContent).toContain("Sin cambios");
    const apply = [...host!.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Aplicar cambios"),
    ) as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  it("diffs a column type change into an ALTER applied in a transaction", async () => {
    const calls = installBridge();
    const onApplied = vi.fn();
    mount(() => (
      <TableDesigner connId="c1" engine="mysql" table="users" onClose={() => {}} onApplied={onApplied} />
    ));
    await flush();

    // Second row is "name"; its type input is the 2nd .td-in in that row.
    const nameRow = host!.querySelectorAll("table.td-table tbody tr")[1];
    const typeInput = nameRow.querySelectorAll("input.td-in")[1] as HTMLInputElement;
    setInput(typeInput, "TEXT");

    expect(host!.querySelector(".ddl-text")!.textContent).toContain(
      "ALTER TABLE `users` MODIFY COLUMN `name` TEXT",
    );

    clickText("Aplicar cambios");
    await flush();

    const runs = calls.filter((c) => c.method === "query.run").map((c) => c.params.sql);
    expect(runs).toEqual(["ALTER TABLE `users` MODIFY COLUMN `name` TEXT"]);
    const methods = calls.map((c) => c.method);
    expect(methods).toContain("tx.begin");
    expect(methods).toContain("tx.commit");
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("resets state when the target table changes on the shared instance (no stale bleed)", async () => {
    // App renders one shared TableDesigner across all designer tabs, so a prop
    // change must not leave a previous table's data behind.
    installBridge();
    const [table, setTable] = createSignal<string | undefined>("users");
    mount(() => <TableDesigner connId="c1" engine="mysql" table={table()} onClose={() => {}} />);
    await flush();
    expect((host!.querySelector(".field input") as HTMLInputElement).value).toBe("users");
    expect(host!.querySelectorAll("table.td-table tbody tr")).toHaveLength(2);

    // Switch to another table: name + columns fully replaced, no leftover rows.
    setTable("orders");
    await flush();
    expect((host!.querySelector(".field input") as HTMLInputElement).value).toBe("orders");
    const rows = host!.querySelectorAll("table.td-table tbody tr");
    expect(rows).toHaveLength(1);
    expect((rows[0].querySelector("input.td-in") as HTMLInputElement).value).toBe("order_id");

    // Switch back to create mode: blank name, default id column.
    setTable(undefined);
    await flush();
    expect((host!.querySelector(".field input") as HTMLInputElement).value).toBe("");
    const createRows = host!.querySelectorAll("table.td-table tbody tr");
    expect(createRows).toHaveLength(1);
    expect((createRows[0].querySelector("input.td-in") as HTMLInputElement).value).toBe("id");
    // No stale bleed from the previous alter target.
    const preview = host!.querySelector(".ddl-text")!.textContent ?? "";
    expect(preview).not.toContain("order_id");
    expect(preview).not.toContain("ALTER");
  });

  it("disables the PK/AI checkboxes while altering", async () => {
    installBridge();
    mount(() => <TableDesigner connId="c1" engine="mysql" table="users" onClose={() => {}} />);
    await flush();
    // Per row: [nullable, PK, AI]. PK and AI must be disabled in alter mode.
    const firstRow = [
      ...host!.querySelectorAll("table.td-table tbody tr")[0].querySelectorAll("input[type=checkbox]"),
    ] as HTMLInputElement[];
    expect(firstRow[0].disabled).toBe(false); // nullable stays editable
    expect(firstRow[1].disabled).toBe(true); // PK
    expect(firstRow[2].disabled).toBe(true); // AI
  });
});
