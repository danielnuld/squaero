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

// The source table comes in two pages over the cursor: the wizard must read
// both before diffing, or row 3 would look missing and nothing would add it.
const sourcePage1: ResultSet = {
  columns: [
    { name: "id", type: "int" },
    { name: "name", type: "text" },
  ],
  rows: [
    ["1", "alice"],
    ["2", "roberto"], // changed vs target
  ],
  truncated: true,
  cursor: true,
  rowsAffected: 0,
};
const sourcePage2: ResultSet = { ...sourcePage1, rows: [["3", "carol"]], truncated: false, cursor: false };

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
  let opened = 0;
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as { id: number; method: string; params: any };
    calls.push({ method: req.method, params: req.params });
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
    switch (req.method) {
      case "conn.open":
        opened += 1;
        return ok({ connId: opened === 1 ? "src" : "tgt" });
      case "conn.close":
        return ok({ closed: true });
      case "query.run":
        return ok(req.params.connId === "src" ? sourcePage1 : targetRows);
      case "query.next":
        return ok(sourcePage2);
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
  { id: "d1", name: "Ventas", driver: "sqlite", params: { path: "/ventas.db" } },
  { id: "d2", name: "Ventas copia", driver: "sqlite", params: { path: "/copia.db" } },
];

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <DataDiffWizard
          sourceDefId="d1"
          source={{ table: "clientes", db: "main" }}
          pk={["id"]}
          connections={[conns[1], conns[0]]}
          onClose={() => {}}
        />
      ),
      host!,
    );
  });
}

function clickButton(label: string) {
  const btn = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent?.trim() === label,
  );
  btn!.click();
}

const settle = async () => {
  for (let i = 0; i < 10; i++) await flush();
};

/** DELETE is off by default (audit P1): the tests that want it tick it. */
const tickDelete = () =>
  [...document.querySelectorAll<HTMLLabelElement>("label")]
    .find((l) => l.textContent?.startsWith("DELETE"))!
    .querySelector("input")!
    .click();

const writes = (calls: { method: string; params: any }[]) =>
  calls.filter((c) => c.method.startsWith("row.") && c.params.preview !== true);

describe("DataDiffWizard", () => {
  it("reads the whole source table, not just the first page", async () => {
    const calls = installBridge();
    mount();
    tickDelete();
    clickButton("Comparar");
    await settle();

    expect(calls.some((c) => c.method === "query.next" && c.params.connId === "src")).toBe(true);
    // id 3 lives on the second source page: it is an insert, never a delete.
    const inserts = calls.filter((c) => c.method === "row.insert");
    expect(inserts.map((c) => c.params.values.id)).toEqual(["3"]);
    const deletes = calls.filter((c) => c.method === "row.delete");
    expect(deletes.map((c) => c.params.where.id)).toEqual(["4"]);
    // Typed literals: the written columns carry their neutral types.
    expect(inserts[0].params.setTypes).toEqual({ id: "int", name: "text" });
    expect(host!.textContent).toContain("1 INSERT · 1 UPDATE · 1 DELETE");
  });

  it("asks before applying, naming the target and the count per kind", async () => {
    const calls = installBridge();
    mount();
    tickDelete();
    clickButton("Comparar");
    await settle();

    // Deleting target rows makes it the red button, with count and target.
    const primary = document.querySelector<HTMLButtonElement>(".wiz-foot .btn-danger")!;
    expect(primary.textContent).toBe("Aplicar 3 cambios en Ventas copia");
    primary.click();
    await settle();
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Ventas copia › \"main\".\"clientes\"");
    expect(dialog.textContent).toContain("1 INSERT · 1 UPDATE · 1 DELETE");
    expect(writes(calls)).toEqual([]);

    // Cancel writes nothing.
    dialog.querySelector<HTMLButtonElement>(".dlg-actions .btn:not(.btn-danger)")!.click();
    await settle();
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(writes(calls)).toEqual([]);
  });

  it("applies the plan in a transaction once confirmed", async () => {
    const calls = installBridge();
    mount();
    tickDelete();
    clickButton("Comparar");
    await settle();
    document.querySelector<HTMLButtonElement>(".wiz-foot .btn-danger")!.click();
    await settle();

    const before = calls.length;
    document.querySelector<HTMLButtonElement>(".confirm-dialog .btn-danger")!.click();
    await settle();
    const methods = calls.slice(before).map((c) => c.method);
    expect(methods[0]).toBe("tx.begin");
    expect(methods).toContain("tx.commit");
    expect(writes(calls).map((c) => c.method)).toEqual(["row.insert", "row.update", "row.delete"]);
    expect(writes(calls).every((c) => c.params.connId === "tgt")).toBe(true);
    expect(host!.textContent).toContain("aplicada");
  });

  it("generates no DELETE unless it is ticked", async () => {
    const calls = installBridge();
    mount();
    expect(host!.textContent).toContain("DELETE está desmarcado por defecto");
    clickButton("Comparar");
    await settle();
    expect(calls.filter((c) => c.method === "row.delete")).toEqual([]);
    expect(host!.textContent).toContain("1 INSERT · 1 UPDATE · 0 DELETE");
    // Nothing deletes, so the button is not the red one.
    expect(document.querySelector(".wiz-foot .btn-danger")).toBeNull();
    expect(document.querySelector(".wiz-foot .btn-primary")!.textContent).toBe("Aplicar 2 cambios en Ventas copia");
  });

  it("only generates the script for a read-only target", async () => {
    const calls = installBridge();
    host = document.createElement("div");
    document.body.appendChild(host);
    const ro: Connection = { ...conns[1], safeMode: "readOnly" };
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <DataDiffWizard sourceDefId="d1" source={{ table: "clientes", db: "main" }} pk={["id"]}
            connections={[ro, conns[0]]} onClose={() => {}} />
        ),
        host!,
      );
    });
    expect(host!.textContent).toContain("Ventas copia es de solo lectura: solo se genera el script");
    clickButton("Comparar");
    await settle();
    // The SQL is there, the apply button is not; nothing was written.
    expect(host!.querySelector(".preview-sql")!.textContent).toContain("row.insert");
    expect([...document.querySelectorAll(".wiz-foot button")].some((b) => b.textContent?.startsWith("Aplicar"))).toBe(false);
    expect([...document.querySelectorAll(".wiz-foot button")].some((b) => b.textContent === "Guardar .sql")).toBe(true);
    expect(writes(calls)).toEqual([]);
  });
});
