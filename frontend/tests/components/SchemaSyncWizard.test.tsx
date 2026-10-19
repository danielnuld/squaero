import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { SchemaSyncWizard } from "../../src/components/SchemaSyncWizard";
import type { Connection } from "../../src/utils/connections";

// Drives the real schema-sync wizard against a mocked bridge: opening a target
// connection, comparing two databases (schema.tree + schema.describe + catalog
// queries on each), showing the differences and the migration script, opening
// it in the editor, and applying it only after an explicit confirmation.

interface BridgeHost {
  quaeroRpc?: (requestJson: string) => Promise<unknown>;
}

let dispose: (() => void) | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  treeHasType = true;
  dispose?.();
  dispose = null;
  host?.remove();
  host = null;
  delete (globalThis as BridgeHost).quaeroRpc;
});

const flush = () => new Promise((r) => setTimeout(r, 0));

// Table lists + structures per connection id (c1 = source, c2 = target).
const tables: Record<string, string[]> = {
  c1: ["users", "orders"],
  c2: ["users", "audit"],
};
const structures: Record<string, Record<string, (string | null)[][]>> = {
  c1: {
    users: [
      ["id", "INTEGER", "1", null, "1"],
      ["email", "TEXT", "0", null, "0"],
      ["age", "INTEGER", "0", null, "0"],
    ],
    orders: [["id", "INTEGER", "1", null, "1"]],
  },
  c2: {
    users: [
      ["id", "INTEGER", "1", null, "1"],
      ["legacy", "TEXT", "0", null, "0"],
      ["age", "TEXT", "0", null, "0"],
    ],
    audit: [["id", "INTEGER", "1", null, "1"]],
  },
};

let treeHasType = true;

function treeResult(names: string[]) {
  return {
    columns: [
      { name: "name", type: "text" },
      ...(treeHasType ? [{ name: "type", type: "text" }] : []),
    ],
    rows: names.map((n) => (treeHasType ? [n, "table"] : [n])),
    truncated: false,
    rowsAffected: 0,
  };
}
function describeResult(rows: (string | null)[][]) {
  return {
    columns: [
      { name: "name", type: "text" },
      { name: "type", type: "text" },
      { name: "notnull", type: "int" },
      { name: "dflt_value", type: "text" },
      { name: "pk", type: "int" },
    ],
    rows,
    truncated: false,
    rowsAffected: 0,
  };
}

function installBridge() {
  const calls: { method: string; params: any }[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
    calls.push({ method: req.method, params: req.params });
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
    switch (req.method) {
      case "conn.open":
        return ok({ connId: "c2" });
      case "conn.close":
        return ok({ closed: true });
      case "schema.tree":
        return ok(treeResult(tables[req.params.connId] ?? []));
      case "schema.describe":
        return ok(describeResult(structures[req.params.connId]?.[req.params.table] ?? []));
      case "query.run":
        return ok({ columns: [], rows: [], truncated: false, rowsAffected: 0 });
      default: // tx.begin / tx.commit / tx.rollback
        return ok({ ok: true });
    }
  };
  return calls;
}

const conns: Connection[] = [
  { id: "d2", name: "Prod", driver: "sqlite", params: { path: "/prod.db" } },
];

function mount(onOpenSql: (sql: string, defId: string) => void = () => {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <SchemaSyncWizard
          sourceConnId="c1"
          sourceEngine="sqlite"
          sourceDb="main"
          connections={conns}
          onOpenSql={onOpenSql}
          onClose={() => {}}
        />
      ),
      host!,
    );
  });
}

async function compare() {
  clickButton("Comparar");
  for (let i = 0; i < 10; i++) await flush(); // target open + both snapshots
}

function clickButton(label: string) {
  const btn = [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  btn!.click();
}

describe("SchemaSyncWizard", () => {
  it("shows the categorized differences, the unsupported list and the script", async () => {
    installBridge();
    mount();
    await compare();

    const text = host!.textContent ?? "";
    expect(text).toContain("Tablas");
    expect(text).toContain("+ orders");
    expect(text).toContain("− audit");
    expect(text).toContain("+ users.email");
    expect(text).toContain("~ users.age");
    // SQLite cannot retype a column: listed, and flagged in the script.
    expect(text).toContain("No soportado por el motor destino (1)");
    expect(text).toContain("users.age: SQLite no puede cambiar el tipo");
    const script = host!.querySelector("pre")!.textContent!;
    expect(script).toContain('CREATE TABLE "orders"');
    expect(script).toContain('ALTER TABLE "users" ADD COLUMN "email" TEXT;');
    expect(script).toContain('ALTER TABLE "users" DROP COLUMN "legacy";');
    expect(script).toContain("-- UNSUPPORTED: users.age:");
    expect(script).toContain("-- NOTE: audit: exists only in the target; DROP TABLE not generated");
  });

  it("opens the script in the editor, bound to the target connection", async () => {
    installBridge();
    const opened: [string, string][] = [];
    mount((sql, defId) => opened.push([sql, defId]));
    await compare();
    clickButton("Abrir en el editor");
    expect(opened).toHaveLength(1);
    expect(opened[0][1]).toBe("d2");
    expect(opened[0][0]).toMatch(/^-- Target: Prod \(sqlite, main\)\n/);
    expect(opened[0][0]).toContain('CREATE TABLE "orders"');
  });

  it("applies only after confirming, in a transaction on the target, without the data-losing statements", async () => {
    const calls = installBridge();
    mount();
    await compare();
    const before = calls.length;

    // DROP COLUMN loses data: grouped apart and unchecked (audit A-30).
    const losing = host!.querySelector(".ssync-losing")!;
    expect(losing.textContent).toContain("Elimina datos (1)");
    const box = losing.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(box.checked).toBe(false);
    expect(losing.textContent).toContain('ALTER TABLE "users" DROP COLUMN "legacy";');

    const primary = host!.querySelector<HTMLButtonElement>(".wiz-foot .btn-primary")!;
    expect(primary.textContent).toMatch(/^Aplicar 2 sentencias en /);
    primary.click();
    await flush();
    expect(calls.length).toBe(before); // nothing runs until confirmed
    expect(host!.querySelector(".confirm-dialog")).not.toBeNull();

    host!.querySelector<HTMLButtonElement>(".confirm-dialog .btn-primary, .confirm-dialog .btn-danger")!.click();
    for (let i = 0; i < 5; i++) await flush();

    const after = calls.slice(before);
    const methods = after.map((c) => c.method);
    expect(methods[0]).toBe("tx.begin");
    const runs = after.filter((c) => c.method === "query.run").map((c) => c.params.sql);
    expect(runs).toEqual([
      'CREATE TABLE "orders" (\n  "id" INTEGER NOT NULL\n)',
      'ALTER TABLE "users" ADD COLUMN "email" TEXT',
    ]);
    expect(methods).toContain("tx.commit");
    expect(host!.textContent).toContain("aplicada");
    expect(host!.querySelector(".wiz-step.is-current")!.textContent).toContain("Aplicar");
  });

  it("a ticked data-losing statement is applied, behind the red button", async () => {
    const calls = installBridge();
    mount();
    await compare();
    const box = host!.querySelector<HTMLInputElement>(".ssync-losing input[type=checkbox]")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    const primary = host!.querySelector<HTMLButtonElement>(".wiz-foot .btn-danger")!;
    expect(primary.textContent).toMatch(/^Aplicar 3 sentencias en /);
    primary.click();
    await flush();
    const before = calls.length;
    host!.querySelector<HTMLButtonElement>(".confirm-dialog .btn-danger")!.click();
    for (let i = 0; i < 5; i++) await flush();
    const runs = calls.slice(before).filter((c) => c.method === "query.run").map((c) => c.params.sql);
    expect(runs).toContain('ALTER TABLE "users" DROP COLUMN "legacy"');
  });

  it("a read-only target only gets the script: no apply button, nothing written", async () => {
    const calls = installBridge();
    conns[0].safeMode = "readOnly";
    try {
      mount();
      expect(host!.textContent).toContain("Prod es de solo lectura: solo se genera el script");
      await compare();
      expect(host!.querySelector("pre")!.textContent).toContain('CREATE TABLE "orders"');
      const foot = [...host!.querySelectorAll(".wiz-foot button")].map((b) => b.textContent);
      expect(foot.some((l) => l?.startsWith("Aplicar"))).toBe(false);
      expect(foot).toContain("Guardar .sql");
      expect(calls.some((c) => c.method === "tx.begin")).toBe(false);
    } finally {
      delete conns[0].safeMode;
    }
  });

  it("asks for a schema when the container lists schemas instead of tables", async () => {
    treeHasType = false;
    installBridge();
    mount();
    await compare();
    expect(host!.querySelector('[role="alert"]')!.textContent).toContain("indica el esquema");
  });
});
