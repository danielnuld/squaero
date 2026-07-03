import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { TransferWizard } from "../../src/components/TransferWizard";
import type { ResultSet } from "../../src/utils/query";
import type { Connection } from "../../src/utils/connections";

// Drives the real transfer wizard against a mocked bridge: open the destination,
// read its columns (schema.describe), auto-map, and copy the source rows in a
// transaction via row.insert.

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

const sourceResult: ResultSet = {
  columns: [
    { name: "id", type: "int" },
    { name: "name", type: "text" },
  ],
  rows: [
    ["1", "alice"],
    ["2", "bob"],
  ],
  truncated: false,
  rowsAffected: 0,
};

function describeResult() {
  return {
    columns: [
      { name: "name", type: "text" },
      { name: "type", type: "text" },
      { name: "notnull", type: "int" },
      { name: "dflt_value", type: "text" },
      { name: "pk", type: "int" },
    ],
    rows: [
      ["id", "int", "1", null, "1"],
      ["name", "text", "0", null, "0"],
    ],
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
      case "schema.describe":
        return ok(describeResult());
      case "row.insert":
        return ok({ sql: "INSERT ...", rowsAffected: 1 });
      default: // tx.*
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
        <TransferWizard
          sourceResult={sourceResult}
          sourceTable="users"
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

describe("TransferWizard", () => {
  it("prepares the destination and copies the rows in a transaction", async () => {
    const calls = installBridge();
    mount();

    clickButton("Preparar");
    await flush();

    // Destination columns fetched + auto-mapped.
    const selects = host!.querySelectorAll<HTMLSelectElement>(".map-select");
    expect(selects.length).toBe(2);
    expect(selects[0].value).toBe("id");
    expect(selects[1].value).toBe("name");

    clickButton("Transferir");
    await flush();

    const methods = calls.map((c) => c.method);
    expect(methods).toContain("tx.begin");
    expect(methods.filter((m) => m === "row.insert").length).toBe(2);
    expect(methods).toContain("tx.commit");

    const firstInsert = calls.find((c) => c.method === "row.insert")!.params as {
      values: Record<string, string>;
      table: string;
    };
    expect(firstInsert.table).toBe("users");
    expect(firstInsert.values).toEqual({ id: "1", name: "alice" });
    expect(host!.textContent).toContain("transferida");
  });
});
