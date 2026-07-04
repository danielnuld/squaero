import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { DataGenerator } from "../../src/components/DataGenerator";

// Drives the real DataGenerator in jsdom against a mocked bridge: it fetches the
// target columns (schema.describe), assigns per-type strategies, previews, and
// inserts generated rows through row.insert inside a transaction.

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

/** describe: id (int, pk), name (text), created (datetime). */
function describeResponse(id: number) {
  return {
    jsonrpc: "2.0",
    id,
    result: {
      columns: [
        { name: "name", type: "text" },
        { name: "type", type: "text" },
        { name: "notnull", type: "int" },
        { name: "dflt_value", type: "text" },
        { name: "pk", type: "int" },
      ],
      rows: [
        ["id", "int", "1", null, "1"],
        ["name", "varchar(50)", "0", null, "0"],
        ["created", "datetime", "0", null, "0"],
      ],
      truncated: false,
      rowsAffected: 0,
    },
  };
}

function installBridge() {
  const calls: { method: string; params: unknown }[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as { id: number; method: string; params: unknown };
    calls.push({ method: req.method, params: req.params });
    if (req.method === "schema.describe") return describeResponse(req.id);
    if (req.method === "row.insert") {
      return { jsonrpc: "2.0", id: req.id, result: { sql: "INSERT ...", rowsAffected: 1 } };
    }
    return { jsonrpc: "2.0", id: req.id, result: { ok: true } };
  };
  return calls;
}

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  const onGenerated = vi.fn();
  const onClose = vi.fn();
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <DataGenerator
          connId="c1"
          target={{ table: "users" }}
          onClose={onClose}
          onGenerated={onGenerated}
        />
      ),
      host!,
    );
  });
  return { onGenerated, onClose };
}

const setCount = (n: number) => {
  const input = host!.querySelector<HTMLInputElement>('input[type="number"]')!;
  input.value = String(n);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("DataGenerator", () => {
  it("loads columns and assigns default strategies by type", async () => {
    installBridge();
    mount();
    await flush();
    expect(host!.textContent).toContain("Generar datos");
    const selects = host!.querySelectorAll<HTMLSelectElement>(".map-select");
    expect(selects.length).toBe(3); // id, name, created
    // id is the PK int -> sequence; name -> text; created datetime -> date.
    expect(selects[0].value).toBe("sequence");
    expect(selects[1].value).toBe("text");
    expect(selects[2].value).toBe("date");
  });

  it("shows a deterministic preview of the requested size (capped at 5)", async () => {
    installBridge();
    mount();
    await flush();
    setCount(3);
    await flush();
    const bodyRows = host!.querySelectorAll(".import-preview-scroll tbody tr");
    expect(bodyRows.length).toBe(3);
    // The sequence column starts at 1.
    const firstCell = bodyRows[0].querySelector("td")!;
    expect(firstCell.textContent).toBe("1");
  });

  it("generates and inserts N rows in one transaction", async () => {
    const calls = installBridge();
    const { onGenerated } = mount();
    await flush();
    setCount(4);
    await flush();

    const runBtn = [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.startsWith("Generar 4"),
    )!;
    runBtn.click();
    await flush();

    const methods = calls.map((c) => c.method);
    expect(methods).toContain("tx.begin");
    expect(methods.filter((m) => m === "row.insert").length).toBe(4);
    expect(methods).toContain("tx.commit");
    expect(methods).not.toContain("tx.rollback");
    // The insert carries values for the non-skipped columns.
    const firstInsert = calls.find((c) => c.method === "row.insert")!.params as {
      values: Record<string, string>;
    };
    expect(Object.keys(firstInsert.values).sort()).toEqual(["created", "id", "name"]);
    expect(firstInsert.values.id).toBe("1");
    expect(host!.textContent).toContain("insertada");
    expect(onGenerated).toHaveBeenCalled();
  });

  it("rolls back and reports when an insert fails", async () => {
    const calls = installBridge();
    // Make the first row.insert fail.
    let failed = false;
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: unknown };
      calls.push({ method: req.method, params: req.params });
      if (req.method === "schema.describe") return describeResponse(req.id);
      if (req.method === "row.insert" && !failed) {
        failed = true;
        return { jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "boom" } };
      }
      return { jsonrpc: "2.0", id: req.id, result: { ok: true } };
    };
    mount();
    await flush();
    setCount(3);
    await flush();
    const runBtn = [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
      b.textContent?.startsWith("Generar"),
    )!;
    runBtn.click();
    await flush();
    expect(calls.map((c) => c.method)).toContain("tx.rollback");
    expect(host!.textContent).toContain("boom");
  });
});
