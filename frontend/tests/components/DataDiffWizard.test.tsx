import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { DataDiffWizard } from "../../src/components/DataDiffWizard";
import type { ResultSet } from "../../src/utils/query";
import type { Connection } from "../../src/utils/connections";

// Drives the real data-diff wizard against a mocked bridge: opening the target,
// reading its rows, diffing by PK, previewing the row.* SQL, and applying the
// plan in a transaction.

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
    ["2", "roberto"], // changed vs target
    ["3", "carol"], // new vs target
  ],
  truncated: false,
  rowsAffected: 0,
};

// Target has id 1 (same), id 2 (name=bob -> update), id 4 (only target -> delete).
const targetRows: ResultSet = {
  columns: [
    { name: "id", type: "int" },
    { name: "name", type: "text" },
  ],
  rows: [
    ["1", "alice"],
    ["2", "bob"],
    ["4", "dave"],
  ],
  truncated: false,
  rowsAffected: 0,
};

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
      case "query.run":
        return ok(targetRows);
      case "row.insert":
      case "row.update":
      case "row.delete":
        return ok({ sql: `${req.method} ...`, rowsAffected: 1 });
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
        <DataDiffWizard
          sourceResult={sourceResult}
          source={{ table: "users", db: "main" }}
          pk={["id"]}
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

describe("DataDiffWizard", () => {
  it("diffs by PK and previews insert/update/delete, then applies in a transaction", async () => {
    const calls = installBridge();
    mount();
    clickButton("Comparar");
    await flush();
    await flush();

    // Preview shows one op of each kind (via row.* preview).
    const previewCalls = calls.filter(
      (c) => ["row.insert", "row.update", "row.delete"].includes(c.method),
    );
    expect(previewCalls.every((c) => c.params.preview === true)).toBe(true);
    expect(calls.some((c) => c.method === "row.insert")).toBe(true);
    expect(calls.some((c) => c.method === "row.update")).toBe(true);
    expect(calls.some((c) => c.method === "row.delete")).toBe(true);
    expect(host!.textContent).toContain("3 operación");

    // Apply runs the plan for real inside a transaction.
    const before = calls.length;
    clickButton("Aplicar (3)");
    await flush();
    const applyCalls = calls.slice(before);
    const methods = applyCalls.map((c) => c.method);
    expect(methods).toContain("tx.begin");
    expect(methods.filter((m) => m === "row.insert").length).toBe(1);
    expect(methods.filter((m) => m === "row.update").length).toBe(1);
    expect(methods.filter((m) => m === "row.delete").length).toBe(1);
    expect(methods).toContain("tx.commit");
    // The applied ops are not previews.
    expect(
      applyCalls
        .filter((c) => c.method.startsWith("row."))
        .every((c) => c.params.preview !== true),
    ).toBe(true);
    expect(host!.textContent).toContain("aplicada");
  });
});
