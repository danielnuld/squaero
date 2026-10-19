import { describe, it, expect, afterEach, vi } from "vitest";
import { createRoot } from "solid-js";
import { render } from "solid-js/web";
import { DataSearchPanel, type SearchRequest } from "../../src/components/DataSearchPanel";

// Drives the real DataSearchPanel against a mocked bridge: per-table column
// counts, a table the search cannot look at, the run with its results list and
// matching rows, and the docked form handing the request over.

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

const ok = (id: number, columns: { name: string; type: string }[], rows: (string | null)[][]) => ({
  jsonrpc: "2.0",
  id,
  result: { columns, rows, truncated: false, rowsAffected: 0 },
});

function installBridge() {
  const sqls: string[] = [];
  (globalThis as BridgeHost).quaeroRpc = async (raw: string) => {
    const req = JSON.parse(raw) as { id: number; method: string; params: { db?: string; table?: string; sql?: string } };
    if (req.method === "schema.tree") {
      return req.params.db
        ? ok(req.id, [{ name: "name", type: "text" }, { name: "type", type: "text" }], [
            ["clientes", "table"],
            ["lineas", "table"],
          ])
        : ok(req.id, [{ name: "name", type: "text" }], [["main"]]);
    }
    if (req.method === "schema.describe") {
      const cols = req.params.table === "clientes" ? [["nombre", "text"], ["ciudad", "varchar(20)"]] : [["cantidad", "integer"]];
      return ok(req.id, [{ name: "name", type: "text" }, { name: "type", type: "text" }], cols);
    }
    if (req.method === "query.run") {
      sqls.push(req.params.sql ?? "");
      return ok(req.id, [{ name: "nombre", type: "text" }, { name: "ciudad", type: "text" }], [["Ana", "Hermosillo"]]);
    }
    return { jsonrpc: "2.0", id: req.id, result: {} };
  };
  return sqls;
}

function mount(over: { onSearch?: (r: SearchRequest) => void; onOpen?: (sql: string, table: string) => void } = {}) {
  host = document.createElement("div");
  document.body.appendChild(host);
  createRoot((d) => {
    dispose = d;
    render(
      () => (
        <DataSearchPanel
          connId="c1"
          engine="sqlite"
          db="main"
          onOpen={over.onOpen ?? (() => {})}
          onSearch={over.onSearch}
        />
      ),
      host!,
    );
  });
}

const typeText = (v: string) => {
  const input = host!.querySelector<HTMLInputElement>("input[type=search]")!;
  input.value = v;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};
const submit = () => host!.querySelector<HTMLButtonElement>("form button[type=submit]")!.click();

describe("DataSearchPanel", () => {
  it("counts each table's searchable columns and leaves out the ones without", async () => {
    installBridge();
    mount();
    await flush();
    const rows = [...host!.querySelectorAll<HTMLLabelElement>(".ds-table")];
    expect(rows[0].textContent).toContain("2 columnas de texto");
    expect(rows[1].querySelector("input")!.disabled).toBe(true);
    expect(rows[1].textContent).toContain("Solo columnas numéricas");
    expect(host!.querySelector("form button[type=submit]")!.textContent).toBe("Buscar en 1 tabla");
  });

  it("searches, lists every table and shows the matching rows with «Abrir … filtrada»", async () => {
    const sqls = installBridge();
    const onOpen = vi.fn();
    mount({ onOpen });
    await flush();
    typeText("Hermosillo");
    submit();
    await flush();
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).toContain("clientes");
    expect(host!.querySelector(".ds-summary")!.textContent).toContain("1 coincidencia");
    expect(host!.querySelector(".ds-summary")!.textContent).toContain("en 1 de 1 tablas");
    // The first table with matches opens by itself.
    expect(host!.querySelector(".ds-item[aria-current=true]")!.textContent).toContain("clientes");
    expect(host!.querySelectorAll(".ds-grid .grid-rows [role='row']").length).toBe(1);
    const open = [...host!.querySelectorAll<HTMLButtonElement>(".ds-matches-bar button")].find(
      (b) => b.textContent === "Abrir clientes filtrada",
    )!;
    open.click();
    expect(onOpen).toHaveBeenCalledWith(expect.stringContaining("LIKE"), "clientes");
  });

  it("docked, hands the request over instead of running it", async () => {
    const sqls = installBridge();
    const onSearch = vi.fn();
    mount({ onSearch });
    await flush();
    typeText("Ana");
    submit();
    expect(sqls).toHaveLength(0);
    expect(onSearch).toHaveBeenCalledTimes(1);
    const req = onSearch.mock.calls[0][0] as SearchRequest;
    expect(req.db).toBe("main");
    expect(req.tables).toEqual(["clientes"]);
    expect(req.opts.text).toBe("Ana");
    expect(host!.querySelector(".ds-results")).toBeNull();
  });

  it("refuses an empty text", async () => {
    installBridge();
    mount();
    await flush();
    submit();
    await flush();
    expect(host!.querySelector("[role=alert]")!.textContent).toContain("Escribe un texto");
  });
});
