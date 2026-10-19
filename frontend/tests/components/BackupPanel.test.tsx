import { describe, it, expect, afterEach } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { BackupPanel } from "../../src/components/BackupPanel";

// The backup tool in the wizard pattern (#692): three jobs as tabs, one primary
// each (audit A-32), and a restore that asks first, naming the file, the
// statements and the target (A-10).

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

const EMPTY = { columns: [], rows: [], truncated: false, rowsAffected: 0 };

function installBridge() {
  const sqls: string[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
    const req = JSON.parse(requestJson) as { id: number; method: string; params: { sql?: string } };
    const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
    if (req.method === "schema.tree") {
      return ok({
        columns: [
          { name: "name", type: "text" },
          { name: "type", type: "text" },
        ],
        rows: [["items", "table"]],
        truncated: false,
        rowsAffected: 0,
      });
    }
    if (req.method === "query.run") sqls.push(req.params.sql ?? "");
    return ok(EMPTY);
  };
  return sqls;
}

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => <BackupPanel connId="c1" connName="Ventas" engine="sqlite" db="main" onCatalogChanged={() => {}} />,
      host!,
    );
  });
}

const tab = (name: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((b) => b.textContent === name)!;

describe("BackupPanel", () => {
  it("offers its three jobs as tabs, with one primary on screen", async () => {
    installBridge();
    mount();
    await flush();
    expect([...host!.querySelectorAll("[role=tab]")].map((b) => b.textContent)).toEqual([
      "Respaldar",
      "DDL a una carpeta",
      "Restaurar",
    ]);
    expect(host!.querySelectorAll(".wiz-foot .btn-primary, .wiz-foot .btn-danger").length).toBe(1);
    expect(host!.querySelector(".wiz-foot .btn-primary")!.textContent).toBe("Respaldar…");
    expect(host!.textContent).toContain("Base de datos: Ventas › main");
  });

  it("restores only after a confirmation that names the file, the count and the target", async () => {
    const sqls = installBridge();
    mount();
    await flush();
    tab("Restaurar").click();
    await flush();

    const input = host!.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = { name: "dump.sql", text: async () => "CREATE TABLE a (x int);\nINSERT INTO a VALUES (1);\n" };
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();

    const primary = host!.querySelector<HTMLButtonElement>(".wiz-foot .btn-danger")!;
    expect(primary.textContent).toBe("Restaurar 2 sentencias");
    primary.click();
    await flush();
    const dialog = host!.querySelector(".confirm-dialog")!;
    expect(dialog.querySelector("h2")!.textContent).toBe("¿Restaurar sobre Ventas › main?");
    expect(dialog.textContent).toContain("2 sentencias de dump.sql");
    expect(sqls).toEqual([]);

    dialog.querySelector<HTMLButtonElement>(".btn-danger")!.click();
    await flush();
    expect(sqls.length).toBe(2);
    expect(host!.querySelector(".confirm-dialog")).toBeNull();
  });
});
