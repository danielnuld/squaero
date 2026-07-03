import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ImportWizard } from "../../src/components/ImportWizard";

// Drives the real ImportWizard in jsdom against a mocked core bridge: it fetches
// the target columns (schema.describe), parses a chosen CSV file, maps columns,
// and runs the import — asserting the row.insert / tx.* calls and the summary.

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

/** A describe result naming columns id + name (id is the PK). */
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
        ["name", "text", "0", null, "0"],
      ],
      truncated: false,
      rowsAffected: 0,
    },
  };
}

/** Install a bridge that records calls and answers describe / tx.* / row.insert. */
function installBridge() {
  const calls: { method: string; params: unknown }[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as { id: number; method: string; params: unknown };
    calls.push({ method: req.method, params: req.params });
    if (req.method === "schema.describe") return describeResponse(req.id);
    if (req.method === "row.insert") {
      return { jsonrpc: "2.0", id: req.id, result: { sql: "INSERT ...", rowsAffected: 1 } };
    }
    // tx.begin / tx.commit / tx.rollback
    return { jsonrpc: "2.0", id: req.id, result: { ok: true } };
  };
  return calls;
}

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  const onImported = vi.fn();
  const onClose = vi.fn();
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <ImportWizard
          connId="c1"
          target={{ table: "users" }}
          onClose={onClose}
          onImported={onImported}
        />
      ),
      host!,
    );
  });
  return { onImported, onClose };
}

/** Simulate choosing a file on the wizard's file input. */
async function chooseFile(name: string, text: string) {
  const input = host!.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = { name, text: async () => text } as unknown as File;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await flush();
}

describe("ImportWizard", () => {
  it("fetches the target columns and shows the file picker", async () => {
    installBridge();
    mount();
    await flush(); // schema.describe resolves
    expect(host!.textContent).toContain("Importar a users");
    expect(host!.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("parses a CSV, maps columns and imports within a transaction", async () => {
    const calls = installBridge();
    const { onImported } = mount();
    await flush();

    await chooseFile("people.csv", "id,name\r\n1,alice\r\n2,bob");

    // Preview + a mapping row per target column appear.
    expect(host!.textContent).toContain("people.csv");
    const selects = host!.querySelectorAll<HTMLSelectElement>(".map-select");
    expect(selects.length).toBe(2); // id, name
    // auto-mapped by name (case-insensitive): id->id, name->name.
    expect(selects[0].value).toBe("id");
    expect(selects[1].value).toBe("name");

    // Run the import.
    const runBtn = [...host!.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Importar",
    )!;
    runBtn.click();
    await flush();

    const methods = calls.map((c) => c.method);
    expect(methods).toContain("tx.begin");
    expect(methods.filter((m) => m === "row.insert").length).toBe(2);
    expect(methods).toContain("tx.commit");
    expect(methods).not.toContain("tx.rollback");

    // The first insert carries the mapped values.
    const firstInsert = calls.find((c) => c.method === "row.insert")!
      .params as { values: Record<string, string> };
    expect(firstInsert.values).toEqual({ id: "1", name: "alice" });

    // Summary is shown and the grid reload was requested.
    expect(host!.textContent).toContain("2");
    expect(host!.textContent).toContain("insertada");
    expect(onImported).toHaveBeenCalled();
  });
});
