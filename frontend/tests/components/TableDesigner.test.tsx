import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { TableDesigner } from "../../src/components/TableDesigner";

// Drives the real table designer against a mocked bridge: name the table, keep
// the default id column, and create it — expecting CREATE TABLE inside a tx.

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
    return { jsonrpc: "2.0", id: req.id, result: { columns: [], rows: [], truncated: false, rowsAffected: 0 } };
  };
  return calls;
}

const setInput = (el: HTMLInputElement, value: string) => {
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const clickText = (text: string) =>
  ([...host!.querySelectorAll("button")].find((b) => b.textContent?.includes(text)) as HTMLButtonElement).click();

describe("TableDesigner", () => {
  it("previews and creates a table in a transaction", async () => {
    const calls = installBridge();
    const onCreated = vi.fn();
    const onClose = vi.fn();
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(
        () => (
          <TableDesigner
            connId="c1"
            engine="mysql"
            container="testdb"
            onClose={onClose}
            onCreated={onCreated}
          />
        ),
        host!,
      );
    });

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
    expect(onCreated).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a live validation error and disables create when a type is missing", async () => {
    installBridge();
    host = document.createElement("div");
    document.body.appendChild(host);
    createRoot((d) => {
      dispose = d;
      render(() => <TableDesigner connId="c1" engine="mysql" onClose={() => {}} />, host!);
    });
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
