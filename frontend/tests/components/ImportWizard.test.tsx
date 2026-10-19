import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { ImportWizard } from "../../src/components/ImportWizard";
import { buildXlsx } from "../../src/utils/xlsx";
import type { ResultSet } from "../../src/utils/query";
import { dropdownValue } from "./dropdownHarness";

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

function mount(initialText?: string) {
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
          initialText={initialText}
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

/** Simulate choosing a binary (XLSX) file: provides arrayBuffer(). */
async function chooseBytes(name: string, bytes: Uint8Array) {
  const input = host!.querySelector<HTMLInputElement>('input[type="file"]')!;
  const file = { name, arrayBuffer: async () => bytes.buffer } as unknown as File;
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await flush();
}

/** A footer button by its exact text. */
const button = (text: string | RegExp) =>
  [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) =>
    typeof text === "string" ? b.textContent === text : text.test(b.textContent ?? ""),
  )!;
/** «Siguiente»: from where the rows come from to the column mapping. */
const next = async () => {
  button("Siguiente").click();
  await flush();
};

describe("ImportWizard", () => {
  it("walks numbered steps: Origen, Columnas, Importar", async () => {
    installBridge();
    mount();
    await flush();
    const steps = [...host!.querySelectorAll(".wiz-step")];
    expect(steps.map((s) => s.textContent)).toEqual(["1Origen", "2Columnas", "3Importar"]);
    expect(steps[0].getAttribute("aria-current")).toBe("step");
    // Nothing to go on with until there are rows.
    expect(button("Siguiente").disabled).toBe(true);
  });

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

    // The preview first; the mapping is the next step.
    expect(host!.textContent).toContain("people.csv");
    expect(host!.querySelectorAll(".map-select").length).toBe(0);
    await next();
    expect(host!.querySelector(".wiz-step.is-current")!.textContent).toContain("Columnas");
    const selects = host!.querySelectorAll<HTMLElement>(".map-select");
    expect(selects.length).toBe(2); // id, name
    // auto-mapped by name (case-insensitive): id->id, name->name.
    expect(dropdownValue(selects[0])).toBe("id");
    expect(dropdownValue(selects[1])).toBe("name");

    // Run the import: the verb carries the count, and the policy is offered.
    expect(host!.textContent).toContain("Si una fila falla");
    button("Importar 2 filas").click();
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
    // The result screen closes with «Cerrar», and Back is gone.
    expect(button("Cerrar")).toBeDefined();
    expect(button("Atrás")).toBeUndefined();
  });

  it("goes back to the source with Atrás", async () => {
    installBridge();
    mount();
    await flush();
    await chooseFile("people.csv", "id,name\r\n1,alice");
    await next();
    button("Atrás").click();
    await flush();
    expect(host!.querySelector('input[type="file"]')).not.toBeNull();
  });

  it("reads an XLSX workbook, maps columns and imports", async () => {
    const calls = installBridge();
    mount();
    await flush();

    const source: ResultSet = {
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
    await chooseBytes("people.xlsx", buildXlsx(source, "Sheet1"));

    // Headers read from the workbook drive the auto-mapping.
    expect(host!.textContent).toContain("people.xlsx");
    await next();
    const selects = host!.querySelectorAll<HTMLElement>(".map-select");
    expect(selects.length).toBe(2);
    expect(dropdownValue(selects[0])).toBe("id");
    expect(dropdownValue(selects[1])).toBe("name");

    button("Importar 2 filas").click();
    await flush();

    expect(calls.filter((c) => c.method === "row.insert").length).toBe(2);
    const firstInsert = calls.find((c) => c.method === "row.insert")!
      .params as { values: Record<string, string> };
    expect(firstInsert.values).toEqual({ id: "1", name: "alice" });
  });
});

// Issue #383: the same wizard, fed from the clipboard instead of a file. What
// is being defended here is that pasting takes the SAME road — preview, mapping
// and one transaction — because the destination is somebody's database.
describe("ImportWizard — pasted rows", () => {
  const TSV = "id\tname\n1\talice\n2\t";

  const runButton = () => button(/^Importar \d+ filas?$/);

  it("opens on the clipboard tab with the pasted rows parsed and mapped", async () => {
    installBridge();
    mount(TSV);
    await flush();

    expect(host!.querySelector<HTMLTextAreaElement>(".import-paste")!.value).toBe(TSV);
    expect(host!.textContent).toContain("Vista previa de lo pegado");
    await next();
    const selects = host!.querySelectorAll<HTMLElement>(".map-select");
    expect(selects.length).toBe(2);
    // Mapped even though the text arrived before schema.describe answered.
    expect(dropdownValue(selects[0])).toBe("id");
    expect(dropdownValue(selects[1])).toBe("name");
  });

  it("imports the pasted rows in one transaction, empty cells as NULL", async () => {
    const calls = installBridge();
    const { onImported } = mount(TSV);
    await flush();

    await next();
    runButton().click();
    await flush();

    const inserts = calls.filter((c) => c.method === "row.insert");
    expect(inserts.length).toBe(2);
    expect((inserts[0].params as { values: unknown }).values).toEqual({ id: "1", name: "alice" });
    // The second row's name cell is empty: NULL, because the box says so.
    expect((inserts[1].params as { values: unknown }).values).toEqual({ id: "2", name: null });
    expect(calls.map((c) => c.method)).toContain("tx.commit");
    expect(onImported).toHaveBeenCalled();
  });

  it("keeps empty cells as empty strings when the box is unchecked", async () => {
    const calls = installBridge();
    mount(TSV);
    await flush();

    const box = host!.querySelector<HTMLInputElement>('.import-check input[type="checkbox"]')!;
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event("change", { bubbles: true }));

    await next();
    runButton().click();
    await flush();

    const inserts = calls.filter((c) => c.method === "row.insert");
    expect((inserts[1].params as { values: unknown }).values).toEqual({ id: "2", name: "" });
  });

  it("re-parses what the user types into the box, and forgets it when emptied", async () => {
    installBridge();
    mount(TSV);
    await flush();

    const area = host!.querySelector<HTMLTextAreaElement>(".import-paste")!;
    area.value = "ciudad\nHermosillo";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    expect(host!.textContent).toContain("1 fila(s)");
    expect(button("Siguiente").disabled).toBe(false);

    area.value = "";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    expect(host!.textContent).not.toContain("Vista previa");
    expect(button("Siguiente").disabled).toBe(true);
  });
});
