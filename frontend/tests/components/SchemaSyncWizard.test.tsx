import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { SchemaSyncWizard } from "../../src/components/SchemaSyncWizard";
import type { Connection } from "../../src/utils/connections";

// Drives the real schema-sync wizard against a mocked bridge: opening a target
// connection, comparing two databases (schema.tree + schema.describe on each),
// showing the migration SQL, and applying it in a transaction.

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
    ],
    orders: [["id", "INTEGER", "1", null, "1"]],
  },
  c2: {
    users: [
      ["id", "INTEGER", "1", null, "1"],
      ["legacy", "TEXT", "0", null, "0"],
    ],
    audit: [["id", "INTEGER", "1", null, "1"]],
  },
};

function treeResult(names: string[]) {
  return {
    columns: [
      { name: "name", type: "text" },
      { name: "type", type: "text" },
    ],
    rows: names.map((n) => [n, "table"]),
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

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <SchemaSyncWizard
          sourceConnId="c1"
          sourceDb="main"
          connections={conns}
          onClose={() => {}}
        />
      ),
      host!,
    );
  });
}

function clickButton(label: string) {
  const btn = [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  btn!.click();
}

describe("SchemaSyncWizard", () => {
  it("compares two databases and generates migration SQL", async () => {
    installBridge();
    mount();
    clickButton("Comparar");
    await flush();
    await flush(); // open target + the parallel schema fetches settle

    const text = host!.textContent ?? "";
    expect(text).toContain('CREATE TABLE "orders"');
    expect(text).toContain('ALTER TABLE "users" ADD COLUMN "email"');
    expect(text).toContain('ALTER TABLE "users" DROP COLUMN "legacy"');
    expect(text).toContain("audit existe en destino pero no en origen");
  });

  it("applies the executable statements on the target in a transaction", async () => {
    const calls = installBridge();
    mount();
    clickButton("Comparar");
    await flush();
    await flush();

    clickButton("Aplicar en destino");
    await flush();

    const methods = calls.map((c) => c.method);
    expect(methods).toContain("tx.begin");
    // Two executable statements (CREATE orders, and the users ALTERs) run via query.run.
    const runs = calls.filter((c) => c.method === "query.run");
    expect(runs.length).toBeGreaterThanOrEqual(3); // CREATE + ADD + DROP
    expect(methods).toContain("tx.commit");
    expect(host!.textContent).toContain("aplicada");
  });
});
