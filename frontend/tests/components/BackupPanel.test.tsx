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
    expect(host!.querySelector(".wiz-foot .btn-primary")!.textContent).toBe("Siguiente");
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

// #692 (P5): the backup in three steps — what, where, review — with a summary,
// a count per object, progress and a Cancelar that discards the file.
describe("BackupPanel — backup wizard", () => {
  const set = (cols: string[], rows: (string | null)[][]) => ({
    columns: cols.map((name) => ({ name, type: "text" })),
    rows,
    truncated: false,
    rowsAffected: 0,
  });

  function backupBridge(opts: { hang?: boolean } = {}) {
    const sqls: string[] = [];
    let release: (() => void) | null = null;
    (globalThis as BridgeHost).quaeroRpc = async (requestJson: string) => {
      const req = JSON.parse(requestJson) as { id: number; method: string; params: { sql?: string } };
      const ok = (result: unknown) => ({ jsonrpc: "2.0", id: req.id, result });
      if (req.method === "schema.tree") return ok(set(["name", "type"], [["items", "table"], ["v", "view"]]));
      if (req.method === "schema.ddl") return ok(set(["sql"], [["CREATE TABLE items (id INTEGER)"]]));
      if (req.method === "query.run") {
        const sql = req.params.sql ?? "";
        sqls.push(sql);
        if (sql.startsWith("SELECT COUNT(*)")) return ok(set(["n"], [["2"]]));
        if (opts.hang) await new Promise<void>((r) => (release = r));
        return ok(set(["id"], [["1"], ["2"]]));
      }
      return ok(EMPTY);
    };
    return { sqls, release: () => release?.() };
  }

  /** A save dialog that records what is written, and whether it was aborted. */
  function savePicker() {
    const file = { chunks: [] as string[], closed: false, aborted: false };
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = async () => ({
      name: "ventas.sql",
      createWritable: async () => ({
        write: async (c: string) => void file.chunks.push(c),
        close: async () => void (file.closed = true),
        abort: async () => void (file.aborted = true),
      }),
    });
    return file;
  }
  afterEach(() => {
    delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });

  const button = (text: string) =>
    [...host!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === text)!;

  async function toReview() {
    await flush();
    expect(host!.textContent).toContain("2 de 2 seleccionados");
    button("Siguiente").click();
    await flush();
    expect(button("Siguiente").disabled).toBe(true); // no file chosen yet
    button("Elegir archivo…").click();
    await flush();
    expect(host!.querySelector(".wiz-form")!.textContent).toContain("ventas.sql");
    button("Siguiente").click();
    await flush();
  }

  it("walks what, where and review, then saves with a count per object", async () => {
    backupBridge();
    const file = savePicker();
    mount();
    await toReview();
    const summary = host!.querySelector(".wiz-form")!.textContent!;
    expect(summary).toContain("1 tabla · 1 vista");
    expect(summary).toContain("Estructura y datos");
    expect(summary).toMatch(/Filas\s*2/);
    host!.querySelector<HTMLButtonElement>(".wiz-foot .btn-primary")!.click();
    await flush();
    expect(file.closed).toBe(true);
    expect(file.chunks.join("")).toContain("CREATE TABLE items");
    expect(host!.querySelector(".import-applied")!.textContent).toBe("Respaldo guardado en ventas.sql.");
    const lines = [...host!.querySelectorAll(".stmt")].map((l) => l.textContent);
    expect(lines).toEqual(["Tablaitems2 de 2 filas", "VistavVista"]);
    expect(button("Nuevo respaldo")).toBeDefined();
  });

  it("shows progress while it runs and Cancelar discards the file", async () => {
    const bridge = backupBridge({ hang: true });
    const file = savePicker();
    mount();
    await toReview();
    host!.querySelector<HTMLButtonElement>(".wiz-foot .btn-primary")!.click();
    await flush();
    expect(host!.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(host!.querySelector(".run-progress-line")!.textContent).toMatch(/^0 de 2 filas · 0 %/);
    button("Cancelar respaldo").click();
    bridge.release();
    await flush();
    expect(file.aborted).toBe(true);
    expect(file.closed).toBe(false);
    expect(host!.querySelector('[role="alert"]')!.textContent).toContain("Respaldo cancelado");
  });
});
