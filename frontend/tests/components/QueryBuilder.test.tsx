import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { QueryBuilder } from "../../src/components/QueryBuilder";

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

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};

const rs = (columns: { name: string; type: string }[], rows: (string | null)[][]) => ({
  columns,
  rows,
  truncated: false,
  rowsAffected: 0,
});

function installBridge() {
  (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params: Record<string, unknown> };
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
    if (req.method === "schema.tree") {
      if (!req.params.db) return ok(rs([{ name: "name", type: "text" }], [["testdb"]]));
      return ok(rs([{ name: "name", type: "text" }, { name: "type", type: "text" }], [["users", "table"]]));
    }
    if (req.method === "schema.describe") {
      return ok(
        rs(
          [{ name: "name", type: "text" }, { name: "type", type: "text" }, { name: "pk", type: "int" }],
          [["id", "int", "1"], ["name", "text", "0"], ["age", "int", "0"]],
        ),
      );
    }
    return { jsonrpc: "2.0", id: req.id, result: {} };
  };
}

function mount(onRun = vi.fn()) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(() => <QueryBuilder connId="c1" engine="mysql" onRun={onRun} onClose={() => {}} />, host!);
  });
  return onRun;
}

const preview = () => host!.querySelector(".qb-preview")?.textContent ?? "";

describe("QueryBuilder", () => {
  it("previews SELECT * for the loaded table by default", async () => {
    installBridge();
    mount();
    await flush();
    expect(preview()).toBe("SELECT * FROM `testdb`.`users`;");
    // A checkbox per column (id/name/age).
    expect(host!.querySelectorAll(".qb-col input").length).toBe(3);
  });

  it("adds chosen columns and a WHERE condition to the SQL", async () => {
    installBridge();
    mount();
    await flush();

    // Choose the "name" column.
    const nameBox = [...host!.querySelectorAll<HTMLLabelElement>(".qb-col")].find((l) =>
      l.textContent?.includes("name"),
    )!;
    nameBox.querySelector("input")!.click();
    expect(preview()).toBe("SELECT `name` FROM `testdb`.`users`;");

    // Add a condition age > 18.
    [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Condición"))!.click();
    const cond = host!.querySelector(".qb-cond")!;
    const selects = cond.querySelectorAll<HTMLSelectElement>("select");
    selects[0].value = "age";
    selects[0].dispatchEvent(new Event("change", { bubbles: true }));
    selects[1].value = ">";
    selects[1].dispatchEvent(new Event("change", { bubbles: true }));
    const val = cond.querySelector<HTMLInputElement>(".td-in")!;
    val.value = "18";
    val.dispatchEvent(new Event("input", { bubbles: true }));

    expect(preview()).toBe("SELECT `name` FROM `testdb`.`users` WHERE `age` > '18';");
  });

  it("runs the built SQL through onRun", async () => {
    installBridge();
    const onRun = mount();
    await flush();
    [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Ejecutar")!.click();
    expect(onRun).toHaveBeenCalledWith("SELECT * FROM `testdb`.`users`;");
  });
});
